import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ScanSession } from './scan-session.entity';
import { ScanService } from './scan.service';
import { ScanController } from './scan.controller';
import { QUEUE_JOB_SYNC } from '../queues/queues.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([ScanSession]),
    BullModule.registerQueue({ name: QUEUE_JOB_SYNC }),
  ],
  providers: [ScanService],
  controllers: [ScanController],
})
export class ScanModule {}
