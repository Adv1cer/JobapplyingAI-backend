/**
 * JobTopGun scraper – https://www.jobtopgun.com
 * Strategy: POST to BFF REST API
 *   POST https://backend-bff.jobtopgun.com/api/v1/job
 *   Body: { keyword, page: 1, pageSize: 20, lang: 'th', cursor? }
 *   Pagination: cursor = integer returned as data.nextCursor
 *
 * Job URL: https://www.jobtopgun.com/th/jobtopgun/jobs/j{companyId}-{idPosition}
 */
import axios from 'axios';
import { RawJob } from '../dto/raw-job.dto';
import { ScanFiltersDto } from '../../scan/dto/scan-filters.dto';

const BFF = 'https://backend-bff.jobtopgun.com/api/v1/job';
const JOB_BASE = 'https://www.jobtopgun.com/th/jobtopgun/jobs/j';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'Origin': 'https://www.jobtopgun.com',
  'Referer': 'https://www.jobtopgun.com/th/jobs',
};

function normalizeItem(it: any, province?: string): RawJob | null {
  const title = it.positionName ?? it.job_title ?? '';
  if (!title || title.length < 3) return null;

  const companyId = it.companyId ?? '';
  const idPosition = it.idPosition ?? '';
  const url = companyId && idPosition
    ? `${JOB_BASE}${companyId}-${idPosition}`
    : 'https://www.jobtopgun.com/th/jobs';

  const location = it.location ?? province ?? 'ไทย';
  const salary = it.salary && it.salary !== 'Negotiable' && it.salary !== 'ตามตกลง'
    ? it.salary
    : undefined;

  return {
    title,
    company: it.companyName ?? '',
    location,
    salary,
    jobType: it.workType ?? it.jobType ?? undefined,
    description: (it.responsibilities ?? it.description ?? '').slice(0, 500),
    url,
    source: 'JobTopGun',
    postedAt: it.postedAt ?? undefined,
    hrEmails: [],
  };
}

export async function scrapeJobTopGun(f: ScanFiltersDto, maxPages = 3): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  let cursor: string | number | undefined;

  for (let page = 1; page <= maxPages; page++) {
    try {
      const body: Record<string, any> = {
        keyword: f.keywords ?? '',
        page: 1,
        pageSize: 20,
        lang: 'th',
      };
      if (cursor !== undefined) body.cursor = cursor;
      if (f.province) body.province = f.province;

      const { data: resp } = await axios.post(BFF, body, { headers: HEADERS, timeout: 15000 });

      const items: any[] = resp?.data?.jobs ?? [];
      cursor = resp?.data?.nextCursor;

      if (items.length === 0) break;

      for (const it of items) {
        const job = normalizeItem(it, f.province);
        if (job) jobs.push(job);
      }

      // API always returns 30 items, stop if no more cursor
      if (!cursor) break;

      await sleep(700);
    } catch (err: any) {
      console.error('[JobTopGun]', err.message);
      break;
    }
  }

  return jobs;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
