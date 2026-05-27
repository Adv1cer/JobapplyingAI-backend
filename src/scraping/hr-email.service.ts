/**
 * HR Email Lookup — enhanced, free, no API key required.
 *
 * Pipeline:
 *   Step 1 — Domain discovery: search "{company} official website" → extract company domain
 *   Step 2 — Email scraping: run 3 DDG queries to collect real email addresses
 *             a) "{company}" HR email recruiter Thailand
 *             b) "{company}" สมัครงาน ติดต่อ hr อีเมล
 *             c) site:{domain} contact OR careers (if domain found)
 *   Step 3 — Pattern detection: guess naming convention from found emails
 *             e.g. firstname.lastname@domain.com → infer more emails
 *   Step 4 — Scoring:
 *             • Email scraped from official company domain  → confidence 0.90
 *             • Email from job board / LinkedIn / social    → confidence 0.60
 *             • Email inferred from naming pattern          → confidence 0.40
 *   Step 5 — Deduplicate, sort by confidence, return top 5
 */
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface HrContact {
  email: string;
  confidence: number;       // 0.0 – 1.0
  source?: string;          // 'official' | 'jobboard' | 'inferred'
  firstName?: string;
  lastName?: string;
  position?: string;
}

interface CacheEntry { contacts: HrContact[]; expiresAt: number }
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Noise filtering ────────────────────────────────────────────────────────────

const NOISE_PREFIXES = [
  'noreply', 'no-reply', 'mailer', 'bounce', 'postmaster',
  'info', 'contact', 'support', 'help', 'hello', 'sales',
  'marketing', 'news', 'newsletter', 'admin', 'webmaster',
  'feedback', 'team', 'service', 'billing', 'accounts',
  'privacy', 'legal', 'press', 'media', 'pr@', 'do-not-reply',
  'donotreply', 'unsubscribe', 'abuse',
];

const NOISE_DOMAINS = [
  'example.com', 'test.com', 'sentry.io', 'w3.org', 'schema.org',
  'google.com', 'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'facebook.com', 'twitter.com', 'linkedin.com',
];

const HR_PREFIXES = [
  'hr', 'recruit', 'talent', 'people', 'hiring', 'career',
  'job', 'staff', 'personnel', 'human', 'hrd',
];

const JOB_BOARD_DOMAINS = [
  'jobthai', 'jobsdb', 'linkedin', 'glassdoor', 'indeed', 'jobsth',
  'jobbkk', 'jobtopgun', 'seekasia', 'monster', 'jobstreet',
];

const EMAIL_RE = /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,10}\b/g;

// ── Helpers ────────────────────────────────────────────────────────────────────

function isNoise(email: string): boolean {
  const lower = email.toLowerCase();
  if (NOISE_DOMAINS.some((d) => lower.endsWith(`@${d}`))) return true;
  if (NOISE_PREFIXES.some((p) => lower.startsWith(p) || lower.includes(`@${p}`))) return true;
  if (lower.includes('example') || lower.includes('@test.')) return true;
  return false;
}

function isJobBoardDomain(domain: string): boolean {
  return JOB_BOARD_DOMAINS.some((d) => domain.includes(d));
}

