import { Injectable, Logger } from '@nestjs/common';
import { BaseJobAdapter } from './base.adapter';
import { NormalizedJob } from '../../common/interfaces/job.interface';
import { ScanFiltersDto } from '../../scan/dto/scan-filters.dto';
import { scrapeBlognoneJobs } from '../../scraping/scrapers/blognone.scraper';

@Injectable()
export class BlognoneAdapter extends BaseJobAdapter {
  readonly sourceName = 'Blognone Jobs';
  protected readonly logger = new Logger(BlognoneAdapter.name);

  async collect(filters: ScanFiltersDto, maxPages = 2): Promise<NormalizedJob[]> {
    const raw = await scrapeBlognoneJobs(filters, maxPages);
    return raw.map((j) => ({
      id: this.generateId('blognone', `${j.title}_${j.company}`),
      source: this.sourceName,
      title: j.title,
      company: j.company,
      location: j.location,
      description: j.description ?? '',
      skills: this.normalizeSkills(j.description ?? ''),
      salary: j.salary,
      remote: false,
      url: j.url,
      hrEmails: [],
      postedAt: j.postedAt,
      createdAt: new Date(),
    }));
  }
}
