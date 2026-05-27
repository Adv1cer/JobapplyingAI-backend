/**
 * GetLinks scraper – https://getlinks.co
 * Southeast Asia's tech job matching platform
 * Strategy: NEXT_DATA extraction → cheerio selectors → JSON-LD
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { RawJob } from '../dto/raw-job.dto';
import { ScanFiltersDto } from '../../scan/dto/scan-filters.dto';

const BASE = 'https://getlinks.co';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
};

function fromNextData(html: string): RawJob[] {
  try {
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return [];
    const nd = JSON.parse(m[1]);
    const pp = nd?.props?.pageProps ?? {};
    const items: any[] =
      pp.jobs ?? pp.jobList ?? pp.initialJobs ?? pp.data?.jobs ?? pp.results ?? [];
    return items.map((it: any) => {
      const sMin = it.salary_min ?? it.salaryMin ?? it.min_salary;
      const sMax = it.salary_max ?? it.salaryMax ?? it.max_salary;
      return {
        title: it.title ?? it.position ?? it.name ?? '',
        company: it.company?.name ?? it.company_name ?? it.companyName ?? '',
        location: it.city ?? it.location ?? it.province ?? 'ไทย',
        salary: sMin ? `${Number(sMin).toLocaleString('th')} – ${Number(sMax ?? sMin).toLocaleString('th')} บาท` : undefined,
        jobType: it.employment_type ?? it.jobType ?? undefined,
        description: (it.description ?? it.requirement ?? it.detail ?? '').slice(0, 600),
        url: it.url ?? it.link ?? (it.id ? `${BASE}/jobs/${it.id}` : BASE),
        source: 'GetLinks',
        postedAt: it.published_at ?? it.created_at ?? it.createdAt,
      };
    }).filter((j) => j.title.length > 2);
  } catch { return []; }
}

export async function scrapeGetLinks(f: ScanFiltersDto, maxPages = 2): Promise<RawJob[]> {
  const jobs: RawJob[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams();
    if (f.keywords) params.set('q', f.keywords);
    if (f.province) params.set('location', f.province);
    if (page > 1) params.set('page', String(page));

    const urls = [
      `${BASE}/jobs?${params}`,
      `${BASE}/th/jobs?${params}`,
      `${BASE}/job?${params}`,
      `${BASE}/?${params}`,
    ];

    let found = 0;
    for (const url of urls) {
      try {
        const { data: html } = await axios.get(url, {
          headers: { ...HEADERS, Referer: BASE + '/' },
          timeout: 14000,
          maxRedirects: 5,
        });

        const next = fromNextData(html);
        if (next.length > 0) { jobs.push(...next); found = next.length; break; }

        const $ = cheerio.load(html);
        const items: RawJob[] = [];

        const selectors = [
          '[class*="job-card"]', '[class*="JobCard"]',
          '[class*="job-item"]', '[class*="job-list"]',
          'article[class*="job"]', 'li[class*="job"]',
          '[data-testid*="job"]', '.card',
        ];
        for (const sel of selectors) {
          $(sel).each((_, el) => {
            const $e = $(el);
            const titleEl = $e.find('h2 a, h3 a, a[class*="title"], a[class*="position"]').first();
            const title = titleEl.text().trim() || $e.find('h2,h3').first().text().trim();
            if (!title || title.length < 3) return;
            const href = titleEl.attr('href') ?? $e.find('a').first().attr('href') ?? '';
            items.push({
              title,
              company: $e.find('[class*="company"],[class*="Company"]').first().text().trim(),
              location: $e.find('[class*="location"],[class*="city"]').first().text().trim() || 'ไทย',
              salary: $e.find('[class*="salary"]').first().text().trim() || undefined,
              description: $e.find('p,[class*="desc"]').first().text().trim(),
              url: href.startsWith('http') ? href : `${BASE}${href}`,
              source: 'GetLinks',
            });
          });
          if (items.length > 0) break;
        }

        if (items.length > 0) { jobs.push(...items); found = items.length; break; }
      } catch (e: any) {
        if (e?.response?.status === 404) continue;
        console.error('[GetLinks]', e.message);
      }
    }

    if (found === 0) break;
    await sleep(700);
  }

  return jobs;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
