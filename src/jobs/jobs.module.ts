import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobMatch } from './job-match.entity';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';

@Module({
  imports: [TypeOrmModule.forFeature([JobMatch])],
  providers: [JobsService],
  controllers: [JobsController],
})
export class JobsModule {}
