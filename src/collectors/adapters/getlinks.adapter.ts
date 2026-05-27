import { Injectable, Logger } from '@nestjs/common';
import { BaseJobAdapter } from './base.adapter';
import { NormalizedJob } from '../../common/interfaces/job.interface';
import { ScanFiltersDto } from '../../scan/dto/scan-filters.dto';
import { scrapeGetLinks } from '../../scraping/scrapers/getlinks.scraper';

@Injectable()
export class GetLinksAdapter extends BaseJobAdapter {
  readonly sourceName = 'GetLinks';
  protected readonly logger = new Logger(GetLinksAdapter.name);

  async collect(filters: ScanFiltersDto, maxPages = 2): Promise<NormalizedJob[]> {
    const raw = await scrapeGetLinks(filters, maxPages);
    return raw.map((j) => ({
      id: this.generateId(j.source?.toLowerCase() ?? 'getlinks', `${j.title}_${j.company}`),
      source: j.source ?? this.sourceName,
      title: j.title,
      company: j.company,
      location: j.location,
      description: j.description ?? '',
      skills: this.normalizeSkills(j.description ?? ''),
      salary: j.salary,
      jobType: j.jobType,
      remote: (j.location ?? '').toLowerCase().includes('remote'),
      url: j.url,
      hrEmails: [],
      postedAt: j.postedAt,
      createdAt: new Date(),
    }));
  }
}
