/**
 * JobsDB Adapter
 * Strategy: build the exact same URL a user would type in their browser
 *   https://th.jobsdb.com/th/{keyword}-jobs/in-{location}/{jobtype}?salaryrange=X-Y&salarytype=monthly&page=N
 * Then extract __NEXT_DATA__ (Next.js SSR) from the HTML response.
 */
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { BaseJobAdapter } from './base.adapter';
import { NormalizedJob } from '../../common/interfaces/job.interface';
import { ScanFiltersDto } from '../../scan/dto/scan-filters.dto';
import { sleep } from '../../common/utils/retry.util';

const BASE = 'https://th.jobsdb.com';

/**
 * In-process page cache: URL → { items, cachedAt }
 * Avoids re-fetching the same search results page within the TTL.
 * The scan-session cooldown (1 h) is the outer guard; this is a 30-min
 * inner guard for individual pages in case of partial retries.
 */
const PAGE_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
const pageCache = new Map<string, { items: any[]; cachedAt: number }>();

function getCachedPage(url: string): any[] | null {
  const entry = pageCache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > PAGE_CACHE_TTL_MS) { pageCache.delete(url); return null; }
  return entry.items;
}

function setCachedPage(url: string, items: any[]): void {
  pageCache.set(url, { items, cachedAt: Date.now() });
}

// Mimic a real browser as closely as possible
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'max-age=0',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

// Thai province → JobsDB URL segment mapping
const PROVINCE_SLUG: Record<string, string> = {
  กรุงเทพมหานคร: 'กรุงเทพมหานครและปริมณฑล',
  กรุงเทพ:       'กรุงเทพมหานครและปริมณฑล',
  กทม:           'กรุงเทพมหานครและปริมณฑล',
  นนทบุรี:       'นนทบุรี',
  ปทุมธานี:      'ปทุมธานี',
  สมุทรปราการ:   'สมุทรปราการ',
  เชียงใหม่:     'เชียงใหม่',
  ชลบุรี:        'ชลบุรี',
  ขอนแก่น:       'ขอนแก่น',
  ภูเก็ต:        'ภูเก็ต',
  นครราชสีมา:    'นครราชสีมา',
  ระยอง:         'ระยอง',
};

const JOB_TYPE_SLUG: Record<string, string> = {
  full_time:  'full-time',
  part_time:  'part-time',
  contract:   'contract',
  freelance:  'contract',
  internship: 'internship',
};

function buildUrl(filters: ScanFiltersDto, page: number): string {
  // keyword slug: "frontend developer" → "frontend-developer"
  const kw = (filters.keywords || 'it-software')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');

  let path = `/th/${kw}-jobs`;

  // Location segment
  if (filters.province) {
    const loc = PROVINCE_SLUG[filters.province] ?? filters.province;
    path += `/in-${encodeURIComponent(loc)}`;
  }

  // Job type segment
  if (filters.jobType && JOB_TYPE_SLUG[filters.jobType]) {
    path += `/${JOB_TYPE_SLUG[filters.jobType]}`;
  }

  const params = new URLSearchParams();

  // Salary filter
  if (filters.salaryMin || filters.salaryMax) {
    const min = filters.salaryMin ?? '';
    const max = filters.salaryMax ?? '';
    params.set('salaryrange', `${min}-${max}`);
    params.set('salarytype', 'monthly');
  }

  // Posted-within filter
  if (filters.postedWithin) {
    // JobsDB uses 'dateRange' query param: 1, 3, 7, 14, 30
    params.set('dateRange', String(filters.postedWithin));
  }

  if (page > 1) params.set('page', String(page));

  const qs = params.toString();
  return `${BASE}${path}${qs ? '?' + qs : ''}`;
}

