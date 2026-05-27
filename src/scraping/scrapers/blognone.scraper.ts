/**
 * Blognone Jobs scraper
 * Thailand's biggest tech/software job board
 * URL: https://www.blognone.com/jobs  (main site, NOT jobs.blognone.com)
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { RawJob } from '../dto/raw-job.dto';
import { ScanFiltersDto } from '../../scan/dto/scan-filters.dto';

const BASES = [
  'https://www.blognone.com',
  'https://jobs.blognone.com',
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

function extractFromNextData(html: string, fallbackBase: string): RawJob[] {
  try {
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return [];
    const nd = JSON.parse(m[1]);
    const pp = nd?.props?.pageProps ?? {};
    const items: any[] =
      pp.jobs ?? pp.jobList ?? pp.data?.jobs ?? pp.jobPosts ?? pp.results ?? [];
    return items.map((it: any) => ({
      title: it.title ?? it.position ?? '',
      company: it.company?.name ?? it.companyName ?? it.company ?? '',
      location: it.location ?? it.province ?? 'ไทย',
      salary: it.salary ?? it.salaryRange ?? undefined,
      jobType: it.jobType ?? it.type ?? undefined,
      description: (it.description ?? it.detail ?? it.snippet ?? '').slice(0, 600),
      url: it.url ?? it.link ?? (it.id ? `${fallbackBase}/jobs/${it.id}` : fallbackBase),
      source: 'Blognone Jobs',
      postedAt: it.publishedAt ?? it.createdAt ?? it.date,
    })).filter((j) => j.title.length > 2);
  } catch { return []; }
}

function extractFromHtml($: ReturnType<typeof cheerio.load>, base: string): RawJob[] {
  const jobs: RawJob[] = [];

  // Try every plausible card selector
  const selectors = [
    'article', '.job-card', '.job-item', '.job-listing',
    '[class*="JobCard"]', '[class*="job-card"]', '[class*="job-item"]',
    'li[class*="job"]', '.card', '.post',
  ];

  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const $e = $(el);
      const titleEl = $e.find('h1 a, h2 a, h3 a, a[class*="title"], a[class*="position"]').first();
      const title = titleEl.text().trim() || $e.find('h1,h2,h3').first().text().trim();
      if (!title || title.length < 3) return;

      const href = titleEl.attr('href') ?? $e.find('a').first().attr('href') ?? '';
      const company = $e.find('[class*="company"],[class*="employer"],[class*="Company"]').first().text().trim();
      const salary  = $e.find('[class*="salary"],[class*="wage"]').first().text().trim() || undefined;
      const desc    = $e.find('p,[class*="desc"],[class*="detail"],[class*="snippet"]').first().text().trim();
      const postedAt = $e.find('time').attr('datetime') ?? $e.find('[class*="date"],[class*="time"]').first().text().trim();

      jobs.push({
        title, company,
        location: $e.find('[class*="location"],[class*="place"]').first().text().trim() || 'ไทย',
        salary, description: desc,
        url: href.startsWith('http') ? href : `${base}${href}`,
        source: 'Blognone Jobs',
        postedAt: postedAt || undefined,
      });
    });
    if (jobs.length > 0) return jobs;
  }

  // JSON-LD fallback
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
            description: (it.description ?? '').slice(0, 400),
            url: it.url ?? base,
            source: 'Blognone Jobs',
            postedAt: it.datePosted,
          });
        }
      }
    } catch { /* skip */ }
  });

  return jobs;
}

export async function scrapeBlognoneJobs(f: ScanFiltersDto, maxPages = 2): Promise<RawJob[]> {
  const jobs: RawJob[] = [];

  for (let page = 1; page <= maxPages; page++) {
    let fetched = false;

    for (const base of BASES) {
      const params = new URLSearchParams();
      if (f.keywords) { params.set('q', f.keywords); params.set('keyword', f.keywords); }
      if (page > 1) params.set('page', String(page));

      const paths = base.includes('blognone.com') && !base.includes('jobs.')
        ? [`${base}/jobs?${params}`, `${base}/job?${params}`]
        : [`${base}/jobs?${params}`, `${base}/?${params}`];

      for (const url of paths) {
        try {
          const { data: html } = await axios.get(url, {
            headers: { ...HEADERS, Referer: base + '/' },
            timeout: 15000,
            maxRedirects: 5,
          });

          const fromNext = extractFromNextData(html, base);
          if (fromNext.length > 0) {
            jobs.push(...fromNext);
            fetched = true;
            break;
          }

          const $ = cheerio.load(html);
          const fromHtml = extractFromHtml($, base);
          if (fromHtml.length > 0) {
            jobs.push(...fromHtml);
            fetched = true;
            break;
          }
        } catch (e: any) {
          if (e?.response?.status === 404) continue;
          console.error('[Blognone]', e.message);
        }
      }
      if (fetched) break;
    }

    if (!fetched) break;
    await sleep(700);
  }

  return jobs;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
