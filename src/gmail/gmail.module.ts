import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GmailToken } from './entities/gmail-token.entity';
import { JobMatch } from '../jobs/entities/job-match.entity';
import { GmailService } from './gmail.service';
import { GmailController } from './gmail.controller';

@Module({
  imports: [TypeOrmModule.forFeature([GmailToken, JobMatch])],
  providers: [GmailService],
  controllers: [GmailController],
  exports: [GmailService],
})
export class GmailModule {}
