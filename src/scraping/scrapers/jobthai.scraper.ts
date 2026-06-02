/**
 * JobThai scraper  – https://www.jobthai.com
 * Strategy: GET HTML → extract __NEXT_DATA__ JSON (Next.js SSR) → fall back to cheerio selectors
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { RawJob } from '../dto/raw-job.dto';
import { ScanFiltersDto } from '../../scan/dto/scan-filters.dto';

const BASE = 'https://www.jobthai.com';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'max-age=0',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'DNT': '1',
};

// Province ID mapping (subset)
const PROV_ID: Record<string, string> = {
  กรุงเทพมหานคร: '10', กรุงเทพ: '10', กทม: '10',
  นนทบุรี: '12', ปทุมธานี: '13', สมุทรปราการ: '11',
  เชียงใหม่: '50', ชลบุรี: '20', ขอนแก่น: '40',
  ภูเก็ต: '83', นครราชสีมา: '30', สุราษฎร์ธานี: '84',
  ระยอง: '21', อยุธยา: '14', สมุทรสาคร: '74',
};
const TYPE_MAP: Record<string, string> = {
  full_time: '1', part_time: '2', contract: '4', freelance: '5', internship: '6',
};

function parseNextData(html: string): RawJob[] {
  try {
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) return [];
    const nd = JSON.parse(match[1]);

    // Try various pageProps shapes
    const pp = nd?.props?.pageProps ?? {};
    const items: any[] =
      pp.jobList ?? pp.jobs ?? pp.jobSearchResult?.jobs ??
      pp.searchResult?.jobs ?? pp.data?.jobs ?? [];

    return items.map((it: any) => ({
      title: it.positionName ?? it.title ?? it.name ?? '',
      company: it.companyName ?? it.company?.name ?? it.company ?? '',
      location: it.workplaceName ?? it.provinceName ?? it.location ?? 'ไทย',
      salary: it.salaryText ?? it.salary
        ? (it.salaryMin
          ? `${Number(it.salaryMin).toLocaleString('th')} – ${Number(it.salaryMax ?? it.salaryMin).toLocaleString('th')} บาท`
          : it.salaryText ?? it.salary)
        : undefined,
      jobType: it.jobTypeName ?? it.jobType ?? undefined,
      description: (it.jobDetail ?? it.description ?? it.requirement ?? '').slice(0, 500),
      url: it.jobUrl ?? it.url ?? (it.jobId ? `${BASE}/th/job/${it.jobId}` : BASE),
      source: 'JobThai',
      postedAt: it.postDate ?? it.createdDate ?? it.publishedAt,
    })).filter((j) => j.title.length > 2);
  } catch {
    return [];
  }
}

export async function scrapeJobThai(f: ScanFiltersDto, maxPages = 3): Promise<RawJob[]> {
  const jobs: RawJob[] = [];

  for (let page = 1; page <= maxPages; page++) {
    try {
      const params = new URLSearchParams();
      if (f.keywords) {
        params.set('Keyword', f.keywords);
        params.set('Position', f.keywords);   // fallback param name
      }
      if (f.province) {
        const pid = PROV_ID[f.province];
        if (pid) params.set('Province', pid);
      }
      if (f.jobType) {
        const t = TYPE_MAP[f.jobType];
        if (t) params.set('JobTypeNo', t);
      }
      if (f.postedWithin) params.set('NewJob', String(f.postedWithin));
      params.set('Page', String(page));
      params.set('Sort', '1');  // newest first

      // Try multiple URL patterns (site has changed paths before)
      const urls = [
        `${BASE}/th/find-jobs?${params}`,
        `${BASE}/th/find-jobs/?${params}`,
        `${BASE}/th/jobs?${params}`,
      ];

      let html = '';
      for (const url of urls) {
        try {
          const res = await axios.get(url, {
            headers: HEADERS,
            timeout: 15000,
            maxRedirects: 5,
          });
          html = res.data;
          break;
        } catch (e: any) {
          if (e?.response?.status === 404) continue;
          throw e;
        }
      }

      if (!html) break;

      // Primary: __NEXT_DATA__ extraction
      const fromNext = parseNextData(html);
      if (fromNext.length > 0) {
        jobs.push(...fromNext);
        if (fromNext.length < 20) break;
        await sleep(800);
        continue;
      }

      // Fallback: cheerio HTML selectors
      const $ = cheerio.load(html);
      let found = 0;

      // Multiple selector strategies for different site versions
      const cardSelectors = [
        'div.jobList-item',
        'div[class*="job-list"]',
        'div[class*="joblist"]',
        'div[class*="job-card"]',
        'li[class*="job"]',
        'article[class*="job"]',
        '.job-box',
        '[data-testid*="job"]',
      ];

      for (const sel of cardSelectors) {
        $(sel).each((_, el) => {
          const $e = $(el);
          const titleEl = $e.find('a[class*="title"], h2 a, h3 a, .job-title a, [class*="position"] a').first();
          const title = titleEl.text().trim() || $e.find('h2, h3').first().text().trim();
          if (!title || title.length < 3) return;

          const href = titleEl.attr('href') ?? $e.find('a').first().attr('href') ?? '';
          const company = $e.find('[class*="company"], [class*="employer"], [class*="Company"]').first().text().trim();
          const location = $e.find('[class*="location"], [class*="province"], [class*="place"], [class*="workplace"]').first().text().trim();
          const salary = $e.find('[class*="salary"], [class*="wage"], [class*="Salary"]').first().text().trim() || undefined;
          const desc = $e.find('[class*="detail"], [class*="desc"], p').first().text().trim();

          jobs.push({
            title,
            company,
            location: location || f.province || 'ไทย',
            salary,
            description: desc,
            url: href.startsWith('http') ? href : `${BASE}${href}`,
            source: 'JobThai',
          });
          found++;
        });
        if (found > 0) break;
      }

      // Also try JSON-LD
      if (found === 0) {
        $('script[type="application/ld+json"]').each((_, el) => {
          try {
            const data = JSON.parse($(el).html() ?? '{}');
            const list = Array.isArray(data) ? data : [data];
            for (const item of list) {
              if (item['@type'] === 'JobPosting') {
                jobs.push({
                  title: item.title ?? '',
                  company: item.hiringOrganization?.name ?? '',
                  location: item.jobLocation?.address?.addressLocality ?? f.province ?? 'ไทย',
                  salary: item.baseSalary
                    ? `${item.baseSalary.value?.minValue ?? ''} – ${item.baseSalary.value?.maxValue ?? ''} บาท`
                    : undefined,
                  description: (item.description ?? '').slice(0, 400),
                  url: item.url ?? '',
                  source: 'JobThai',
                  postedAt: item.datePosted,
                });
                found++;
              }
            }
          } catch { /* skip */ }
        });
      }

      if (found === 0) break;
      await sleep(800);
    } catch (err: any) {
      console.error('[JobThai]', err.message);
      break;
    }
  }

  return jobs;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
