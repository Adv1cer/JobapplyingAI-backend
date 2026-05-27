import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { JobMatch } from './entities/job-match.entity';
import { SavedJob } from './entities/saved-job.entity';
import { Job } from './entities/job.entity';
import { CoverLetterService, CoverLetterRequest } from '../ai/services/cover-letter.service';
import { Resume } from '../resume/resume.entity';
import { HrEmailService, HrContact } from '../scraping/hr-email.service';

@Injectable()
export class JobsService {
  constructor(
    @InjectRepository(JobMatch)
    private readonly matchRepo: Repository<JobMatch>,
    @InjectRepository(SavedJob)
    private readonly savedJobRepo: Repository<SavedJob>,
    @InjectRepository(Job)
    private readonly jobRepo: Repository<Job>,
    @InjectRepository(Resume)
    private readonly resumeRepo: Repository<Resume>,
    private readonly coverLetterService: CoverLetterService,
    private readonly hrEmailService: HrEmailService,
  ) {}

  async getDashboardStats(userId: string) {
    const [totalScanned, aiMatches, applied, interviewRequests] = await Promise.all([
      this.matchRepo.count({ where: { userId } }),
      this.matchRepo.count({ where: { userId, status: 'pending' } }),
      this.matchRepo.count({ where: { userId, status: 'applied' } }),
      this.matchRepo.count({ where: { userId, status: 'interview' } }),
    ]);
    return { totalScanned, aiMatches, pendingReview: aiMatches, applied, interviewRequests };
  }

  async getJobMatches(userId: string): Promise<JobMatch[]> {
    return this.matchRepo.find({
      where: { userId },
      order: { matchScore: 'DESC', scrapedAt: 'DESC' },
    });
  }

  async confirmApplication(userId: string, jobId: string): Promise<JobMatch> {
    const job = await this.matchRepo.findOne({ where: { id: jobId, userId } });
    if (!job) throw new NotFoundException('Job not found');
    job.status = 'applied';
    return this.matchRepo.save(job);
  }

  async discardJob(userId: string, jobId: string): Promise<void> {
    const job = await this.matchRepo.findOne({ where: { id: jobId, userId } });
    if (!job) throw new NotFoundException('Job not found');
    job.status = 'discarded';
    await this.matchRepo.save(job);
  }

  async saveJob(userId: string, jobId: string): Promise<SavedJob> {
    const existing = await this.savedJobRepo.findOne({ where: { userId, jobId } });
    if (existing) return existing;

    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    return this.savedJobRepo.save(
      this.savedJobRepo.create({
        userId,
        jobId,
        title: job?.title,
        company: job?.company,
        url: job?.url,
        source: job?.source,
      }),
    );
  }

  async unsaveJob(userId: string, jobId: string): Promise<void> {
    await this.savedJobRepo.delete({ userId, jobId });
  }

  async getSavedJobs(userId: string): Promise<SavedJob[]> {
    return this.savedJobRepo.find({
      where: { userId },
      relations: ['job'],
      order: { savedAt: 'DESC' },
    });
  }

  async regenerateCoverLetter(
    userId: string,
    jobMatchId: string,
    language?: 'TH' | 'EN',
  ): Promise<{ coverLetter: string }> {
    const match = await this.matchRepo.findOne({ where: { id: jobMatchId, userId } });
    if (!match) throw new NotFoundException('Job match not found');

    const resume = await this.resumeRepo.findOne({ where: { userId } });
    if (!resume) throw new NotFoundException('Resume not found');

    const result = await this.coverLetterService.generate({
      jobTitle: match.title,
      company: match.company,
      jobDescription: match.skills.join(', '),
      resume,
      language: language ?? 'TH',
    } as CoverLetterRequest);

    await this.matchRepo.update(jobMatchId, {
      coverLetter: result.content,
      coverLetterLang: result.language,
    });

    return { coverLetter: result.content };
  }

  async clearPendingJobs(userId: string): Promise<{ deleted: number }> {
    const result = await this.matchRepo.delete({ userId, status: In(['pending', 'discarded']) });
    return { deleted: result.affected ?? 0 };
  }

  async clearAllJobs(userId: string): Promise<{ deleted: number }> {
    const result = await this.matchRepo.delete({ userId });
    return { deleted: result.affected ?? 0 };
  }

  /**
   * Look up HR / recruiter email addresses for a job's company.
   * The job can be identified either by its internal UUID (jobMatchId)
   * or by passing the company name directly.
   */
  async getHrEmails(
    userId: string,
    jobMatchId: string,
  ): Promise<{ company: string; contacts: HrContact[] }> {
    const match = await this.matchRepo.findOne({ where: { id: jobMatchId, userId } });
    if (!match) throw new NotFoundException('Job match not found');

    const contacts = await this.hrEmailService.lookup(match.company);

    // Persist any found emails back to the job record if they're new
    if (contacts.length > 0) {
      const emails = contacts.map((c) => c.email);
      await this.matchRepo.update(jobMatchId, { hrEmails: emails } as any);
    }

    return { company: match.company, contacts };
  }

  async getActiveBots(_userId: string) { return []; }
  async getUpcomingInterviews(_userId: string) { return []; }
}
