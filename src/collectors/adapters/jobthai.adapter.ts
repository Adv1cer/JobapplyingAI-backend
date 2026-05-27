/**
 * JobThai Adapter
 * Strategy: call api.jobthai.com GraphQL endpoint directly
 *   POST https://api.jobthai.com/v1/graphql
 *   Query: searchJobs(filter: JobsSearchFilter, orderBy: JobOrderBy, staticDataVersion: StaticDataVersion)
 *
 * Query + variable shape extracted from:
 *   https://asset.jobthai.com/_next/static/chunks/pages/jobs-*.js
 */
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { BaseJobAdapter } from './base.adapter';
import { NormalizedJob } from '../../common/interfaces/job.interface';
import { ScanFiltersDto } from '../../scan/dto/scan-filters.dto';
import { sleep } from '../../common/utils/retry.util';

const GQL_URL = 'https://api.jobthai.com/v1/graphql';

// GraphQL result cache keyed by filter JSON — 30 min TTL
const PAGE_CACHE_TTL_MS = 30 * 60 * 1000;
const gqlCache = new Map<string, { items: any[]; total: number; cachedAt: number }>();

function getCachedGql(key: string) {
  const e = gqlCache.get(key);
  if (!e) return null;
  if (Date.now() - e.cachedAt > PAGE_CACHE_TTL_MS) { gqlCache.delete(key); return null; }
  return e;
}

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, */*',
  'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8',
  'Content-Type': 'application/json',
  'Origin': 'https://www.jobthai.com',
  'Referer': 'https://www.jobthai.com/',
};

// Thai province name / English name → JobThai province ID
const PROVINCE_ID: Record<string, string> = {
  // Thai names
  'กรุงเทพมหานคร': '01',
  'กรุงเทพ': '01',
  'กทม': '01',
  'กรุงเทพฯ': '01',
  'นนทบุรี': '05',
  'ปทุมธานี': '06',
  'สมุทรปราการ': '16',
  'เชียงใหม่': '20',
  'ชลบุรี': '21',
  'ระยอง': '22',
  'นครราชสีมา': '28',
  'ขอนแก่น': '30',
  'ภูเก็ต': '44',
  'สงขลา': '45',
  // English names
  'bangkok': '01',
  'nonthaburi': '05',
  'pathum thani': '06',
  'samut prakan': '16',
  'chiang mai': '20',
  'chonburi': '21',
  'rayong': '22',
  'nakhon ratchasima': '28',
  'khon kaen': '30',
  'phuket': '44',
  // Numeric pass-through
  '01': '01', '05': '05', '06': '06', '16': '16',
  '20': '20', '21': '21', '22': '22', '28': '28',
  '30': '30', '44': '44',
};

// Our jobType → JobThai numeric jobtype ID
// See: https://www.jobthai.com (job category IDs in URL)
const JOB_TYPE_ID: Record<string, string> = {
  it:          '7',
  software:    '7',
  engineering: '7',
  full_time:   '7', // fall back to IT for generic full_time
};

// The exact GraphQL query extracted from pages/jobs-*.js bundle
const SEARCH_JOBS_QUERY = `
query ($searchJobsFilter: JobsSearchFilter, $orderBy: JobOrderBy, $staticDataVersion: StaticDataVersion) {
  searchJobs(filter: $searchJobsFilter, orderBy: $orderBy, staticDataVersion: $staticDataVersion) {
    data {
      total
      data {
        id
        companyID
        jobTitle
        companyName
        companyLogo
        province { id name }
        district { id name }
        workLocation
        salary
        jobType { id name }
        region { id name }
        tags
        updatedAt
      }
    }
  }
}
`.trim();

function buildFilter(
  filters: ScanFiltersDto,
  page: number,
): Record<string, any> {
  const f: Record<string, any> = { l: 'th', page };

  // Keyword search
  if (filters.keywords?.trim()) {
    f.keyword = filters.keywords.trim();
  }

  // Province
  if (filters.province) {
    const id = PROVINCE_ID[filters.province]
      ?? PROVINCE_ID[filters.province.toLowerCase()]
      ?? null;
    if (id) f.province = id;
  }

  // Salary minimum
  if (filters.salaryMin && filters.salaryMin > 0) {
    f.salarymin = filters.salaryMin;
  }

  // Salary maximum
  if (filters.salaryMax && filters.salaryMax > 0) {
    f.salarymax = filters.salaryMax;
  }

  // Job type (category ID)
  if (filters.jobType) {
    const typeId = JOB_TYPE_ID[filters.jobType.toLowerCase()];
    if (typeId) f.jobtype = typeId;
  }

  return f;
}

function normalizeItem(it: any): NormalizedJob | null {
  const id = it.id;
  if (!id) return null;

  const provinceStr = it.province?.name ?? '';
  const districtStr = it.district?.name ?? '';
  const location = districtStr
    ? `${districtStr}, ${provinceStr}`
    : provinceStr || 'Thailand';

  // Tags can be used as skills hint
  const tags: string[] = Array.isArray(it.tags)
    ? it.tags.filter((t: any) => typeof t === 'string')
    : [];

  return {
    id: `jobthai_${id}`,
    source: 'JobThai',
    externalId: String(id),
    title: it.jobTitle ?? '',
    company: it.companyName ?? '',
    location,
    description: it.workLocation ?? '',
    skills: tags,
    salary: it.salary ?? undefined,
    jobType: it.jobType?.name ?? undefined,
    remote: false, // JobThai doesn't have explicit remote flag in list view
    url: `https://www.jobthai.com/th/find-jobs/${id}`,
    hrEmails: [],
    postedAt: it.updatedAt ? new Date(it.updatedAt).toISOString() : undefined,
    createdAt: new Date(),
  };
}

@Injectable()
export class JobThaiAdapter extends BaseJobAdapter {
  readonly sourceName = 'JobThai';
  protected readonly logger = new Logger(JobThaiAdapter.name);

  async collect(filters: ScanFiltersDto, maxPages = 3): Promise<NormalizedJob[]> {
    if (filters.country === 'international') return [];

    const jobs: NormalizedJob[] = [];

    for (let page = 1; page <= maxPages; page++) {
      const searchJobsFilter = buildFilter(filters, page);
      const cacheKey = JSON.stringify(searchJobsFilter);

      try {
        // ── Try cache first ───────────────────────────────────────────────────
        let items: any[];
        let total: number;
        let fromCache = false;

        const cached = getCachedGql(cacheKey);
        if (cached) {
          items = cached.items;
          total = cached.total;
          fromCache = true;
        } else {
          const { data: resp } = await axios.post(
            GQL_URL,
            {
              query: SEARCH_JOBS_QUERY,
              variables: {
                searchJobsFilter,
                orderBy: 'UPDATED_AT_DESC',
                staticDataVersion: {},
              },
            },
            { headers: HEADERS, timeout: 15000 },
          );

          if (resp?.errors?.length) {
            this.logger.warn(
              `[JobThai] GraphQL errors: ${resp.errors.map((e: any) => e.message).join('; ')}`,
            );
            break;
          }

          const result = resp?.data?.searchJobs?.data;
          items = result?.data ?? [];
          total = result?.total ?? 0;

          // Store in cache for 30 min
          gqlCache.set(cacheKey, { items, total, cachedAt: Date.now() });
        }

        if (items.length === 0) {
          this.logger.log(`[JobThai p${page}] No results (total: ${total})`);
          break;
        }

        for (const it of items) {
          const job = normalizeItem(it);
          if (!job || !job.title) continue;
          job.skills = [
            ...new Set([...job.skills, ...this.normalizeSkills(job.title + ' ' + job.description)]),
          ];
          jobs.push(job);
        }

        this.logger.log(
          `[JobThai p${page}] ${items.length} jobs / total ${total}${fromCache ? ' (cached)' : ''}`,
        );

        const pageSize = 20;
        if (page * pageSize >= total || items.length < pageSize) break;

        // Polite delay between pages (only when actually calling the API)
        if (!fromCache) await sleep(800);
      } catch (err: any) {
        this.logger.error(`[JobThai p${page}]: ${err.message}`);
        break;
      }
    }

    this.logger.log(`[JobThai] Total collected: ${jobs.length}`);
    return jobs;
  }
}
