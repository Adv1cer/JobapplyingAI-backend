import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { BaseJobAdapter } from './base.adapter';
import { NormalizedJob } from '../../common/interfaces/job.interface';
import { ScanFiltersDto } from '../../scan/dto/scan-filters.dto';
import { sleep } from '../../common/utils/retry.util';

const BASE_URL = 'https://boards-api.greenhouse.io/v1/boards';

@Injectable()
export class GreenhouseAdapter extends BaseJobAdapter {
  readonly sourceName = 'Greenhouse';
  protected readonly logger = new Logger(GreenhouseAdapter.name);

  // Tech companies that expose Greenhouse boards publicly
  private readonly boardTokens = [
    'anthropic', 'stripe', 'airbnb', 'figma', 'notion', 'linear',
    'vercel', 'planetscale', 'supabase', 'clerk',
  ];

  async collect(filters: ScanFiltersDto, _maxPages = 3): Promise<NormalizedJob[]> {
    const keywords = (filters.keywords ?? '').toLowerCase();
    const jobs: NormalizedJob[] = [];

    for (const token of this.boardTokens) {
      try {
        const res = await axios.get<{ jobs: any[] }>(`${BASE_URL}/${token}/jobs`, {
          params: { content: true },
          timeout: 10_000,
          headers: { Accept: 'application/json' },
        });

        const filtered = (res.data?.jobs ?? []).filter((j: any) => {
          if (!keywords) return true;
          const haystack = `${j.title} ${j.location?.name ?? ''} ${j.content ?? ''}`.toLowerCase();
          return keywords.split(' ').some((kw) => haystack.includes(kw));
        });

        for (const j of filtered.slice(0, 10)) {
          const description = this.stripHtml(j.content ?? '');
          jobs.push({
            id: this.generateId('greenhouse', String(j.id)),
            source: this.sourceName,
            externalId: String(j.id),
            title: j.title,
            company: token.charAt(0).toUpperCase() + token.slice(1),
            location: j.location?.name ?? 'Remote',
            description: description.slice(0, 800),
            skills: this.normalizeSkills(description),
            remote: (j.location?.name ?? '').toLowerCase().includes('remote'),
            url: j.absolute_url ?? `https://boards.greenhouse.io/${token}/jobs/${j.id}`,
            hrEmails: [],
            postedAt: j.updated_at,
            createdAt: new Date(),
          });
        }

        await sleep(300);
      } catch (err: any) {
        this.logger.warn(`[Greenhouse:${token}] ${err.message}`);
      }
    }

    return jobs;
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}
