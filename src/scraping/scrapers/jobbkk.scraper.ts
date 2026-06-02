/**
 * Jobbkk.com scraper – https://www.jobbkk.com
 * Strategy: HTML scrape from search page
 *   URL: https://www.jobbkk.com/หางาน/ไอที?keyword={KEYWORD}
 *   Cards: [data-job-id] elements — each has data-com-id + data-job-id
 *
 * HR email: scraped from job detail page (same as JobThai pattern)
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { RawJob } from '../dto/raw-job.dto';
import { ScanFiltersDto } from '../../scan/dto/scan-filters.dto';

const BASE = 'https://www.jobbkk.com';
const EMAIL_RE = /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,10}\b/g;
const NOISE_EMAIL_DOMAINS = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'jobbkk.com'];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
};

/** Clean company name extracted from image alt text */
function cleanCompany(alt: string): string {
  return alt.replace(/หางาน,สมัครงาน,งาน\s*/g, '').trim();
}

/** Scrape HR email from job detail page */
async function scrapeDetailEmail(url: string): Promise<string[]> {
  try {
    const { data: html } = await axios.get(url, { headers: HEADERS, timeout: 10000 });
    const emails = [...new Set((html as string).match(EMAIL_RE) ?? [])];
    return emails.filter((e) => {
      const domain = e.split('@')[1]?.toLowerCase() ?? '';
      return !NOISE_EMAIL_DOMAINS.includes(domain);
    });
  } catch {
    return [];
  }
}

function parseCards(html: string, province?: string): RawJob[] {
  const $ = cheerio.load(html);
  const jobs: RawJob[] = [];

  $('[data-job-id]').each((_, el) => {
    const $card = $(el);
    const comId = $card.attr('data-com-id') ?? '';
    const jobId = $card.attr('data-job-id') ?? '';

    // Title: first job detail link
    const titleLink = $card.find('a[href*="/jobs/detail"], a[href*="/jobs/detailurgent"]').first();
    const title = titleLink.text().trim();
    if (!title || title.length < 3) return;

    // URL
    const href = titleLink.attr('href') ?? '';
    const url = href.startsWith('http') ? href : `${BASE}${href}`;

    // Company: from img alt (strip Thai boilerplate prefix)
    const imgAlt = $card.find('.joblist-logo-company img').first().attr('alt') ?? '';
    const company = cleanCompany(imgAlt) || $card.find('a[href*="/company/"]').first().text().trim();

    // Salary: last span in .position-salary
    const salary = $card.find('.position-salary span').last().text().trim() || undefined;

    // Location: .position-location link
    const location = $card.find('.position-location a').first().text().trim()
      || province || 'ไทย';

    // Posted date (if available)
    const postedAt = $card.find('time').attr('datetime')
      || $card.find('[class*="date"]').first().text().trim() || undefined;

    jobs.push({ title, company, location, salary, url, source: 'Jobbkk', postedAt, hrEmails: [] });
  });

  return jobs;
}

export async function scrapeJobbkk(f: ScanFiltersDto, maxPages = 3): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  const keyword = f.keywords ?? '';

  for (let page = 1; page <= maxPages; page++) {
    try {
      // Primary URL: IT category page (most relevant for dev/tech jobs)
      const params = new URLSearchParams();
      if (keyword) params.set('keyword', keyword);
      if (f.salaryMin && f.salaryMin > 0) params.set('salary_min', String(f.salaryMin));
      if (page > 1) params.set('page', String(page));

      const url = `${BASE}/หางาน/ไอที?${params}`;
      const { data: html } = await axios.get(url, { headers: HEADERS, timeout: 15000, maxRedirects: 5 });

      const pageJobs = parseCards(html, f.province);
      if (pageJobs.length === 0) break;

      jobs.push(...pageJobs);
      if (pageJobs.length < 10) break; // last page

      await sleep(900);
    } catch (err: any) {
      console.error('[Jobbkk]', err.message);
      break;
    }
  }

  return jobs;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
