/**
 * Jobbkk.com scraper – https://www.jobbkk.com
 * Thailand's most popular job board (80k+ active listings)
 * Strategy: REST search API → __NEXT_DATA__ → cheerio HTML
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { RawJob } from '../dto/raw-job.dto';
import { ScanFiltersDto } from '../../scan/dto/scan-filters.dto';

const BASE = 'https://www.jobbkk.com';
const PAGE_SIZE = 20;

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
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

const API_HEADERS = {
  ...HEADERS,
  Accept: 'application/json, text/plain, */*',
  Referer: BASE + '/jobs/search',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

// Province slug mapping
const PROV_SLUG: Record<string, string> = {
  กรุงเทพมหานคร: 'bangkok', กรุงเทพ: 'bangkok', กทม: 'bangkok',
  นนทบุรี: 'nonthaburi', ปทุมธานี: 'pathum-thani',
  สมุทรปราการ: 'samut-prakan', เชียงใหม่: 'chiang-mai',
  ชลบุรี: 'chon-buri', ขอนแก่น: 'khon-kaen',
  ภูเก็ต: 'phuket', นครราชสีมา: 'nakhon-ratchasima',
};

async function tryApi(keywords: string, page: number, province?: string): Promise<any[]> {
  const params = new URLSearchParams({
    keyword: keywords || 'developer',
    page: String(page),
    limit: String(PAGE_SIZE),
    lang: 'th',
  });
  if (province) {
    const slug = PROV_SLUG[province] ?? province;
    params.set('province', slug);
  }

  const apiPaths = [
    `${BASE}/api/jobs/search`,
    `${BASE}/api/v1/jobs/search`,
    `${BASE}/api/v2/jobs`,
  ];

  for (const path of apiPaths) {
    try {
      const { data } = await axios.get(`${path}?${params}`, {
        headers: API_HEADERS,
        timeout: 10000,
      });
      const items: any[] =
        data?.data?.jobs ?? data?.data ?? data?.jobs ?? data?.results ?? [];
      if (items.length > 0) return items;
    } catch (e: any) {
      if (e?.response?.status === 404 || e?.response?.status === 405) continue;
      break;
    }
  }
  return [];
}

function parseNextData(html: string): RawJob[] {
  try {
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) return [];
    const nd = JSON.parse(match[1]);
    const pp = nd?.props?.pageProps ?? {};
    const items: any[] =
      pp.jobs ?? pp.jobList ?? pp.data?.jobs ?? pp.jobsData?.jobs ?? pp.initialJobs ?? [];

    return items.map((it: any) => {
      const salMin = it.salary_min ?? it.salaryMin ?? it.min_salary;
      const salMax = it.salary_max ?? it.salaryMax ?? it.max_salary;
      return {
        title: it.title ?? it.position_name ?? it.positionName ?? '',
        company: it.company_name ?? it.companyName ?? it.company?.name ?? '',
        location: it.province_name ?? it.provinceName ?? it.location ?? 'ไทย',
        salary: salMin
          ? `${Number(salMin).toLocaleString('th')} – ${Number(salMax ?? salMin).toLocaleString('th')} บาท`
          : it.salary_text ?? it.salaryText ?? undefined,
        jobType: it.job_type ?? it.jobType ?? undefined,
        description: (it.job_description ?? it.description ?? it.job_detail ?? '').slice(0, 500),
        url: it.job_url ?? it.url ?? (it.job_id ? `${BASE}/jobs/${it.job_id}` : BASE),
        source: 'Jobbkk',
        postedAt: it.created_at ?? it.published_date ?? it.postedAt,
      };
    }).filter((j) => j.title.length > 2);
  } catch {
    return [];
  }
}

