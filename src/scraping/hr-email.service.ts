/**
 * HR Email Lookup — AI-first, company-contact fallback
 *
 * Pipeline:
 *   Step 1 — Ask OpenRouter AI for HR + general contact emails (JSON only)
 *   Step 2 — If AI returns nothing, fall back to DuckDuckGo scraping
 *   Step 3 — Deduplicate, classify (hr | general), sort HR-first
 *
 * The caller always gets something useful:
 *   - Best case: direct HR/recruiter email
 *   - Fallback: general company contact email (contact@, info@, etc.)
 *   - Last resort: empty array → frontend shows "ไม่พบ"
 *
 * Cached 24 h per company name.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface HrContact {
  email?: string;
  phone?: string;
  website?: string;
  confidence: number;       // 0.0 – 1.0
  /** 'hr' = direct HR/recruiter, 'general' = company contact/info email */
  type: 'hr' | 'general';
  source?: string;          // 'ai' | 'web'
  firstName?: string;
  lastName?: string;
  position?: string;
}

interface CacheEntry { contacts: HrContact[]; expiresAt: number }
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

// ── Classifiers ────────────────────────────────────────────────────────────────

const HR_PREFIXES = [
  'hr', 'recruit', 'talent', 'people', 'hiring',
  'career', 'careers', 'job', 'jobs', 'hrd', 'humanresource',
];

/** Emails that are completely useless (bounce, spam traps, search engines) */
const ALWAYS_NOISE: string[] = [
  'noreply', 'no-reply', 'mailer', 'bounce', 'postmaster',
  'unsubscribe', 'abuse', 'do-not-reply', 'donotreply',
  'error', 'daemon',
];

const NOISE_DOMAINS: string[] = [
  'example.com', 'test.com', 'sentry.io', 'w3.org', 'schema.org',
  'google.com', 'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'facebook.com', 'twitter.com', 'linkedin.com',
  'duckduckgo.com',
  'jobthai.com', 'jobsdb.com', 'jobbkk.com', 'jobtopgun.com',
  'seekasia.com', 'monster.com', 'jobstreet.com', 'glassdoor.com',
  'indeed.com', 'jobsth.com', 'blognone.com',
];

/** General contact prefixes — valid as fallback, not ideal as primary HR */
const GENERAL_PREFIXES = [
  'contact', 'info', 'hello', 'hi', 'team', 'support',
  'service', 'help', 'office', 'admin', 'mail',
];

const EMAIL_RE = /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,10}\b/g;
const PHONE_RE = /(?:\+66[\s\-]?|0)[0-9]{1,2}[\s\-]?[0-9]{3,4}[\s\-]?[0-9]{4}/g;

function classifyEmail(email: string): 'hr' | 'general' | 'noise' {
  const lower = email.toLowerCase();
  const localPart = lower.split('@')[0] ?? '';
  const domain = lower.split('@')[1] ?? '';

  // Always discard
  if (NOISE_DOMAINS.some((d) => domain === d)) return 'noise';
  if (ALWAYS_NOISE.some((p) => localPart === p || localPart.startsWith(p + '.'))) return 'noise';
  if (lower.includes('example') || lower.includes('@test.')) return 'noise';

  // HR / recruiter
  if (HR_PREFIXES.some((p) => localPart === p || localPart.startsWith(p))) return 'hr';

  // General company contact
  if (GENERAL_PREFIXES.some((p) => localPart === p || localPart.startsWith(p))) return 'general';

  // Named person email (firstname.lastname@company.com) → treat as general
  if (/^[a-z]+[._][a-z]+$/.test(localPart)) return 'general';

  return 'general'; // unknown but valid → keep as general
}

// ── DuckDuckGo fallback ────────────────────────────────────────────────────────

async function ddgSearch(query: string): Promise<{ emails: string[]; phones: string[] }> {
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
    const text = html as string;
    const emails = [...text.matchAll(EMAIL_RE)].map((m) => m[0].toLowerCase());
    const phones = [...text.matchAll(PHONE_RE)].map((m) => m[0].replace(/\s/g, ''));
    return { emails: [...new Set(emails)], phones: [...new Set(phones)] };
  } catch {
    return { emails: [], phones: [] };
  }
}

// ── Main service ───────────────────────────────────────────────────────────────

@Injectable()
export class HrEmailService {
  private readonly logger = new Logger(HrEmailService.name);

  constructor(private readonly config: ConfigService) {}

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

    this.logger.log(`[HrEmail] Looking up: "${clean}"`);

