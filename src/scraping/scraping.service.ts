import { Injectable, Logger } from '@nestjs/common';
import { CompanyVerifyService } from './company-verify.service';

@Injectable()
export class ScrapingService {
  private readonly logger = new Logger(ScrapingService.name);

  constructor(private readonly companyVerify: CompanyVerifyService) {}

  async verifyCompany(companyName: string) {
    return this.companyVerify.verify(companyName);
  }
}
