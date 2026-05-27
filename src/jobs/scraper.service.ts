import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';

export type JobResult = {
  title: string;
  link: string;
  snippet?: string;
};

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);

  // Best-effort site configs. You can customize paths/selectors per site later.
  private siteConfigs: Record<string, any> = {
    blognone: {
      name: 'Blognone Jobs',
      base: 'https://jobs.blognone.com',
      searchPaths: ['/?s=', '/search/?q=', '/?q='],
      selectors: ['article a', '.job-listing a', 'a'],
    },
    getlinks: {
      name: 'GetLinks',
      base: 'https://www.getlinks.com',
      searchPaths: ['/jobs?keyword=', '/search?keyword=', '/?q='],
      selectors: ['.job-item a', 'a'],
    },
    jobsdb: {
      name: 'JobsDB',
      base: 'https://th.jobsdb.com',
      searchPaths: ['/th/en/search-jobs?keywords=', '/search?keyword=', '/?q='],
      selectors: ['.job-title a', '.result a', 'a'],
    },
    techtalkthai: {
      name: 'TechTalkThai Jobs',
      base: 'https://jobs.techtalkthai.com',
      searchPaths: ['/search?keyword=', '/?q='],
      selectors: ['.job-list a', 'a'],
    },
    the1jobs: {
      name: 'The1Jobs',
      base: 'https://the1jobs.com',
      searchPaths: ['/search?keyword=', '/?q='],
      selectors: ['.job a', 'a'],
    },
    workventure: {
      name: 'WorkVenture',
      base: 'https://workventure.com',
      searchPaths: ['/jobs?keywords=', '/search?keyword=', '/?q='],
      selectors: ['.job-card a', 'a'],
    },
    jobtopgun: {
      name: 'JobTopGun',
      base: 'https://jobtopgun.com',
      searchPaths: ['/search?keyword=', '/?q='],
      selectors: ['.item a', 'a'],
    },
    jobthai: {
      name: 'JobThai',
      base: 'https://www.jobthai.com',
      searchPaths: ['/jobs/search?keyword=', '/?q='],
      selectors: ['.job a', 'a'],
    },
  };

  async searchSites(keyword: string, sites?: string[]): Promise<Record<string, JobResult[]>> {
    const selected = sites && sites.length ? sites : Object.keys(this.siteConfigs);
    const out: Record<string, JobResult[]> = {};

    for (const key of selected) {
      const cfg = this.siteConfigs[key];
      if (!cfg) {
        this.logger.warn(`No config for site key=${key}`);
        continue;
      }
      try {
        const items = await this.searchSite(cfg, keyword);
        out[cfg.name] = items;
      } catch (err: any) {
        this.logger.warn(`searchSites ${cfg.name} failed: ${err?.message ?? err}`);
        out[cfg.name] = [];
      }
    }

    return out;
  }

  private async searchSite(cfg: any, keyword: string): Promise<JobResult[]> {
    const tries = cfg.searchPaths || ['/?q='];
    const results: JobResult[] = [];

    for (const p of tries) {
      const url = cfg.base.replace(/\/$/, '') + p + encodeURIComponent(keyword);
      try {
        const resp = await axios.get(url, {
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; JobScraper/1.0; +https://example.com)'
          }
        });

        const $ = cheerio.load(resp.data);

        for (const sel of cfg.selectors) {
          $(sel).each((i, el) => {
            if (results.length >= 20) return;
            const $el = $(el);
            let a = $el.is('a') ? $el : $el.find('a').first();
            const href = a.attr('href') || '';
            const title = (a.text() || $el.text() || '').trim();
            if (!title) return;
            const textLower = title.toLowerCase();
            const kw = keyword.toLowerCase();
            if (textLower.includes(kw) || href.toLowerCase().includes('job') || href.toLowerCase().includes('career')) {
              results.push({ title, link: this.normalizeLink(cfg.base, href), snippet: $el.text().trim() });
            }
          });
          if (results.length) break;
        }

        if (results.length) return results.slice(0, 20);
      } catch (err: any) {
        this.logger.debug(`fetch ${url} failed: ${err?.message ?? err}`);
        // try next path
      }
    }

    return results;
  }

  private normalizeLink(base: string, href: string) {
    if (!href) return '';
    href = href.trim();
    if (/^https?:\/\//i.test(href)) return href;
    if (href.startsWith('//')) return 'https:' + href;
    if (href.startsWith('/')) return base.replace(/\/$/, '') + href;
    return base.replace(/\/$/, '') + '/' + href;
  }
}
