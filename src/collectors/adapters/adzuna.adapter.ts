/**
 * Jooble Adapter — free job search API with Thailand support
 * Docs: https://jooble.org/api/about
 *
 * Register at: https://jooble.org/api/about  (free, just fill the form)
 * Set env: JOOBLE_API_KEY=your_key
 *
 * POST https://th.jooble.org/api/{apiKey}
 * Body: { "keywords": "...", "location": "Bangkok", "page": 1 }
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { BaseJobAdapter } from './base.adapter';
import { NormalizedJob } from '../../common/interfaces/job.interface';
import { ScanFiltersDto } from '../../scan/dto/scan-filters.dto';
import { sleep } from '../../common/utils/retry.util';

const BASE_URL = 'https://jooble.org/api';
const PAGE_SIZE = 20;

@Injectable()
export class AdzunaAdapter extends BaseJobAdapter {
  readonly sourceName = 'Jooble';
  protected readonly logger = new Logger(AdzunaAdapter.name);

  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    super();
    this.apiKey = this.config.get<string>('JOOBLE_API_KEY') ?? '';
  }

  async collect(filters: ScanFiltersDto, maxPages = 3): Promise<NormalizedJob[]> {
    if (!this.apiKey) {
      this.logger.warn('JOOBLE_API_KEY not set — skipping Jooble');
      return [];
    }

    // Jooble is Thai-only in this adapter
    if (filters.country === 'international') return [];

    const jobs: NormalizedJob[] = [];

    for (let page = 1; page <= maxPages; page++) {
      try {
        const body: Record<string, unknown> = {
          keywords: filters.keywords || 'developer',
          location: filters.province ? `${filters.province}, Thailand` : 'Thailand',
          page,
        };
        if (filters.salaryMin) body.salary = filters.salaryMin;

        const { data } = await axios.post(`${BASE_URL}/${this.apiKey}`, body, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          timeout: 15000,
        });

        const items: any[] = data?.jobs ?? [];
        if (items.length === 0) break;

        for (const it of items) {
          const description = it.snippet ?? it.description ?? '';
          jobs.push({
            id: this.generateId('jooble', it.id ?? it.link ?? `${it.title}_${it.company}`),
            source: this.sourceName,
            externalId: String(it.id ?? ''),
            title: it.title ?? '',
            company: it.company ?? '',
            location: it.location ?? filters.province ?? 'Thailand',
            description: description.slice(0, 600),
            skills: this.normalizeSkills(description),
            salary: it.salary || undefined,
            jobType: it.type || undefined,
            remote: description.toLowerCase().includes('remote') || it.type?.toLowerCase().includes('remote'),
            url: it.link ?? '',
            hrEmails: [],
            postedAt: it.updated,
            createdAt: new Date(),
          });
        }

        if (items.length < PAGE_SIZE) break;
        await sleep(500);
      } catch (err: any) {
        this.logger.error(`[Jooble page ${page}]: ${err.message}`);
        break;
      }
    }

    return jobs;
  }
}
