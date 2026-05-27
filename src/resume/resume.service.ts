import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { Resume } from './resume.entity';
import { ScanSession } from '../scan/scan-session.entity';
import { QUEUE_JOB_SYNC } from '../queues/queues.constants';

@Injectable()
export class ResumeService {
  constructor(
    @InjectRepository(Resume)
    private readonly resumeRepo: Repository<Resume>,
    @InjectRepository(ScanSession)
    private readonly sessionRepo: Repository<ScanSession>,
    @InjectQueue(QUEUE_JOB_SYNC)
    private readonly jobSyncQueue: Queue,
  ) {}

  async getOrCreate(userId: string): Promise<Resume> {
    const existing = await this.resumeRepo.findOne({ where: { userId } });
    if (existing) return existing;
    return this.resumeRepo.save(this.resumeRepo.create({ userId }));
  }

  async save(userId: string, data: Partial<Resume>): Promise<Resume> {
    const existing = await this.resumeRepo.findOne({ where: { userId } });
    if (existing) {
      Object.assign(existing, data);
      return this.resumeRepo.save(existing);
    }
    return this.resumeRepo.save(this.resumeRepo.create({ userId, ...data }));
  }

  /**
   * Queue a re-analysis job: re-score all existing job matches with the latest
   * resume without doing any new scraping.
   * Returns a ScanSession (reuse the same entity for progress tracking).
   */
  async queueReanalyze(userId: string): Promise<ScanSession> {
    const session = await this.sessionRepo.save(
      this.sessionRepo.create({
        userId,
        status: 'running',
        filters: { reanalyze: true },
        totalFound: 0,
        processed: 0,
      }),
    );

    await this.jobSyncQueue.add(
      'reanalyze',
      { sessionId: session.id, userId, filters: null, reanalyze: true },
      { jobId: `reanalyze_${session.id}` },
    );

    return session;
  }
}
