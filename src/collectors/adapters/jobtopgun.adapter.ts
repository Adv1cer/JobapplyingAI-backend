import { Injectable, Logger } from '@nestjs/common';
import { BaseJobAdapter } from './base.adapter';
import { NormalizedJob } from '../../common/interfaces/job.interface';
import { ScanFiltersDto } from '../../scan/dto/scan-filters.dto';
import { scrapeJobTopGun } from '../../scraping/scrapers/jobtopgun.scraper';

@Injectable()
export class JobTopGunAdapter extends BaseJobAdapter {
  readonly sourceName = 'JobTopGun';
  protected readonly logger = new Logger(JobTopGunAdapter.name);

  async collect(filters: ScanFiltersDto, maxPages = 3): Promise<NormalizedJob[]> {
    if (filters.country === 'international') return [];
    const raw = await scrapeJobTopGun(filters, maxPages);
    return raw.map((j) => ({
      id: this.generateId('jobtopgun', j.url || `${j.title}_${j.company}`),
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
