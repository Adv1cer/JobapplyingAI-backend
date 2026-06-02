import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { JobMatchResult, NormalizedJob } from '../../common/interfaces/job.interface';
import { Resume } from '../../resume/resume.entity';
import { EmbeddingService } from './embedding.service';
import { Job } from '../../jobs/entities/job.entity';

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly embeddingService: EmbeddingService,
    @InjectRepository(Job)
    private readonly jobRepo: Repository<Job>,
  ) {}

  async analyzeMatch(job: NormalizedJob | Job, resume: Resume | null): Promise<JobMatchResult & { coverLetter: string; reasons: string[] }> {
    const apiKey = (this.config.get<string>('OPENROUTER_KEY') ?? this.config.get<string>('OPENROUTER_API_KEY') ?? '').trim();
    if (!apiKey || apiKey.startsWith('your-')) {
      return this.fallbackAnalysis(job, resume);
    }

    const model = this.config.get<string>('AI_MODEL') ?? 'google/gemini-flash-1.5';
    const prompt = this.buildMatchPrompt(job, resume);

    try {
      const res = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        { model, messages: [{ role: 'user', content: prompt }], max_tokens: 1500, temperature: 0.3 },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'HTTP-Referer': this.config.get('BASEURL') ?? 'https://jobai.com',
            'X-Title': 'JobAI',
          },
          timeout: 30000,
        },
      );

      const text: string = res.data?.choices?.[0]?.message?.content ?? '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        matchScore: Math.min(100, Math.max(0, Math.round(Number(parsed.matchScore ?? 50)))),
        missingSkills: Array.isArray(parsed.missingSkills) ? parsed.missingSkills.slice(0, 5) : [],
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 5) : [],
        summary: parsed.summary ?? '',
        coverLetter: parsed.coverLetter ?? '',
        reasons: Array.isArray(parsed.reasons) ? parsed.reasons.slice(0, 3) : [],
      };
    } catch (err: any) {
      this.logger.warn(`[Matching] ${job.title}: ${err.message}`);
      return this.fallbackAnalysis(job, resume);
    }
  }

  async getSemanticMatchScore(resumeText: string, jobText: string): Promise<number> {
    const [resumeVec, jobVec] = await Promise.all([
      this.embeddingService.generateEmbedding(resumeText),
      this.embeddingService.generateEmbedding(jobText),
    ]);
    const similarity = this.embeddingService.cosineSimilarity(resumeVec, jobVec);
    return Math.round(similarity * 100);
  }

  private buildMatchPrompt(job: NormalizedJob | Job, resume: Resume | null): string {
    const lang = this.config.get<string>('AI_LANGUAGE') ?? 'TH';
    const isEN = lang === 'EN';

    return isEN ? this.buildEnglishPrompt(job, resume) : this.buildThaiPrompt(job, resume);
  }

  private buildThaiPrompt(job: NormalizedJob | Job, resume: Resume | null): string {
    const name = resume ? `${resume.firstName ?? ''} ${resume.lastName ?? ''}`.trim() : 'ผู้สมัคร';
    const phone = (resume as any)?.phone ?? '[เบอร์โทรศัพท์]';
    const email = (resume as any)?.email ?? '[อีเมล]';

    return `คุณเป็น HR ผู้เชี่ยวชาญที่วิเคราะห์ตรงไปตรงมา ไม่เข้าข้างผู้สมัคร ประเมินตามความเป็นจริง

กฎสำคัญ:
- matchScore ต้องสะท้อนความเป็นจริง ถ้าทักษะไม่ตรงให้คะแนนต่ำ อย่าให้คะแนนสูงเพื่อให้รู้สึกดี
- ถ้าขาดทักษะหลักของตำแหน่ง ให้ระบุใน missingSkills อย่างชัดเจน
- ถ้าคุณสมบัติไม่เพียงพอ บอกตรงๆ ใน summary

## ข้อมูลผู้สมัคร
${resume ? this.formatResume(resume) : 'ยังไม่มีข้อมูล Resume'}

## ตำแหน่งงาน
ตำแหน่ง: ${job.title}
บริษัท: ${job.company}
สถานที่: ${job.location}
ทักษะที่ต้องการ: ${(job.skills ?? []).join(', ') || 'ไม่ระบุ'}
รายละเอียด: ${(job.description ?? '').slice(0, 600)}

สำหรับ coverLetter ให้ใช้รูปแบบนี้เท่านั้น:
เรียน[ชื่อ HR หรือ ฝ่ายบุคคล บริษัท${job.company}]
สวัสดีครับ ผมนาย ${name} [เนื้อหา 3-4 ประโยค เกี่ยวกับการศึกษา ประสบการณ์ และเหตุผลที่เหมาะกับตำแหน่ง]
[ย่อหน้า 2: ทักษะที่ตรงกับงาน และสิ่งที่จะช่วยบริษัทได้]
ขอแสดงความนับถือ
${name}
โทรศัพท์: ${phone}
อีเมล: ${email}

ตอบ JSON เท่านั้น:
{
  "matchScore": <0-100 ตามความจริง>,
  "missingSkills": ["ทักษะที่ขาด1", "ทักษะที่ขาด2"],
  "strengths": ["จุดแข็ง1", "จุดแข็ง2"],
  "summary": "<ประเมินตรงๆ 1 ประโยค บอกว่าเหมาะหรือไม่เหมาะและเพราะอะไร>",
  "reasons": ["เหตุผล1", "เหตุผล2", "เหตุผล3"],
  "coverLetter": "<จดหมายตามรูปแบบข้างต้น ภาษาไทย เป็นธรรมชาติ ไม่ใช้ภาษา AI ซ้ำซาก>"
}`;
  }

  private buildEnglishPrompt(job: NormalizedJob | Job, resume: Resume | null): string {
    const name = resume ? `${resume.firstName ?? ''} ${resume.lastName ?? ''}`.trim() : 'Applicant';
    const phone = (resume as any)?.phone ?? '[Phone]';
    const email = (resume as any)?.email ?? '[Email]';

    return `You are an objective HR analyst. Be honest and unbiased — do NOT inflate the match score to make the candidate feel good.

Rules:
- matchScore must reflect reality. If key skills are missing, score low.
- List all critical missing skills honestly.
- summary should be a frank assessment of fit, not flattery.

## Candidate
${resume ? this.formatResume(resume) : 'No resume provided'}

## Job
Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Required Skills: ${(job.skills ?? []).join(', ') || 'Not specified'}
Description: ${(job.description ?? '').slice(0, 600)}

For coverLetter, use this exact format:
Dear [HR Manager / Recruitment Team at ${job.company}],
My name is ${name}. [3-4 sentences about education, experience, and fit for this role]
[Paragraph 2: specific skills that match and value you bring]
Sincerely,
${name}
Phone: ${phone}
Email: ${email}

Reply with JSON only:
{
  "matchScore": <0-100 honest score>,
  "missingSkills": ["skill1", "skill2"],
  "strengths": ["strength1", "strength2"],
  "summary": "<honest one-sentence assessment: suitable/not suitable and why>",
  "reasons": ["reason1", "reason2", "reason3"],
  "coverLetter": "<letter using the format above, natural human tone, no AI clichés>"
}`;
  }

  /** Public alias used by the job-sync processor for jobs beyond the AI cap */
  fallbackScore(job: NormalizedJob | Job, resume: Resume | null) {
    return this.fallbackAnalysis(job, resume);
  }

  private fallbackAnalysis(job: NormalizedJob | Job, resume: Resume | null): JobMatchResult & { coverLetter: string; reasons: string[] } {
    if (!resume) {
      return {
        matchScore: 50, missingSkills: [], strengths: [], summary: 'ไม่มีข้อมูล Resume',
        coverLetter: [
          `เรียนฝ่ายบุคคล บริษัท${job.company}`,
          `สวัสดีครับ ผมมีความสนใจสมัครตำแหน่ง ${job.title} กรุณากรอกข้อมูล Resume เพื่อสร้างจดหมายสมัครงานที่สมบูรณ์`,
          `ขอแสดงความนับถือ`,
          `[ชื่อ-นามสกุล]`,
          `โทรศัพท์: [เบอร์โทรศัพท์]`,
          `อีเมล: [อีเมล]`,
        ].join('\n'),
        reasons: ['กรุณากรอก Resume เพื่อวิเคราะห์ด้วย AI'],
      };
    }

    const skills = (resume.skills ?? []).map((s) => s.toLowerCase());
    const jobText = `${job.description ?? ''} ${(job.skills ?? []).join(' ')}`.toLowerCase();
    const matchingSkills = skills.filter((s) => jobText.includes(s));
    const jobSkills = job.skills ?? [];
    const missingSkills = jobSkills.filter((s) => !skills.includes(s.toLowerCase()));
    const score = Math.min(85, 40 + matchingSkills.length * 8);

    const hasApiKey = !!((this.config.get<string>('OPENROUTER_KEY') ?? this.config.get<string>('OPENROUTER_API_KEY') ?? '').trim());
    const reasons: string[] = [];
    if (matchingSkills.length > 0) {
      reasons.push(`ทักษะตรง: ${matchingSkills.slice(0, 3).join(', ')}`);
    } else {
      reasons.push('ทักษะยังไม่ตรงกับ JD');
    }
    if (!hasApiKey) {
      reasons.push('เพิ่ม OPENROUTER_KEY หรือ OPENROUTER_API_KEY ใน .env เพื่อวิเคราะห์ด้วย AI');
    }

    const fullName = `${resume.firstName ?? ''} ${resume.lastName ?? ''}`.trim();
    const phone = (resume as any).phone ?? '[เบอร์โทรศัพท์]';
    const email = (resume as any).email ?? '[อีเมล]';
    const skillsStr = resume.skills?.slice(0, 3).join(', ') ?? 'ที่เกี่ยวข้อง';

    return {
      matchScore: score,
      missingSkills: missingSkills.slice(0, 5),
      strengths: matchingSkills.slice(0, 3).map((s) => skills.find((sk) => sk === s) ?? s),
      summary: `${matchingSkills.length} ทักษะตรงจาก ${skills.length} รายการ`,
      reasons,
      coverLetter: [
        `เรียนฝ่ายบุคคล บริษัท${job.company}`,
        `สวัสดีครับ ผมนาย ${fullName} มีความสนใจสมัครตำแหน่ง ${job.title} ด้วยประสบการณ์ด้าน ${skillsStr} ผมเชื่อมั่นว่าจะสามารถนำทักษะเหล่านี้มาพัฒนาองค์กรของท่านได้อย่างมีประสิทธิภาพ`,
        `ผมมีทักษะที่ตรงกับความต้องการของตำแหน่งนี้ และพร้อมเรียนรู้เพิ่มเติมเพื่อพัฒนาตนเองอย่างต่อเนื่อง หากได้รับโอกาสจะตั้งใจปฏิบัติงานอย่างเต็มความสามารถ`,
        `ขอแสดงความนับถือ`,
        `${fullName}`,
        `โทรศัพท์: ${phone}`,
        `อีเมล: ${email}`,
      ].join('\n'),
    };
  }

  private formatResume(r: Resume): string {
    const work = (r.workHistory as any[]).slice(0, 3)
      .map((w) => `- ${w.position} @ ${w.company} (${w.startDate}–${w.endDate || 'ปัจจุบัน'})`)
      .join('\n');
    const edu = (r.education as any[]).slice(0, 2)
      .map((e) => `- ${e.degree ?? ''} ${e.field ?? ''} @ ${e.school ?? ''} (${e.startYear ?? ''}–${e.endYear ?? ''})`)
      .join('\n');
    const parts = [
      `ชื่อ: ${r.firstName ?? ''} ${r.lastName ?? ''}`,
      `โทรศัพท์: ${(r as any).phone ?? '-'}`,
      `อีเมล: ${(r as any).email ?? '-'}`,
      `สรุป: ${r.summary ?? '-'}`,
      `การศึกษา:\n${edu || '-'}`,
      `ประสบการณ์:\n${work || '-'}`,
      `ทักษะ: ${r.skills?.join(', ') || '-'}`,
      `ตำแหน่งที่ต้องการ: ${r.desiredPosition ?? '-'}`,
    ];
    if (r.pdfExtractedText) {
      parts.push(`\n--- เนื้อหาจาก Resume PDF (ใช้เป็นข้อมูลเพิ่มเติมในการวิเคราะห์) ---\n${r.pdfExtractedText.slice(0, 2000)}`);
    }
    return parts.join('\n');
  }
}
