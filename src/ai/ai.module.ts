import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobEmbedding } from '../jobs/entities/job-embedding.entity';
import { Job } from '../jobs/entities/job.entity';
import { EmbeddingService } from './services/embedding.service';
import { MatchingService } from './services/matching.service';
import { CoverLetterService } from './services/cover-letter.service';

@Module({
  imports: [TypeOrmModule.forFeature([JobEmbedding, Job])],
  providers: [EmbeddingService, MatchingService, CoverLetterService],
  exports: [EmbeddingService, MatchingService, CoverLetterService],
})
export class AiModule {}
