import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CompanyVerifyService } from './company-verify.service';
import { HrEmailService } from './hr-email.service';

@Module({
  imports: [ConfigModule],
  providers: [CompanyVerifyService, HrEmailService],
  exports: [CompanyVerifyService, HrEmailService],
})
export class ScrapingModule {}
