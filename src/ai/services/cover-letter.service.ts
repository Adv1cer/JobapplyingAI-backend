import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Resume } from '../../resume/resume.entity';

export interface CoverLetterRequest {
  jobTitle: string;
  company: string;
  jobDescription: string;
  resume: Resume;
  language?: 'TH' | 'EN';
  tone?: 'formal' | 'friendly';
}

export interface CoverLetterResult {
  content: string;
  language: string;
  wordCount: number;
}

@Injectable()
export class CoverLetterService {
  private readonly logger = new Logger(CoverLetterService.name);

  constructor(private readonly config: ConfigService) {}

  async generate(req: CoverLetterRequest): Promise<CoverLetterResult> {
    const apiKey = this.config.get<string>('OPENROUTER_API_KEY');
    if (!apiKey || apiKey.startsWith('your-')) {
      return this.generateFallback(req);
    }

    const model = this.config.get<string>('AI_MODEL') ?? 'google/gemini-2.0-flash-001';
    const language = req.language ?? 'TH';
    const prompt = language === 'EN' ? this.buildEnglishPrompt(req) : this.buildThaiPrompt(req);

    try {
      const res = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        { model, messages: [{ role: 'user', content: prompt }], max_tokens: 800, temperature: 0.7 },
        {
          headers: { Authorization: `Bearer ${apiKey}`, 'X-Title': 'JobAI' },
          timeout: 30000,
        },
      );

      const content: string = res.data?.choices?.[0]?.message?.content?.trim() ?? '';
      return { content, language, wordCount: content.split(/\s+/).length };
    } catch (err: any) {
      this.logger.warn(`Cover letter generation failed: ${err.message}`);
      return this.generateFallback(req);
    }
  }

  private buildThaiPrompt(req: CoverLetterRequest): string {
    const workHistory = (req.resume.workHistory as any[]).slice(0, 2)
      .map((w) => `${w.position} ที่ ${w.company}`)
      .join(', ');
    const education = (req.resume.education as any[]).slice(0, 1)
      .map((e) => `${e.degree ?? ''} ${e.field ?? ''} จาก ${e.school ?? ''}`)
      .join('');
    const fullName = `${req.resume.firstName ?? ''} ${req.resume.lastName ?? ''}`.trim();
    const phone = (req.resume as any).phone ?? '[เบอร์โทรศัพท์]';
    const email = (req.resume as any).email ?? '[อีเมล]';

    return `เขียนจดหมายสมัครงานภาษาไทยในรูปแบบที่กำหนด ห้ามเปลี่ยนโครงสร้าง

รูปแบบที่ต้องใช้:
เรียน[ชื่อ HR หรือ ฝ่ายบุคคล บริษัท${req.company}]
สวัสดีครับ ผมนาย ${fullName} [ประโยคเกี่ยวกับการศึกษา: ${education || 'ระดับการศึกษาและสาขา'}] [2-3 ประโยคเกี่ยวกับประสบการณ์: ${workHistory || 'ประสบการณ์ที่เกี่ยวข้อง'} และเหตุผลที่ต้องการสมัครตำแหน่งนี้]
[ย่อหน้าที่ 2 (1-2 ประโยค): ทักษะ ${req.resume.skills?.slice(0, 4).join(', ') || 'ที่เกี่ยวข้อง'} ที่จะช่วยงานได้]
ขอแสดงความนับถือ
${fullName}
โทรศัพท์: ${phone}
อีเมล: ${email}

ข้อมูลงาน:
ตำแหน่ง: ${req.jobTitle}
JD ย่อ: ${req.jobDescription.slice(0, 400)}

กฎเพิ่มเติม:
- ภาษาเป็นธรรมชาติ ไม่ใช้ภาษา AI ซ้ำซาก
- เน้นประสบการณ์และทักษะที่ตรงกับ JD
- ไม่เพิ่มส่วนอื่นนอกจากรูปแบบที่กำหนด
- ATS-friendly: ใส่คีย์เวิร์ดจาก JD

ตอบเฉพาะตัวจดหมายเท่านั้น ไม่ต้องมีหัวข้อหรือหมายเหตุ`;
  }

  private buildEnglishPrompt(req: CoverLetterRequest): string {
    const workHistory = (req.resume.workHistory as any[]).slice(0, 2)
      .map((w) => `${w.position} at ${w.company}`)
      .join(', ');

    return `Write a cover letter for:
Position: ${req.jobTitle}
Company: ${req.company}

Candidate:
- Name: ${req.resume.firstName} ${req.resume.lastName}
- Experience: ${workHistory || 'Not specified'}
- Key skills: ${req.resume.skills?.slice(0, 5).join(', ') || 'Not specified'}
- Summary: ${req.resume.summary || 'Not specified'}

JD excerpt: ${req.jobDescription.slice(0, 400)}

Rules:
- 150-180 words
- Natural, human-sounding tone
- No clichés ("I am excited to apply...", "I am a passionate...")
- Highlight experience relevant to the JD
- ATS-friendly: include keywords from JD
- ${req.tone === 'friendly' ? 'Slightly conversational tone' : 'Professional formal tone'}

Reply with the letter text only, no headers or notes.`;
  }

  private generateFallback(req: CoverLetterRequest): CoverLetterResult {
    const { resume, jobTitle, company, language } = req;
    const lang = language ?? 'TH';
    const fullName = `${resume.firstName ?? ''} ${resume.lastName ?? ''}`.trim();
    const phone = (resume as any).phone ?? '[เบอร์โทรศัพท์]';
    const email = (resume as any).email ?? '[อีเมล]';
    const skillsStr = resume.skills?.slice(0, 3).join(', ') || 'ที่เกี่ยวข้อง';

    let content: string;
    if (lang === 'EN') {
      content = [
        `Dear Recruitment Team at ${company},`,
        `My name is ${fullName}. I am writing to apply for the ${jobTitle} position. With experience in ${skillsStr}, I am confident I can contribute effectively to your team.`,
        resume.summary || `My background aligns well with the requirements for this role at ${company}.`,
        `Sincerely,`,
        `${fullName}`,
        `Phone: ${phone}`,
        `Email: ${email}`,
      ].join('\n');
    } else {
      const education = (resume.education as any[]).slice(0, 1)
        .map((e) => `สำเร็จการศึกษาระดับ${e.degree ?? ''} สาขา${e.field ?? ''} จาก${e.school ?? ''}`)
        .join('');
      content = [
        `เรียนฝ่ายบุคคล บริษัท${company}`,
        `สวัสดีครับ ผมนาย ${fullName} ${education ? education + ' ' : ''}มีความสนใจสมัครตำแหน่ง ${jobTitle} ด้วยประสบการณ์ด้าน ${skillsStr} ผมเชื่อมั่นว่าจะสามารถนำทักษะเหล่านี้มาพัฒนาองค์กรของท่านได้`,
        `${resume.summary || 'ผมมีความพร้อมในการเรียนรู้และพัฒนาตนเองอย่างต่อเนื่อง และพร้อมทุ่มเทให้กับงานอย่างเต็มที่'}`,
        `ขอแสดงความนับถือ`,
        `${fullName}`,
        `โทรศัพท์: ${phone}`,
        `อีเมล: ${email}`,
      ].join('\n');
    }

    return { content, language: lang, wordCount: content.split(/\s+/).length };
  }
}
