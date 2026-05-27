import { NormalizedJob } from '../../common/interfaces/job.interface';
import { ScanFiltersDto } from '../../scan/dto/scan-filters.dto';

export interface JobCollector {
  readonly sourceName: string;
  collect(filters: ScanFiltersDto, maxPages?: number): Promise<NormalizedJob[]>;
}

export const JOB_COLLECTOR = 'JOB_COLLECTOR';
