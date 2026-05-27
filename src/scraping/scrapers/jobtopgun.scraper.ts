/**
 * JobTopGun scraper – https://www.jobtopgun.com
 * Popular Thai job board, strong in IT/Tech and Japanese companies
 * Strategy: REST API → NEXT_DATA → cheerio
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { RawJob } from '../dto/raw-job.dto';
import { ScanFiltersDto } from '../../scan/dto/scan-filters.dto';

const BASE = 'https://www.jobtopgun.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
};

const JOB_TYPE_MAP: Record<string, string> = {
  full_time: 'fulltime', part_time: 'parttime',
  contract: 'contract', internship: 'intern', freelance: 'freelance',
};

function fromNextData(html: string): RawJob[] {
  try {
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return [];
    const nd = JSON.parse(m[1]);
    const pp = nd?.props?.pageProps ?? {};
    const items: any[] =
      pp.jobs ?? pp.jobList ?? pp.data?.jobs ??
      pp.searchResult?.jobs ?? pp.jobsData ?? [];

    return items.map((it: any) => {
      const sMin = it.salary_min ?? it.salaryMin ?? it.salaryFrom;
      const sMax = it.salary_max ?? it.salaryMax ?? it.salaryTo;
      return {
        title: it.job_title ?? it.title ?? it.position ?? '',
        company: it.company_name ?? it.companyName ?? it.company?.name ?? '',
        location: it.province_name ?? it.location ?? it.city ?? 'ไทย',
        salary: sMin
          ? `${Number(sMin).toLocaleString('th')} – ${Number(sMax ?? sMin).toLocaleString('th')} บาท`
          : it.salary_text ?? it.salaryText ?? undefined,
        jobType: it.job_type ?? it.jobType ?? undefined,
        description: (it.job_detail ?? it.description ?? it.detail ?? '').slice(0, 600),
        url: it.job_url ?? it.url ?? (it.job_id ? `${BASE}/job-detail/${it.job_id}` : BASE),
        source: 'JobTopGun',
        postedAt: it.post_date ?? it.postedDate ?? it.created_at,
      };
    }).filter((j) => j.title.length > 2);
  } catch { return []; }
}

export async function scrapeJobTopGun(f: ScanFiltersDto, maxPages = 3): Promise<RawJob[]> {
  const jobs: RawJob[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams();
    if (f.keywords) { params.set('keyword', f.keywords); params.set('q', f.keywords); }
    if (f.province) params.set('province', f.province);
    if (f.jobType) { const t = JOB_TYPE_MAP[f.jobType]; if (t) params.set('job_type', t); }
    if (page > 1) params.set('page', String(page));

    const urls = [
      `${BASE}/find-jobs?${params}`,
      `${BASE}/jobs?${params}`,
      `${BASE}/search?${params}`,
      `${BASE}/job-search?${params}`,
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

        // Try JSON-LD first (most reliable when present)
        $('script[type="application/ld+json"]').each((_, el) => {
          try {
            const d = JSON.parse($(el).html() ?? '{}');
            const list: any[] = Array.isArray(d) ? d : [d];
            for (const it of list) {
              if (it['@type'] === 'JobPosting') {
                jobs.push({
                  title: it.title ?? '',
                  company: it.hiringOrganization?.name ?? '',
                  location: it.jobLocation?.address?.addressLocality ?? 'ไทย',
                  salary: it.baseSalary
                    ? `${it.baseSalary.value?.minValue ?? ''} – ${it.baseSalary.value?.maxValue ?? ''} บาท`
                    : undefined,
                  description: (it.description ?? '').slice(0, 500),
                  url: it.url ?? url,
                  source: 'JobTopGun',
                  postedAt: it.datePosted,
                });
                found++;
              }
            }
          } catch { /* skip */ }
        });
        if (found > 0) break;

        // Cheerio selectors
        const selectors = [
          '.job-list-item', '[class*="job-item"]', '[class*="job-card"]',
          '[class*="JobItem"]', '[class*="position"]', 'tr[class*="job"]',
          'div[id*="job"]',
        ];
        const items: RawJob[] = [];
        for (const sel of selectors) {
          $(sel).each((_, el) => {
            const $e = $(el);
            const titleEl = $e.find('a[class*="title"],h2 a,h3 a,a[class*="position"],a[class*="job"]').first();
            const title = titleEl.text().trim() || $e.find('h2,h3').first().text().trim();
            if (!title || title.length < 3) return;
            const href = titleEl.attr('href') ?? $e.find('a').first().attr('href') ?? '';
            items.push({
              title,
              company: $e.find('[class*="company"],[class*="employer"]').first().text().trim(),
              location: $e.find('[class*="location"],[class*="province"]').first().text().trim() || 'ไทย',
              salary: $e.find('[class*="salary"],[class*="wage"]').first().text().trim() || undefined,
              description: $e.find('p,[class*="desc"]').first().text().trim(),
              url: href.startsWith('http') ? href : `${BASE}${href}`,
              source: 'JobTopGun',
            });
          });
          if (items.length > 0) break;
        }
        if (items.length > 0) { jobs.push(...items); found = items.length; break; }
      } catch (e: any) {
        if (e?.response?.status === 404) continue;
        console.error('[JobTopGun]', e.message);
      }
    }

    if (found === 0) break;
    await sleep(800);
  }

  return jobs;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