function extractJsonAt(str: string, start: number): string | null {
  const opener = str[start];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < str.length; i++) {
    const c = str[i];
    if (escape) { escape = false; continue; }
    if (c === '\\' && inString) { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === opener || c === '[' || c === '{') depth++;
    if (c === closer || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return str.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * JobsDB embeds job data inside window.__staticRouterHydrationData
 * The jobs array is at: "jobs":[{"advertiser":...}]
 */
function extractJobsFromHtml(html: string): any[] {
  try {
    // Primary: find the jobs array directly (fastest path)
    const marker = '"jobs":[{"advertiser"';
    const markerIdx = html.indexOf(marker);
    if (markerIdx >= 0) {
      const arrStart = html.indexOf('[', markerIdx);
      const json = extractJsonAt(html, arrStart);
      if (json) return JSON.parse(json);
    }

    // Fallback: find __staticRouterHydrationData and walk it
    const hydIdx = html.indexOf('__staticRouterHydrationData');
    if (hydIdx >= 0) {
      const objStart = html.indexOf('{', hydIdx);
      const json = extractJsonAt(html, objStart);
      if (json) {
        const data = JSON.parse(json);
        function findJobs(obj: any): any[] | null {
          if (!obj || typeof obj !== 'object') return null;
          if (Array.isArray(obj)) return obj[0]?.advertiser ? obj : null;
          for (const v of Object.values(obj)) {
            const r = findJobs(v);
            if (r) return r;
          }
          return null;
        }
        return findJobs(data) ?? [];
      }
    }
  } catch { /* fall through */ }
  return [];
}

function normalizeItem(it: any): NormalizedJob | null {
  const id = it.id ?? it.jobId ?? it.listingId;
  if (!id) return null;

  // salary: "salaryLabel" is the display string in new API
  const salary = it.salaryLabel && it.salaryLabel !== ''
    ? it.salaryLabel
    : undefined;

  // location: stored in locations[0].label
  const location = it.locations?.[0]?.label
    ?? it.locations?.[0]?.seoHierarchy?.[0]?.contextualName
    ?? 'Thailand';

  // description: bulletPoints array or teaser
  const teaser: string = Array.isArray(it.bulletPoints) && it.bulletPoints.length > 0
    ? it.bulletPoints.join(' | ')
    : it.teaser ?? '';

  // job type: workTypes array
  const jobType = Array.isArray(it.workTypes) && it.workTypes.length > 0
    ? it.workTypes[0]?.label ?? it.workTypes[0]
    : undefined;

  // remote: workArrangements array
  const remote = Array.isArray(it.workArrangements)
    ? it.workArrangements.some((w: any) =>
        w?.label?.toLowerCase().includes('remote') || w?.id === 'remote' || String(w).toLowerCase().includes('remote')
      )
    : false;

  return {
    id: `jobsdb_${id}`,
    source: 'JobsDB',
    externalId: String(id),
    title: it.title ?? '',
    company: it.advertiser?.description ?? it.companyName ?? '',
    location,
    description: teaser,
    skills: [],
    salary,
    jobType,
    remote,
    url: `${BASE}/th/job/${id}`,
    hrEmails: [],
    postedAt: it.listingDate,
    createdAt: new Date(),
  };
}

@Injectable()
export class JobsDBAdapter extends BaseJobAdapter {
  readonly sourceName = 'JobsDB';
  protected readonly logger = new Logger(JobsDBAdapter.name);

  async collect(filters: ScanFiltersDto, maxPages = 3): Promise<NormalizedJob[]> {
    if (filters.country === 'international') return [];

    const jobs: NormalizedJob[] = [];

    for (let page = 1; page <= maxPages; page++) {
      const url = buildUrl(filters, page);
      this.logger.log(`[JobsDB] Fetching: ${url}`);

      try {
        // Return cached page to avoid redundant fetches within 30 min
        let items = getCachedPage(url);
        let fromCache = false;

        if (!items) {
          const { data: html } = await axios.get(url, {
            headers: HEADERS,
            timeout: 15000,
            maxRedirects: 5,
          });
          items = extractJobsFromHtml(html);
          setCachedPage(url, items);
        } else {
          fromCache = true;
        }

        if (items.length === 0) {
          this.logger.warn(`[JobsDB p${page}] No jobs in HTML — page structure may have changed`);
          break;
        }

        for (const it of items) {
          const job = normalizeItem(it);
          if (!job || !job.title) continue;
          job.skills = this.normalizeSkills(job.description);
          jobs.push(job);
        }

        this.logger.log(`[JobsDB p${page}] ${items.length} jobs${fromCache ? ' (cached)' : ''}`);

        // Stop early if last page returned fewer than a full page
        if (items.length < 20) break;

        // Polite delay between pages (only when actually fetching)
        if (!fromCache) await sleep(1200);
      } catch (err: any) {
        this.logger.error(`[JobsDB p${page}]: ${err.message} — URL: ${url}`);
        break;
      }
    }

    return jobs;
  }
}