function extractDomain(url: string): string | null {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Guess email naming pattern from a list of emails on a known domain */
function detectPattern(emails: string[], domain: string): string | null {
  const local = emails
    .filter((e) => e.endsWith(`@${domain}`))
    .map((e) => e.split('@')[0]);

  if (local.length === 0) return null;

  // Check for firstname.lastname pattern
  const dotPattern = local.filter((l) => /^[a-z]+\.[a-z]+$/.test(l));
  if (dotPattern.length > 0) return 'firstname.lastname';

  // Check for f.lastname pattern
  const fLast = local.filter((l) => /^[a-z]\.[a-z]+$/.test(l));
  if (fLast.length > 0) return 'f.lastname';

  // Check for firstnamelastname (no separator)
  const noSep = local.filter((l) => /^[a-z]{4,}$/.test(l) && !HR_PREFIXES.includes(l));
  if (noSep.length > 0) return 'firstlast';

  return null;
}

/** Generate HR email guesses based on detected pattern */
function generatePatternEmails(pattern: string, domain: string): string[] {
  const hrNames = [
    { first: 'hr', last: '' },
    { first: 'recruit', last: '' },
    { first: 'talent', last: '' },
    { first: 'career', last: '' },
  ];

  if (pattern === 'firstname.lastname') {
    return [`hr.team@${domain}`, `recruit.team@${domain}`];
  }
  return hrNames
    .map((n) => n.last ? `${n.first}@${domain}` : `${n.first}@${domain}`)
    .slice(0, 2);
}

/** Make a DDG HTML search and extract emails */
async function ddgSearch(query: string): Promise<{ emails: string[]; urls: string[] }> {
  try {
    const { data: html } = await axios.get('https://html.duckduckgo.com/html/', {
      params: { q: query },
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,*/*',
        'Accept-Language': 'en-US,en;q=0.9,th;q=0.8',
      },
      timeout: 12000,
    });

    const emails = [...(html as string).matchAll(EMAIL_RE)].map((m) => m[0].toLowerCase());

    // Extract result URLs for domain discovery
    const urlRe = /href="(https?:\/\/[^"&]+)"/g;
    const urls: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = urlRe.exec(html as string)) !== null) {
      urls.push(m[1]);
    }

    return { emails, urls: [...new Set(urls)] };
  } catch {
    return { emails: [], urls: [] };
  }
}

// ── Main service ───────────────────────────────────────────────────────────────

@Injectable()
export class HrEmailService {
  private readonly logger = new Logger(HrEmailService.name);

  async lookup(companyName: string): Promise<HrContact[]> {
    const key = companyName.trim().toLowerCase();

    const cached = cache.get(key);
    if (cached && Date.now() < cached.expiresAt) return cached.contacts;

    const contacts = await this.runPipeline(companyName);
    cache.set(key, { contacts, expiresAt: Date.now() + CACHE_TTL_MS });
    return contacts;
  }

  private async runPipeline(companyName: string): Promise<HrContact[]> {
    const clean = companyName
      .replace(/บริษัท|จำกัด|มหาชน|\(มหาชน\)|\s+/g, ' ')
      .trim();

    this.logger.log(`[HrEmail] Starting pipeline for "${clean}"`);

    // ── Step 1: Domain discovery ──────────────────────────────────────────────
    let officialDomain: string | null = null;
    try {
      const { urls } = await ddgSearch(`"${clean}" official website`);
      officialDomain = this.findOfficialDomain(clean, urls);
      if (officialDomain) {
        this.logger.log(`[HrEmail] Domain discovered: ${officialDomain}`);
      }
    } catch {
      // continue without domain
    }

    // Add small delay between searches to be polite
    await new Promise((r) => setTimeout(r, 800));

    // ── Step 2: Multi-query email scraping ───────────────────────────────────
    const allEmailSources: Array<{ email: string; fromUrl?: string }> = [];

    const queries = [
      `"${clean}" HR email recruiter Thailand`,
      `"${clean}" สมัครงาน ติดต่อ hr อีเมล`,
    ];
    if (officialDomain) {
      queries.push(`site:${officialDomain} contact OR careers OR hr`);
    }

    for (const q of queries) {
      await new Promise((r) => setTimeout(r, 600));
      const { emails } = await ddgSearch(q);
      for (const email of emails) {
        allEmailSources.push({ email });
      }
    }

    this.logger.log(`[HrEmail] "${clean}" → ${allEmailSources.length} raw emails collected`);

    // ── Step 3: Classify and score ────────────────────────────────────────────
    const seen = new Set<string>();
    const contacts: HrContact[] = [];

    for (const { email } of allEmailSources) {
      if (seen.has(email) || isNoise(email)) continue;
      seen.add(email);

      const domain = email.split('@')[1] ?? '';
      let confidence: number;
      let source: HrContact['source'];

      if (officialDomain && domain === officialDomain) {
        confidence = 0.9;
        source = 'official';
      } else if (isJobBoardDomain(domain)) {
        confidence = 0.6;
        source = 'jobboard';
      } else {
        confidence = 0.65;
        source = 'jobboard';
      }

      contacts.push({ email, confidence, source });
    }

    // ── Step 4: Pattern detection + inference ─────────────────────────────────
    if (officialDomain) {
      const officialEmails = contacts
        .filter((c) => c.source === 'official')
        .map((c) => c.email);

      const pattern = detectPattern(officialEmails, officialDomain);
      if (pattern && officialEmails.length < 3) {
        const inferred = generatePatternEmails(pattern, officialDomain);
        for (const email of inferred) {
          if (!seen.has(email)) {
            seen.add(email);
            contacts.push({ email, confidence: 0.4, source: 'inferred' });
          }
        }
      }

      // If no official email found but domain is known, add generic HR emails
      if (officialEmails.length === 0 && officialDomain) {
        const generics = HR_PREFIXES.slice(0, 3).map((p) => `${p}@${officialDomain}`);
        for (const email of generics) {
          if (!seen.has(email)) {
            seen.add(email);
            contacts.push({ email, confidence: 0.35, source: 'inferred' });
          }
        }
      }
    }

    // ── Step 5: Prefer HR-prefixed, sort by confidence, cap at 5 ─────────────
    const hrFirst = contacts.filter((c) =>
      HR_PREFIXES.some((p) => c.email.split('@')[0].startsWith(p)),
    );
    const others = contacts.filter(
      (c) => !HR_PREFIXES.some((p) => c.email.split('@')[0].startsWith(p)),
    );

    const sorted = [...hrFirst, ...others]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);

    this.logger.log(
      `[HrEmail] "${clean}" → ${sorted.length} final contacts` +
      (sorted.length > 0 ? ` (best: ${sorted[0].email} @ ${sorted[0].confidence})` : ''),
    );

    return sorted;
  }

  /** Pick the most likely official company domain from a list of URLs */
  private findOfficialDomain(company: string, urls: string[]): string | null {
    const cleanCompany = company
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 20);

    // Skip social/job board/search engine URLs
    const skipDomains = [
      'facebook.com', 'twitter.com', 'linkedin.com', 'instagram.com',
      'youtube.com', 'google.com', 'bing.com', 'duckduckgo.com',
      'wikipedia.org', 'pantip.com', 'wongnai.com', 'reviewdb.com',
      ...JOB_BOARD_DOMAINS,
    ];

    const candidates: string[] = [];
    for (const url of urls) {
      const domain = extractDomain(url);
      if (!domain) continue;
      if (skipDomains.some((s) => domain.includes(s))) continue;
      candidates.push(domain);
    }

    if (candidates.length === 0) return null;

    // Prefer domain that contains part of the company name
    const nameParts = cleanCompany.split('').slice(0, 5).join('');
    const matching = candidates.find((d) => d.replace(/[^a-z0-9]/g, '').includes(nameParts));
    if (matching) return matching;

    // Otherwise return the first non-skipped domain
    return candidates[0] ?? null;
  }
}
