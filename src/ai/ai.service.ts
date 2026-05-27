import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { RawJob, CompanyInfo } from '../scraping/dto/raw-job.dto';
import { Resume } from '../resume/resume.entity';

export interface AiMatchResult {
  matchScore: number;
  reasons: string[];
  coverLetter: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(private readonly config: ConfigService) {}

  async analyzeMatch(
    job: RawJob,
    company: CompanyInfo,
    resume: Resume | null,
  ): Promise<AiMatchResult> {
    const apiKey = (this.config.get<string>('OPENROUTER_KEY') ?? this.config.get<string>('OPENROUTER_API_KEY') ?? '').trim();
    if (!apiKey || apiKey.startsWith('your-')) {
      return this.fallbackScore(job, resume);
    }

    const model =
      this.config.get<string>('AI_MODEL') ?? 'google/gemini-flash-1.5';

    const prompt = this.buildPrompt(job, company, resume);

    try {
      const res = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1200,
          temperature: 0.3,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'HTTP-Referer': this.config.get('BASEURL') ?? 'https://jobai.com',
            'X-Title': 'JobAI',
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      );

      const text: string =
        res.data?.choices?.[0]?.message?.content ?? '';

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in AI response');

      const parsed = JSON.parse(jsonMatch[0]) as AiMatchResult;
      return {
        matchScore: Math.min(100, Math.max(0, Math.round(Number(parsed.matchScore)))),
        reasons: (parsed.reasons ?? []).slice(0, 3),
        coverLetter: parsed.coverLetter ?? '',
      };
    } catch (err: any) {
      this.logger.warn(`[OpenRouter] ${job.title}: ${err.message}`);
      return this.fallbackScore(job, resume);
    }
  }

  private buildPrompt(job: RawJob, company: CompanyInfo, resume: Resume | null): string {
    return `คุณเป็น AI ผู้เชี่ยวชาญด้าน HR วิเคราะห์ความเหมาะสมของผู้สมัครกับงาน

## ข้อมูลผู้สมัคร
${resume ? this.formatResume(resume) : 'ยังไม่มีข้อมูล Resume'}

## ตำแหน่งงาน
${this.formatJob(job)}

## ข้อมูลบริษัท (dataforthai.com)
${this.formatCompany(company)}

ตอบ JSON เท่านั้น:
{"matchScore":<0-100>,"reasons":["เหตุผล1","เหตุผล2","เหตุผล3"],"coverLetter":"<จดหมาย 150-200 คำ ภาษาไทย>"}`;
  }

  private fallbackScore(job: RawJob, resume: Resume | null): AiMatchResult {
    if (!resume) {
      return {
        matchScore: 50,
        reasons: ['ยังไม่มีข้อมูล Resume — กรุณากรอกที่ My Resumes'],
        coverLetter: `เรียน ผู้รับผิดชอบ,\n\nข้าพเจ้าสนใจสมัครตำแหน่ง ${job.title} ที่บริษัท ${job.company} กรุณาพิจารณาใบสมัครด้วย\n\nขอบคุณครับ/ค่ะ`,
      };
    }

    const skills = (resume.skills ?? []).map((s) => s.toLowerCase());
    const desc = (job.description ?? job.title).toLowerCase();
    const skillHits = skills.filter((s) => desc.includes(s)).length;
    const score = Math.min(85, 40 + skillHits * 8);

    const hasApiKey = !!((this.config.get<string>('OPENROUTER_KEY') ?? this.config.get<string>('OPENROUTER_API_KEY') ?? '').trim());
    const reasons: string[] = [];
    if (skillHits > 0) {
      reasons.push(`ทักษะตรง ${skillHits} รายการ (${skills.slice(0, 3).join(', ')})`);
    } else {
      reasons.push('ทักษะยังไม่ตรงกับ JD');
    }
    if (!hasApiKey) {
      reasons.push('เพิ่ม OPENROUTER_KEY หรือ OPENROUTER_API_KEY ใน .env เพื่อวิเคราะห์ด้วย AI');
    }

    return {
      matchScore: score,
      reasons,
      coverLetter: `เรียน ฝ่ายทรัพยากรบุคคล ${job.company},\n\nข้าพเจ้า ${resume.firstName ?? ''} ${resume.lastName ?? ''} มีความสนใจสมัครตำแหน่ง ${job.title} ด้วยประสบการณ์ด้าน ${resume.skills?.slice(0, 3).join(', ') ?? 'ที่เกี่ยวข้อง'} ข้าพเจ้ามั่นใจว่าสามารถมีส่วนร่วมกับทีมของท่านได้อย่างมีประสิทธิภาพ\n\nขอบคุณครับ/ค่ะ\n${resume.firstName ?? ''} ${resume.lastName ?? ''}`.trim(),
    };
  }

  private formatResume(r: Resume): string {
    const work = (r.workHistory as any[])
      .slice(0, 3)
      .map((w) => `- ${w.position} @ ${w.company} (${w.startDate}–${w.endDate || 'ปัจจุบัน'})`)
      .join('\n');
    return [
      `ชื่อ: ${r.firstName ?? ''} ${r.lastName ?? ''}`,
      `สรุป: ${r.summary ?? '-'}`,
      `ประสบการณ์:\n${work || '-'}`,
      `ทักษะ: ${r.skills?.join(', ') || '-'}`,
      `ตำแหน่งที่ต้องการ: ${r.desiredPosition ?? '-'}`,
      `เงินเดือนที่ต้องการ: ${r.desiredSalaryMin ?? '-'}–${r.desiredSalaryMax ?? '-'} บาท`,
    ].join('\n');
  }

  private formatJob(j: RawJob): string {
    return [
      `ตำแหน่ง: ${j.title}`,
      `บริษัท: ${j.company}`,
      `สถานที่: ${j.location}`,
      `เงินเดือน: ${j.salary ?? 'ไม่ระบุ'}`,
      `ประเภท: ${j.jobType ?? 'ไม่ระบุ'}`,
      `แหล่งที่มา: ${j.source} (${j.url})`,
      `รายละเอียด: ${(j.description ?? '').slice(0, 600)}`,
    ].join('\n');
  }

  private formatCompany(c: CompanyInfo): string {
    if (!c.found) return 'ไม่พบข้อมูลใน dataforthai.com';
    return [
      `สถานะ: ${c.status ?? '-'}`,
      `ทุนจดทะเบียน: ${c.registeredCapital ?? '-'}`,
      `ประเภทธุรกิจ: ${c.businessType ?? '-'}`,
      `จดทะเบียน: ${c.registrationDate ?? '-'}`,
    ].join('\n');
  }
}
