import { IsString, IsOptional, IsNumber, IsIn, IsBoolean } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class ScanFiltersDto {
  @IsString()
  @IsOptional()
  keywords?: string;

  /** 'TH' = ไทยเท่านั้น | 'international' = ตปท | 'all' = ทั้งหมด (default: 'TH') */
  @IsIn(['TH', 'international', 'all'])
  @IsOptional()
  country?: 'TH' | 'international' | 'all';

  @IsString()
  @IsOptional()
  province?: string;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  salaryMin?: number;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  salaryMax?: number;

  @IsIn(['full_time', 'part_time', 'contract', 'freelance', 'internship'])
  @IsOptional()
  jobType?: string;

  @IsIn([1, 3, 7, 14, 30])
  @IsOptional()
  @Type(() => Number)
  postedWithin?: number; // days

  /**
   * force=true  → bypass cooldown and run a fresh scan
   * force=false (default) → return cached results if last scan < SCAN_COOLDOWN_MINUTES
   */
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  force?: boolean;
}
