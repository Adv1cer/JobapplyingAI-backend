import { Module } from '@nestjs/common';
import { CompanyVerifyService } from './company-verify.service';
import { HrEmailService } from './hr-email.service';

@Module({
  providers: [CompanyVerifyService, HrEmailService],
  exports: [CompanyVerifyService, HrEmailService],
})
export class ScrapingModule {}
