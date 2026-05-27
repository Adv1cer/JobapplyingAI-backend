import { Injectable, Logger } from '@nestjs/common';
import { BaseJobAdapter } from './base.adapter';
import { NormalizedJob } from '../../common/interfaces/job.interface';
import { ScanFiltersDto } from '../../scan/dto/scan-filters.dto';
import { scrapeJobbkk } from '../../scraping/scrapers/jobbkk.scraper';

@Injectable()
export class JobbkkAdapter extends BaseJobAdapter {
  readonly sourceName = 'Jobbkk';
  protected readonly logger = new Logger(JobbkkAdapter.name);

  async collect(filters: ScanFiltersDto, maxPages = 3): Promise<NormalizedJob[]> {
    const raw = await scrapeJobbkk(filters, maxPages);
    return raw.map((j) => ({
      id: this.generateId('jobbkk', j.url || `${j.title}_${j.company}`),
      source: this.sourceName,
      title: j.title,
      company: j.company,
      location: j.location,
      description: j.description ?? '',
      skills: this.normalizeSkills(j.description ?? ''),
      salary: j.salary,
      jobType: j.jobType,
      remote: false,
      url: j.url,
      hrEmails: j.hrEmails ?? [],
      postedAt: j.postedAt,
      createdAt: new Date(),
    }));
  }
}
