import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ScanSession } from './scan-session.entity';
import { ScanFiltersDto } from './dto/scan-filters.dto';
import { QUEUE_JOB_SYNC } from '../queues/queues.constants';

// How long before we allow a fresh scan for the same filters (default 1 hour)
const DEFAULT_COOLDOWN_MINUTES = 60;

export interface ScanStartResult extends ScanSession {
  fromCache: boolean;
  cacheAgeMinutes?: number;  // how many minutes ago the cached scan completed
  nextScanAt?: Date;         // earliest time user can scan fresh again
}

@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name);

  constructor(
    @InjectRepository(ScanSession)
    private readonly sessionRepo: Repository<ScanSession>,
    @InjectQueue(QUEUE_JOB_SYNC)
    private readonly jobSyncQueue: Queue,
  ) {}

  async startScan(
    userId: string,
    filters: ScanFiltersDto & { force?: boolean },
  ): Promise<ScanStartResult> {
    const cooldownMs = (
      parseInt(process.env.SCAN_COOLDOWN_MINUTES ?? String(DEFAULT_COOLDOWN_MINUTES), 10)
    ) * 60 * 1000;

    // ── Cooldown check (skip if force=true) ───────────────────────────────────
    if (!filters.force) {
      const cached = await this.findRecentSession(userId, filters, cooldownMs);
      if (cached) {
        const ageMs = Date.now() - (cached.completedAt?.getTime() ?? cached.createdAt.getTime());
        const ageMinutes = Math.floor(ageMs / 60000);
        const nextScanAt = new Date(
          (cached.completedAt ?? cached.createdAt).getTime() + cooldownMs,
        );

        this.logger.log(
          `[Scan] Returning cached session ${cached.id} (${ageMinutes}m old) for user ${userId}`,
        );
        return { ...cached, fromCache: true, cacheAgeMinutes: ageMinutes, nextScanAt };
      }
    }

    // ── Start fresh scan ──────────────────────────────────────────────────────
    const { force: _force, ...cleanFilters } = filters as any;

    const session = await this.sessionRepo.save(
      this.sessionRepo.create({
        userId,
        status: 'running',
        filters: cleanFilters,
        totalFound: 0,
        processed: 0,
      }),
    );

    await this.jobSyncQueue.add(
      'sync',
      { sessionId: session.id, userId, filters: cleanFilters },
      { jobId: `sync_${session.id}` },
    );

    this.logger.log(`[Scan] Queued job sync session ${session.id}`);
    return { ...session, fromCache: false };
  }

  async getStatus(userId: string, sessionId: string): Promise<ScanSession> {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId, userId } });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  async getLatestSession(userId: string): Promise<(ScanSession & { cacheAgeMinutes?: number }) | null> {
    const session = await this.sessionRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    if (!session) return null;

    const ref = session.completedAt ?? session.createdAt;
    const ageMinutes = Math.floor((Date.now() - ref.getTime()) / 60000);
    return { ...session, cacheAgeMinutes: ageMinutes };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Find a completed scan session that:
   *  1. Belongs to this user
   *  2. Has matching keywords + country filters
   *  3. Completed within the cooldown window
   */
  private async findRecentSession(
    userId: string,
    filters: ScanFiltersDto,
    cooldownMs: number,
  ): Promise<ScanSession | null> {
    const since = new Date(Date.now() - cooldownMs);

    try {
      return await this.sessionRepo
        .createQueryBuilder('s')
        .where('s.userId = :userId', { userId })
        .andWhere('s.status = :status', { status: 'done' })
        .andWhere('s.completedAt > :since', { since })
        // Same keywords (null-safe: coalesce to empty string)
        .andWhere(
          "COALESCE(s.filters->>'keywords', '') = :keywords",
          { keywords: filters.keywords ?? '' },
        )
        // Same country scope
        .andWhere(
          "COALESCE(s.filters->>'country', 'TH') = :country",
          { country: filters.country ?? 'TH' },
        )
        .orderBy('s.completedAt', 'DESC')
        .getOne();
    } catch {
      // If DB doesn't support jsonb operators, fall back gracefully
      return null;
    }
  }
}
