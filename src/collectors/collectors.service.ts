import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from '../jobs/entities/job.entity';
import { NormalizedJob } from '../common/interfaces/job.interface';
import { ScanFiltersDto } from '../scan/dto/scan-filters.dto';
import { JobsDBAdapter }    from './adapters/jobsdb.adapter';
import { JobThaiAdapter }   from './adapters/jobthai.adapter';
import { JobbkkAdapter }    from './adapters/jobbkk.adapter';
import { JobTopGunAdapter } from './adapters/jobtopgun.adapter';

function parseDate(value: string | undefined | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return isNaN(d.getTime()) ? undefined : d;
}

@Injectable()
export class CollectorsService {
  private readonly logger = new Logger(CollectorsService.name);

  constructor(
    @InjectRepository(Job)
    private readonly jobRepo: Repository<Job>,
    private readonly jobsdb:     JobsDBAdapter,
    private readonly jobthai:    JobThaiAdapter,
    private readonly jobbkk:     JobbkkAdapter,
    private readonly jobtopgun:  JobTopGunAdapter,
  ) {}

  async collectAll(filters: ScanFiltersDto): Promise<NormalizedJob[]> {
    const results = await Promise.allSettled([
      this.jobsdb.collect(filters, 3),
      this.jobthai.collect(filters, 3),
      this.jobbkk.collect(filters, 3),
      this.jobtopgun.collect(filters, 3),
    ]);

    const counts: Record<string, number> = {};
    const all: NormalizedJob[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        for (const job of result.value) {
          counts[job.source] = (counts[job.source] ?? 0) + 1;
          all.push(job);
        }
      } else {
        this.logger.warn(`Collector failed: ${result.reason}`);
      }
    }

    this.logger.log(`Collected ${all.length} jobs: ${JSON.stringify(counts)}`);
    return this.deduplicateJobs(all);
  }

  async upsertJobs(jobs: NormalizedJob[]): Promise<Job[]> {
    const saved: Job[] = [];
    for (const job of jobs) {
      try {
        const existing = await this.jobRepo.findOne({
          where: { externalId: job.externalId, source: job.source },
        });
        if (existing) {
          await this.jobRepo.update(existing.id, {
            title: job.title, description: job.description,
            skills: job.skills, salary: job.salary, remote: job.remote,
          });
          saved.push({ ...existing, ...job } as Job);
        } else {
          const entity = this.jobRepo.create({
            externalId: job.externalId, source: job.source,
            title: job.title, company: job.company, location: job.location,
            description: job.description, skills: job.skills,
            salary: job.salary, jobType: job.jobType,
            remote: job.remote ?? false, url: job.url,
            hrEmails: job.hrEmails ?? [],
            postedAt: parseDate(job.postedAt),
          });
          saved.push(await this.jobRepo.save(entity) as Job);
        }
      } catch (err: any) {
        this.logger.warn(`upsert failed for "${job.title}": ${err.message}`);
      }
    }
    return saved;
  }

  private deduplicateJobs(jobs: NormalizedJob[]): NormalizedJob[] {
    const seen = new Set<string>();
    return jobs.filter((j) => {
      if (!j.title) return false;
      const key = `${j.title.toLowerCase().trim()}_${j.company.toLowerCase().trim()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
