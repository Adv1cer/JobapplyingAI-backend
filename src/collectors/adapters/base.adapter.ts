import { Logger } from '@nestjs/common';
import { NormalizedJob } from '../../common/interfaces/job.interface';
import { ScanFiltersDto } from '../../scan/dto/scan-filters.dto';
import { JobCollector } from '../interfaces/job-collector.interface';
import { withRetry } from '../../common/utils/retry.util';

export abstract class BaseJobAdapter implements JobCollector {
  abstract readonly sourceName: string;
  protected abstract readonly logger: Logger;

  abstract collect(filters: ScanFiltersDto, maxPages?: number): Promise<NormalizedJob[]>;

  protected async collectWithRetry(filters: ScanFiltersDto, maxPages = 3): Promise<NormalizedJob[]> {
    try {
      return await withRetry(() => this.collect(filters, maxPages), 3, 1000);
    } catch (err: any) {
      this.logger.warn(`[${this.sourceName}] Collection failed: ${err.message}`);
      return [];
    }
  }

  protected normalizeSkills(description: string, existingSkills: string[] = []): string[] {
    if (existingSkills.length > 0) return existingSkills;

    const techKeywords = [
      'JavaScript', 'TypeScript', 'Python', 'Java', 'Go', 'Rust', 'PHP', 'Ruby',
      'React', 'Vue', 'Angular', 'Next.js', 'Node.js', 'NestJS', 'Express',
      'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Elasticsearch',
      'Docker', 'Kubernetes', 'AWS', 'GCP', 'Azure',
      'REST', 'GraphQL', 'gRPC', 'Kafka', 'RabbitMQ',
      'Git', 'CI/CD', 'Linux', 'Terraform',
    ];

    const lower = description.toLowerCase();
    return techKeywords.filter((kw) => lower.includes(kw.toLowerCase()));
  }

  protected generateId(source: string, externalId: string): string {
    return `${source.toLowerCase()}_${externalId}`;
  }
}
