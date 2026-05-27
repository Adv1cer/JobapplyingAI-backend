import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { CompanyInfo } from './dto/raw-job.dto';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,*/*;q=0.9',
  'Accept-Language': 'th-TH,th;q=0.9',
};

// In-memory cache to avoid hammering the site for the same company
const cache = new Map<string, CompanyInfo>();

@Injectable()
export class CompanyVerifyService {
  async verify(companyName: string): Promise<CompanyInfo> {
    const key = companyName.trim().toLowerCase();
    if (cache.has(key)) return cache.get(key)!;

    const result = await this.lookup(companyName);
    cache.set(key, result);
    return result;
  }

  private async lookup(companyName: string): Promise<CompanyInfo> {
    try {
      // Step 1: Search for the company
      const searchUrl = `https://www.dataforthai.com/search?q=${encodeURIComponent(companyName)}`;
      const { data: searchHtml } = await axios.get(searchUrl, {
        headers: HEADERS,
        timeout: 12000,
      });

      const $s = cheerio.load(searchHtml);

      // Find first company link
      let companyPath: string | undefined;
      $s('a[href*="/company/"]').each((_, el) => {
        if (!companyPath) {
          companyPath = $s(el).attr('href');
        }
      });

      if (!companyPath) {
        return { found: false };
      }

      await sleep(600);

      // Step 2: Get company detail page
      const detailUrl = companyPath.startsWith('http')
        ? companyPath
        : `https://www.dataforthai.com${companyPath}`;

      const { data: detailHtml } = await axios.get(detailUrl, {
        headers: HEADERS,
        timeout: 12000,
      });

      const $d = cheerio.load(detailHtml);

      // Parse company data table
      const info: CompanyInfo = { found: true };

      // Scan all table rows / definition lists
      $d('tr, dl dt, .info-row').each((_, el) => {
        const text = $d(el).text().toLowerCase();
        const next = $d(el).next().text().trim() ||
                     $d(el).find('td:last-child, dd').text().trim();

        if (text.includes('เลขทะเบียน') || text.includes('ทะเบียนนิติ')) {
          info.taxId = next || $d(el).find('td').last().text().trim();
        } else if (text.includes('ประกอบธุรกิจ') || text.includes('ประเภทธุรกิจ')) {
          info.businessType = next;
        } else if (text.includes('สถานะ')) {
          info.status = next;
        } else if (text.includes('วันที่จดทะเบียน') || text.includes('จดทะเบียน')) {
          info.registrationDate = next;
        } else if (text.includes('ทุนจดทะเบียน') || text.includes('ทุน')) {
          info.registeredCapital = next;
        } else if (text.includes('ที่ตั้ง') || text.includes('สำนักงาน')) {
          info.address = next;
        } else if (text.includes('เว็บไซต์') || text.includes('website')) {
          info.website = next;
        }
      });

      // Also try parsing key-value pairs in divs
      if (!info.taxId) {
        $d('[class*="detail"], [class*="company-info"], .card-body').find('*').each((_, el) => {
          const label = $d(el).find('[class*="label"], strong, b').text().trim();
          const value = $d(el).find('[class*="value"], span:last-child').text().trim();
          if (label.includes('ทะเบียน') && value) info.taxId = value;
          if (label.includes('สถานะ') && value) info.status = value;
          if (label.includes('ทุน') && value) info.registeredCapital = value;
        });
      }

      return info;
    } catch (err: any) {
      console.error('[CompanyVerify]', companyName, err.message);
      return { found: false };
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
