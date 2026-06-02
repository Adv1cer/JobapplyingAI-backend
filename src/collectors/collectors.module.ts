import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Job } from '../jobs/entities/job.entity';
import { CollectorsService } from './collectors.service';
import { JobsDBAdapter }    from './adapters/jobsdb.adapter';
import { JobThaiAdapter }   from './adapters/jobthai.adapter';
import { JobbkkAdapter }    from './adapters/jobbkk.adapter';
import { JobTopGunAdapter } from './adapters/jobtopgun.adapter';

@Module({
  imports: [TypeOrmModule.forFeature([Job])],
  providers: [
    CollectorsService,
    JobsDBAdapter,
    JobThaiAdapter,
    JobbkkAdapter,
    JobTopGunAdapter,
  ],
  exports: [CollectorsService],
})
export class CollectorsModule {}
