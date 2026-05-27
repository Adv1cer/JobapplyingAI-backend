import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { BaseJobAdapter } from './base.adapter';
import { NormalizedJob } from '../../common/interfaces/job.interface';
import { ScanFiltersDto } from '../../scan/dto/scan-filters.dto';
import { sleep } from '../../common/utils/retry.util';

const BASE_URL = 'https://api.lever.co/v0/postings';

@Injectable()
export class LeverAdapter extends BaseJobAdapter {
  readonly sourceName = 'Lever';
  protected readonly logger = new Logger(LeverAdapter.name);

  private readonly companies = [
    'netflix', 'shopify', 'atlassian', 'hashicorp', 'datadog',
    'cloudflare', 'postman', 'segment', 'mixpanel',
  ];

  async collect(filters: ScanFiltersDto, _maxPages = 3): Promise<NormalizedJob[]> {
    const keywords = (filters.keywords ?? '').toLowerCase();
    const jobs: NormalizedJob[] = [];

    for (const company of this.companies) {
      try {
        const res = await axios.get<any[]>(`${BASE_URL}/${company}`, {
          params: { mode: 'json' },
          timeout: 10_000,
          headers: { Accept: 'application/json' },
        });

        const filtered = (res.data ?? []).filter((j: any) => {
          if (!keywords) return true;
          const haystack = `${j.text} ${j.categories?.location ?? ''} ${j.descriptionPlain ?? ''}`.toLowerCase();
          return keywords.split(' ').some((kw) => haystack.includes(kw));
        });

        for (const j of filtered.slice(0, 10)) {
          const description = j.descriptionPlain ?? j.description ?? '';
          const location = j.categories?.location ?? j.workplaceType ?? 'Remote';

          jobs.push({
            id: this.generateId('lever', j.id),
            source: this.sourceName,
            externalId: j.id,
            title: j.text,
            company: company.charAt(0).toUpperCase() + company.slice(1),
            location,
            description: description.slice(0, 800),
            skills: this.normalizeSkills(description),
            jobType: j.categories?.commitment,
            remote: location.toLowerCase().includes('remote') || j.workplaceType === 'remote',
            url: j.hostedUrl ?? `https://jobs.lever.co/${company}/${j.id}`,
            hrEmails: [],
            postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
            createdAt: new Date(),
          });
        }

        await sleep(300);
      } catch (err: any) {
        this.logger.warn(`[Lever:${company}] ${err.message}`);
      }
    }

    return jobs;
  }
}