async function scrapeHtml(keywords: string, page: number, province?: string): Promise<RawJob[]> {
  const params = new URLSearchParams();
  if (keywords) params.set('keyword', keywords);
  if (province) params.set('province', PROV_SLUG[province] ?? province);
  if (page > 1) params.set('page', String(page));

  const urls = [
    `${BASE}/jobs/search?${params}`,
    `${BASE}/jobs?${params}`,
    `${BASE}/find-job?${params}`,
    `${BASE}/?${params}`,
  ];

  for (const url of urls) {
    try {
      const { data: html } = await axios.get(url, {
        headers: HEADERS,
        timeout: 15000,
        maxRedirects: 5,
      });

      const fromNext = parseNextData(html);
      if (fromNext.length > 0) return fromNext;

      const $ = cheerio.load(html);
      const jobs: RawJob[] = [];

      const cardSelectors = [
        '.job-list-item',
        '[class*="job-item"]',
        '[class*="job-card"]',
        '[class*="jobCard"]',
        '[class*="job-box"]',
        'article[class*="job"]',
        'li[class*="job"]',
        '[data-job-id]',
      ];

      for (const sel of cardSelectors) {
        $(sel).each((_, el) => {
          const $e = $(el);
          const titleEl = $e.find('h2 a, h3 a, a[class*="title"], a[class*="position"]').first();
          const title = titleEl.text().trim() || $e.find('h2, h3').first().text().trim();
          if (!title || title.length < 3) return;

          const href = titleEl.attr('href') ?? $e.find('a').first().attr('href') ?? '';
          const company = $e.find('[class*="company"], [class*="Company"]').first().text().trim();
          const location = $e.find('[class*="location"], [class*="province"]').first().text().trim();
          const salary = $e.find('[class*="salary"], [class*="wage"]').first().text().trim() || undefined;
          const desc = $e.find('p, [class*="desc"], [class*="detail"]').first().text().trim();
          const postedAt = $e.find('time').attr('datetime') ?? $e.find('[class*="date"]').first().text().trim();

          jobs.push({
            title,
            company,
            location: location || province || 'ไทย',
            salary,
            description: desc,
            url: href.startsWith('http') ? href : `${BASE}${href}`,
            source: 'Jobbkk',
            postedAt: postedAt || undefined,
          });
        });
        if (jobs.length > 0) return jobs;
      }

      // JSON-LD
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const data = JSON.parse($(el).html() ?? '{}');
          const list: any[] = Array.isArray(data) ? data : [data];
          for (const item of list) {
            if (item['@type'] === 'JobPosting') {
              jobs.push({
                title: item.title ?? '',
                company: item.hiringOrganization?.name ?? '',
                location: item.jobLocation?.address?.addressLocality ?? province ?? 'ไทย',
                description: (item.description ?? '').slice(0, 400),
                url: item.url ?? url,
                source: 'Jobbkk',
                postedAt: item.datePosted,
              });
            }
          }
        } catch { /* skip */ }
      });

      if (jobs.length > 0) return jobs;
    } catch (e: any) {
      if (e?.response?.status === 404) continue;
      throw e;
    }
  }
  return [];
}

export async function scrapeJobbkk(f: ScanFiltersDto, maxPages = 3): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  const keywords = f.keywords ?? '';

  for (let page = 1; page <= maxPages; page++) {
    try {
      // Try API first
      let items: any[] = await tryApi(keywords, page, f.province);

      if (items.length > 0) {
        for (const it of items) {
          const salMin = it.salary_min ?? it.salaryMin ?? it.min_salary;
          const salMax = it.salary_max ?? it.salaryMax ?? it.max_salary;
          jobs.push({
            title: it.title ?? it.position_name ?? it.positionName ?? '',
            company: it.company_name ?? it.companyName ?? it.company?.name ?? '',
            location: it.province_name ?? it.provinceName ?? it.location ?? f.province ?? 'ไทย',
            salary: salMin
              ? `${Number(salMin).toLocaleString('th')} – ${Number(salMax ?? salMin).toLocaleString('th')} บาท`
              : undefined,
            jobType: it.job_type ?? it.jobType,
            description: (it.description ?? it.job_detail ?? '').slice(0, 500),
            url: it.url ?? it.job_url ?? `${BASE}/jobs/${it.id ?? it.job_id}`,
            source: 'Jobbkk',
            postedAt: it.created_at ?? it.publishedDate,
          });
        }
        if (items.length < PAGE_SIZE) break;
      } else {
        // Fall back to HTML
        const scraped = await scrapeHtml(keywords, page, f.province);
        if (scraped.length === 0) break;
        jobs.push(...scraped);
        if (scraped.length < PAGE_SIZE) break;
      }

      await sleep(900);
    } catch (err: any) {
      console.error('[Jobbkk]', err.message);
      break;
    }
  }

  return jobs;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
