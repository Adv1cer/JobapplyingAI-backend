import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Resume } from './resume.entity';
import { ScanSession } from '../scan/scan-session.entity';
import { ResumeService } from './resume.service';
import { ResumeController } from './resume.controller';
import { QUEUE_JOB_SYNC } from '../queues/queues.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([Resume, ScanSession]),
    BullModule.registerQueue({ name: QUEUE_JOB_SYNC }),
  ],
  providers: [ResumeService],
  controllers: [ResumeController],
  exports: [ResumeService],
})
export class ResumeModule {}
