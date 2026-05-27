/**
 * JSearch Adapter — RapidAPI JSearch
 * Aggregates jobs from LinkedIn, Indeed, Glassdoor, ZipRecruiter & more
 * Docs: https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
 *
 * Sign up free at: https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
 * Set env: JSEARCH_API_KEY=your_rapidapi_key
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { BaseJobAdapter } from './base.adapter';
import { NormalizedJob } from '../../common/interfaces/job.interface';
import { ScanFiltersDto } from '../../scan/dto/scan-filters.dto';
import { sleep } from '../../common/utils/retry.util';

const BASE_URL = 'https://jsearch.p.rapidapi.com/search';
const PAGE_SIZE = 10; // JSearch returns max 10 per page on free tier

const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  full_time: 'FULLTIME',
  part_time: 'PARTTIME',
  contract: 'CONTRACTOR',
  freelance: 'CONTRACTOR',
  internship: 'INTERN',
};

const DATE_POSTED_MAP: Record<number, string> = {
  1: 'today',
  3: '3days',
  7: 'week',
  14: 'month',
  30: 'month',
};

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const SKIP_DOMAINS = ['jsearch', 'rapidapi', 'indeed', 'linkedin', 'glassdoor', 'ziprecruiter', 'google'];

@Injectable()
export class JSearchAdapter extends BaseJobAdapter {
  readonly sourceName = 'JSearch';
  protected readonly logger = new Logger(JSearchAdapter.name);

  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    super();
    this.apiKey = this.config.get<string>('JSEARCH_API_KEY') ?? '';
  }

  async collect(filters: ScanFiltersDto, maxPages = 3): Promise<NormalizedJob[]> {
    if (!this.apiKey) {
      this.logger.warn('JSEARCH_API_KEY not set — skipping JSearch');
      return [];
    }

    const country = filters.country ?? 'TH';
    const jobs: NormalizedJob[] = [];

    // Build queries — TH searches in Thailand, international searches globally
    const queries: string[] = [];
    if (country === 'TH' || country === 'all') {
      const loc = filters.province ? `in ${filters.province}, Thailand` : 'in Thailand';
      queries.push(`${filters.keywords || 'software developer'} ${loc}`);
    }
    if (country === 'international' || country === 'all') {
      queries.push(`${filters.keywords || 'software developer'} remote`);
    }

    for (const query of queries) {
      for (let page = 1; page <= maxPages; page++) {
        try {
          const params: Record<string, string> = {
            query,
            page: String(page),
            num_pages: '1',
          };

          if (filters.jobType) {
            const et = EMPLOYMENT_TYPE_MAP[filters.jobType];
            if (et) params.employment_types = et;
          }
          if (filters.postedWithin) {
            params.date_posted = DATE_POSTED_MAP[filters.postedWithin] ?? 'month';
          }
          if (filters.salaryMin) {
            // JSearch doesn't support salary filter directly — skip
          }

          const { data } = await axios.get(BASE_URL, {
            params,
            headers: {
              'X-RapidAPI-Key': this.apiKey,
              'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
            },
            timeout: 15000,
          });

          const items: any[] = data?.data ?? [];
          if (items.length === 0) break;

          for (const it of items) {
            const description = it.job_description ?? '';
            const highlights: string[] = [
              ...(it.job_highlights?.Qualifications ?? []),
              ...(it.job_highlights?.Responsibilities ?? []),
              ...(it.job_highlights?.Benefits ?? []),
            ];
            const fullText = [description, ...highlights].join(' ');

            const salary = this.buildSalary(it);
            const hrEmails = this.extractEmails(fullText);
            const skills = it.job_required_skills?.length
              ? it.job_required_skills
              : this.normalizeSkills(fullText);

            // Determine source label from publisher
            const publisher = it.job_publisher ?? 'JSearch';
            const sourceLabel = this.normalizePublisher(publisher);

            jobs.push({
              id: this.generateId('jsearch', it.job_id),
              source: sourceLabel,
              externalId: it.job_id,
              title: it.job_title ?? '',
              company: it.employer_name ?? '',
              location: this.buildLocation(it),
              description: description.slice(0, 600),
              skills,
              salary,
              jobType: it.job_employment_type
                ? this.normalizeJobType(it.job_employment_type)
                : undefined,
              remote: it.job_is_remote ?? fullText.toLowerCase().includes('remote'),
              url: it.job_apply_link ?? it.job_google_link ?? '',
              hrEmails,
              postedAt: it.job_posted_at_datetime_utc,
              createdAt: new Date(),
            });
          }

          if (items.length < PAGE_SIZE) break;
          await sleep(500); // respect rate limit
        } catch (err: any) {
          this.logger.error(`[JSearch query="${query}" page=${page}]: ${err.message}`);
          if (err?.response?.status === 429) {
            // Rate limited — wait and retry once
            await sleep(3000);
          }
          break;
        }
      }
    }

    return jobs;
  }

  private buildSalary(it: any): string | undefined {
    const min = it.job_min_salary;
    const max = it.job_max_salary;
    const currency = it.job_salary_currency ?? '';
    const period = it.job_salary_period ?? '';
    if (!min && !max) return undefined;

    const fmt = (n: number) => Number(n).toLocaleString();
    const range = max && max !== min ? `${fmt(min)} – ${fmt(max)}` : `${fmt(min)}`;
    const suffix = period === 'MONTH' ? '/เดือน' : period === 'YEAR' ? '/ปี' : '';
    return `${range} ${currency}${suffix}`.trim();
  }

  private buildLocation(it: any): string {
    const parts = [it.job_city, it.job_state, it.job_country].filter(Boolean);
    return parts.join(', ') || 'Thailand';
  }

  private normalizeJobType(type: string): string {
    const map: Record<string, string> = {
      FULLTIME: 'Full-time',
      PARTTIME: 'Part-time',
      CONTRACTOR: 'Contract',
      INTERN: 'Internship',
    };
    return map[type] ?? type;
  }

  private normalizePublisher(publisher: string): string {
    const lower = publisher.toLowerCase();
    if (lower.includes('linkedin')) return 'LinkedIn';
    if (lower.includes('indeed')) return 'Indeed';
    if (lower.includes('glassdoor')) return 'Glassdoor';
    if (lower.includes('ziprecruiter')) return 'ZipRecruiter';
    return publisher;
  }

  private extractEmails(text: string): string[] {
    const found = text.match(EMAIL_REGEX) ?? [];
    return [...new Set(found.filter((e) => {
      const domain = e.split('@')[1]?.toLowerCase() ?? '';
      return !SKIP_DOMAINS.some((d) => domain.includes(d));
    }))];
  }
}
