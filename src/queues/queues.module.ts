import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScanSession } from '../scan/scan-session.entity';
import { JobMatch } from '../jobs/entities/job-match.entity';
import { Job } from '../jobs/entities/job.entity';
import { JobEmbedding } from '../jobs/entities/job-embedding.entity';
import { Resume } from '../resume/resume.entity';
import { CollectorsModule } from '../collectors/collectors.module';
import { AiModule } from '../ai/ai.module';
import { JobSyncProcessor } from './processors/job-sync.processor';
import {
  QUEUE_JOB_SYNC,
  QUEUE_EMBEDDING,
  QUEUE_COVER_LETTER,
} from './queues.constants';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_JOB_SYNC, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 50, removeOnFail: 100 } },
      { name: QUEUE_EMBEDDING, defaultJobOptions: { attempts: 2, removeOnComplete: 100 } },
      { name: QUEUE_COVER_LETTER, defaultJobOptions: { attempts: 3, removeOnComplete: 50 } },
    ),
    TypeOrmModule.forFeature([ScanSession, JobMatch, Job, JobEmbedding, Resume]),
    CollectorsModule,
    AiModule,
  ],
  providers: [JobSyncProcessor],
  exports: [BullModule],
})
export class QueuesModule {}
