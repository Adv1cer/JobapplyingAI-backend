import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobMatch } from './job-match.entity';

@Injectable()
export class JobsService {
  constructor(
    @InjectRepository(JobMatch)
    private readonly jobRepo: Repository<JobMatch>,
  ) {}

  async getDashboardStats(userId: string) {
    const total = await this.jobRepo.count({ where: { userId } });
    const aiMatches = await this.jobRepo.count({
      where: { userId, status: 'pending' },
    });
    const pendingReview = await this.jobRepo.count({
      where: { userId, status: 'pending' },
    });
    const interviewRequests = await this.jobRepo.count({
      where: { userId, status: 'interview' },
    });

    return {
      totalScanned: total || 1482,
      aiMatches: aiMatches || 24,
      pendingReview: pendingReview || 8,
      interviewRequests: interviewRequests || 3,
    };
  }

  async getJobMatches(userId: string): Promise<JobMatch[]> {
    const existing = await this.jobRepo.find({
      where: { userId },
      order: { scrapedAt: 'DESC' },
    });

    if (existing.length > 0) return existing;

    // Seed demo data for new users
    const demoJobs = [
      {
        userId,
        title: 'Senior Product Designer',
        company: 'Linear Systems',
        location: 'Remote, Global',
        source: 'LinkedIn',
        matchScore: 98,
        coverLetter:
          'Dear Hiring Manager,\n\nI am writing to express my strong interest in the Senior Product Designer position at Linear Systems. Having followed Linear\'s journey in the dev-tool space, I am particularly impressed by your focus on streamlined workflows...',
        resumeName: 'Alex_Thompson_Design_Lead_2024.pdf',
        resumeOptimizedFor: 'FinTech & SaaS roles',
        status: 'pending',
      },
      {
        userId,
        title: 'UX Strategy Lead',
        company: 'Meta Platforms',
        location: 'London, UK (Hybrid)',
        source: 'Facebook Jobs',
        matchScore: 85,
        coverLetter:
          "To the Meta Recruitment Team,\n\nMeta's commitment to building the next generation of social connection aligns perfectly with my 8+ years of expertise in user-centered strategy. I have specialized in scaling complex design systems...",
        resumeName: 'Alex_Thompson_Executive_Strategy.pdf',
        resumeOptimizedFor: 'Leadership & Management',
        status: 'pending',
      },
      {
        userId,
        title: 'Head of Digital Design',
        company: 'PropertyGuru',
        location: 'Singapore (On-site)',
        source: 'JobDB',
        matchScore: 72,
        coverLetter:
          "Dear PropertyGuru Talent Team,\n\nYour recent expansion into AI-driven property valuation tools is a fascinating move, and I am eager to bring my experience in digital design leadership to support this growth. In my previous role as Senior Designer...",
        resumeName: 'Alex_Thompson_Design_Lead_2024.pdf',
        resumeOptimizedFor: 'FinTech & SaaS roles',
        status: 'pending',
      },
    ];

    const saved = await this.jobRepo.save(demoJobs.map((j) => this.jobRepo.create(j)));
    return saved;
  }

  async confirmApplication(userId: string, jobId: string): Promise<JobMatch> {
    const job = await this.jobRepo.findOne({ where: { id: jobId, userId } });
    if (!job) throw new NotFoundException('Job not found');
    job.status = 'applied';
    return this.jobRepo.save(job);
  }

  async discardJob(userId: string, jobId: string): Promise<void> {
    const job = await this.jobRepo.findOne({ where: { id: jobId, userId } });
    if (!job) throw new NotFoundException('Job not found');
    await this.jobRepo.remove(job);
  }

  async getActiveBots() {
    return [
      { id: 1, name: 'Product Roles (US)', frequency: 'Every 2h', matches: 12, active: true },
      { id: 2, name: 'Design Lead (EU)', frequency: 'Daily', matches: 4, active: true },
    ];
  }

  async getUpcomingInterviews() {
    return [
      {
        id: 1,
        title: 'Senior Designer Interview',
        company: 'Stripe',
        date: '2026-09-14',
        time: '14:00',
        type: 'Zoom',
      },
      {
        id: 2,
        title: 'Initial Screening',
        company: 'OpenAI',
        date: '2026-09-16',
        time: '09:30',
        type: 'Call',
      },
    ];
  }
}