    // Step 1: Ask AI
    const aiContacts = await this.askAI(clean);
    if (aiContacts.length > 0) {
      this.logger.log(
        `[HrEmail] AI → ${aiContacts.length} contacts ` +
        `(hr: ${aiContacts.filter(c => c.type === 'hr').length}, ` +
        `general: ${aiContacts.filter(c => c.type === 'general').length}, ` +
        `phones: ${aiContacts.filter(c => c.phone).length}, ` +
        `websites: ${aiContacts.filter(c => c.website).length})`,
      );
      return this.rankContacts(aiContacts);
    }

    // Step 2: DDG web scraping
    this.logger.log(`[HrEmail] AI found nothing — trying DDG for "${clean}"`);
    const webContacts = await this.scrapeWeb(clean);
    this.logger.log(`[HrEmail] DDG → ${webContacts.length} contacts for "${clean}"`);
    return this.rankContacts(webContacts);
  }

  // ── AI lookup ─────────────────────────────────────────────────────────────────
  // Uses Perplexity Sonar (web search) as primary — it can actually browse the
  // company website and job boards in real time.
  // Falls back to the configured AI_MODEL (no web access) if Sonar fails/unavailable.

  private async askAI(companyName: string): Promise<HrContact[]> {
    const apiKey = (
      this.config.get<string>('OPENROUTER_KEY') ??
      this.config.get<string>('OPENROUTER_API_KEY') ?? ''
    ).trim();

    if (!apiKey || apiKey.startsWith('your-')) return [];

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': this.config.get('BASEURL') ?? 'https://jobai.com',
      'X-Title': 'JobAI-HREmail',
    };

    // Try Perplexity Sonar first (has real-time internet search)
    const sonarResult = await this.callModel(
      'perplexity/sonar',
      companyName,
      headers,
      true, // isSearchModel
    );
    if (sonarResult.length > 0) return sonarResult;

    // Fallback: regular model (uses training data only — less reliable for emails)
    const fallbackModel = this.config.get<string>('AI_MODEL') ?? 'google/gemini-2.0-flash-001';
    this.logger.warn(`[HrEmail] Perplexity returned nothing — trying ${fallbackModel}`);
    return this.callModel(fallbackModel, companyName, headers, false);
  }

  private async callModel(
    model: string,
    companyName: string,
    headers: Record<string, string>,
    isSearchModel: boolean,
  ): Promise<HrContact[]> {
    const systemPrompt = isSearchModel
      ? `You are a company contact finder. Search the internet for ALL contact information of the given Thai company that can be used to apply for a job.
IMPORTANT:
- Search the company's official website, careers page, LinkedIn, and job boards.
- Find: HR/recruitment emails, general contact emails, phone numbers, and career/application websites.
- Return ONLY a raw JSON array (no markdown, no text outside the array).
- Each item must have at least one of: email, phone, or website.
- Schema: {"email":"...","phone":"...","website":"...","type":"hr"|"general","confidence":0.0-1.0,"position":"..."}
  - "hr" = direct HR/recruitment/talent contact
  - "general" = general company contact (contact@, info@, main office phone, etc.)
  - Omit fields that are not found (do not set null/empty string).
  - phone: Thai format, e.g. "02-123-4567" or "+66 2 123 4567"
  - website: full URL of careers page or job application page
- If you find nothing verifiable after searching, return exactly: []
- DO NOT invent or guess — only return what you actually found on the web.`
      : `You are a company contact finder for Thai companies.
Return ONLY a raw JSON array of contact info you are CERTAIN about from your training data.
Schema: {"email":"...","phone":"...","website":"...","type":"hr"|"general","confidence":0.0-1.0}
Include any combination of email, phone number, or career website. Omit fields you don't know.
If you are not sure about anything, return []. Never guess or hallucinate.`;

    const userMsg = isSearchModel
      ? `Search and find ALL contact information (emails, phone numbers, career website) for this Thai company: "${companyName}". Include anything useful for job applications.`
      : `Find contact info (emails, phone, career website) for: "${companyName}" (Thailand). Only return what you know for certain.`;

    try {
      const res = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMsg },
          ],
          max_tokens: 600,
          temperature: 0.1,
        },
        { headers, timeout: 25000 },
      );

      const raw: string = res.data?.choices?.[0]?.message?.content ?? '';
      this.logger.log(`[HrEmail] ${model} raw response: ${raw.slice(0, 200)}`);
      return this.parseAIResponse(raw);
    } catch (err: any) {
      this.logger.warn(`[HrEmail] ${model} failed: ${err.message}`);
      return [];
    }
  }

  private parseAIResponse(raw: string): HrContact[] {
    try {
      const cleaned = raw
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim();

      const start = cleaned.indexOf('[');
      const end = cleaned.lastIndexOf(']');
      if (start === -1 || end === -1) return [];

      const arr: any[] = JSON.parse(cleaned.slice(start, end + 1));
      if (!Array.isArray(arr)) return [];

      const contacts: HrContact[] = [];
      for (const item of arr) {
        const hasEmail = typeof item?.email === 'string' && item.email.includes('@');
        const hasPhone = typeof item?.phone === 'string' && item.phone.trim().length > 0;
        const hasWebsite = typeof item?.website === 'string' && item.website.trim().length > 0;
        if (!hasEmail && !hasPhone && !hasWebsite) continue;

        let emailClassification: 'hr' | 'general' | 'noise' = 'general';
        let email: string | undefined;
        if (hasEmail) {
          email = item.email.toLowerCase().trim();
          emailClassification = classifyEmail(email as string);
          if (emailClassification === 'noise') email = undefined;
        }

        if (!email && !hasPhone && !hasWebsite) continue;

        const declaredType = item.type === 'hr' ? 'hr' : 'general';
        const inferredType = email ? (emailClassification === 'hr' ? 'hr' : 'general') : 'general';

        contacts.push({
          ...(email ? { email } : {}),
          ...(hasPhone ? { phone: item.phone.trim() } : {}),
          ...(hasWebsite ? { website: item.website.trim() } : {}),
          type: item.type === 'hr' ? 'hr' : (inferredType === 'hr' ? 'hr' : declaredType),
          confidence: typeof item.confidence === 'number' ? item.confidence : 0.7,
          source: 'ai',
          position: item.position ?? undefined,
        });
      }
      return contacts.slice(0, 8);
    } catch {
      return [];
    }
  }

  // ── DDG web scraping fallback ─────────────────────────────────────────────────

  private async scrapeWeb(companyName: string): Promise<HrContact[]> {
    const queries = [
      `"${companyName}" HR email recruiter Thailand`,
      `"${companyName}" สมัครงาน ติดต่อ hr อีเมล เบอร์โทร`,
      `"${companyName}" contact email phone`,
    ];

    const seenEmails = new Set<string>();
    const seenPhones = new Set<string>();
    const contacts: HrContact[] = [];

    for (const q of queries) {
      await new Promise((r) => setTimeout(r, 600));
      const { emails, phones } = await ddgSearch(q);

      for (const email of emails) {
        if (seenEmails.has(email)) continue;
        const classification = classifyEmail(email);
        if (classification === 'noise') continue;
        seenEmails.add(email);
        contacts.push({
          email,
          type: classification,
          confidence: classification === 'hr' ? 0.65 : 0.45,
          source: 'web',
        });
      }

      for (const phone of phones) {
        if (seenPhones.has(phone)) continue;
        seenPhones.add(phone);
        contacts.push({
          phone,
          type: 'general',
          confidence: 0.4,
          source: 'web',
        });
      }
    }

    return contacts;
  }

  // ── Deduplicate + rank ────────────────────────────────────────────────────────
  // Rules:
  //   - Deduplicate emails exactly, phones by normalized digits, websites by domain
  //   - Max 3 email results + 1 phone + 1 website = max 5 total
  //   - HR emails first, then general emails, then phone, then website

  private rankContacts(contacts: HrContact[]): HrContact[] {
    const seenEmails  = new Set<string>();
    const seenPhones  = new Set<string>();
    const seenDomains = new Set<string>();

    const hrEmails:      HrContact[] = [];
    const generalEmails: HrContact[] = [];
    let   phone:         HrContact | null = null;
    let   website:       HrContact | null = null;

    // Sort by confidence before deduplicating so highest-confidence wins
    const sorted = [...contacts].sort((a, b) => b.confidence - a.confidence);

    for (const c of sorted) {
      if (c.email) {
        if (seenEmails.has(c.email)) continue;
        seenEmails.add(c.email);
        if (c.type === 'hr') hrEmails.push(c);
        else                  generalEmails.push(c);
      } else if (c.phone) {
        const digits = c.phone.replace(/\D/g, '');
        if (seenPhones.has(digits)) continue;
        seenPhones.add(digits);
        if (!phone) phone = c; // keep only best phone
      } else if (c.website) {
        // Normalize to domain only
        const domain = this.extractDomain(c.website);
        if (!domain || seenDomains.has(domain)) continue;
        seenDomains.add(domain);
        if (!website) website = { ...c, website: domain }; // store domain as canonical
      }
    }

    const result: HrContact[] = [
      ...hrEmails.slice(0, 3),
      ...generalEmails.slice(0, Math.max(0, 3 - hrEmails.length)),
    ];
    if (phone)   result.push(phone);
    if (website) result.push(website);

    return result;
  }

  private extractDomain(url: string): string | null {
    try {
      const u = new URL(url.startsWith('http') ? url : `https://${url}`);
      return u.hostname.replace(/^www\./, '');
    } catch {
      // Not a full URL — might already be just a domain
      const plain = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
      return plain.includes('.') ? plain : null;
    }
  }
}
