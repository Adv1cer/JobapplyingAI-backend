import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Job as BullJob } from 'bullmq';
import { ScanSession } from '../../scan/scan-session.entity';
import { JobMatch } from '../../jobs/entities/job-match.entity';
import { Resume } from '../../resume/resume.entity';
import { CollectorsService } from '../../collectors/collectors.service';
import { MatchingService } from '../../ai/services/matching.service';
import { EmbeddingService } from '../../ai/services/embedding.service';
import { QUEUE_JOB_SYNC } from '../queues.constants';
import { sleep } from '../../common/utils/retry.util';

export interface JobSyncPayload {
  sessionId: string;
  userId: string;
  filters: any;
  reanalyze?: boolean; // true = skip scraping, re-score existing matches
}

/** Delay between parallel AI batches (ms). Default 400ms. */
const AI_MATCH_DELAY_MS = parseInt(process.env.AI_MATCH_DELAY_MS ?? '400', 10);

/** Max jobs to AI-analyze per scan. Default 30 (was 60 — halved for speed). */
const MAX_AI_JOBS = parseInt(process.env.MAX_AI_JOBS ?? '30', 10);

/** Max jobs to AI-analyze during re-analyze. Top N by score, rest → isStale. Default 20. */
const MAX_REANALYZE_AI = parseInt(process.env.MAX_REANALYZE_AI ?? '20', 10);

/** Number of parallel AI calls per batch. Default 3. */
const AI_BATCH_SIZE = parseInt(process.env.AI_BATCH_SIZE ?? '3', 10);

@Processor(QUEUE_JOB_SYNC)
export class JobSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(JobSyncProcessor.name);

  constructor(
    @InjectRepository(ScanSession)
    private readonly sessionRepo: Repository<ScanSession>,
    @InjectRepository(JobMatch)
    private readonly jobMatchRepo: Repository<JobMatch>,
    @InjectRepository(Resume)
    private readonly resumeRepo: Repository<Resume>,
    private readonly collectorsService: CollectorsService,
    private readonly matchingService: MatchingService,
    private readonly embeddingService: EmbeddingService,
  ) {
    super();
  }

  async process(job: BullJob<JobSyncPayload>): Promise<void> {
    const { sessionId, userId, filters, reanalyze } = job.data;

    // ── Branch: re-analyze existing matches (no scraping) ──────────────────────
    if (reanalyze) {
      return this.processReanalyze(sessionId, userId);
    }

    this.logger.log(`[Sync ${sessionId}] Starting for user ${userId}`);

    try {
      // Clear old pending/discarded matches for this user
      await this.jobMatchRepo.delete({ userId, status: In(['pending', 'discarded']) });

      const resume = await this.resumeRepo.findOne({ where: { userId } });

      // ── Step 1: Collect from sources (each adapter has its own delays) ────────
      const rawJobs = await this.collectorsService.collectAll(filters);
      await this.sessionRepo.update(sessionId, { totalFound: rawJobs.length });
      this.logger.log(`[Sync ${sessionId}] Collected ${rawJobs.length} jobs`);

      // ── Step 2: Upsert normalized jobs into the jobs table ───────────────────
      const savedJobs = await this.collectorsService.upsertJobs(rawJobs);

      // ── Step 3: PHASE 1 — Save ALL jobs instantly (status='analyzing') ─────────
      // User sees ALL jobs right away. AI fills in results progressively in Phase 2.

      const resumeName = resume
        ? `${resume.firstName ?? ''} ${resume.lastName ?? ''}`.trim()
        : undefined;

      // Bulk-insert all job stubs so they appear immediately in the dashboard
      const matchStubs = await Promise.all(
        rawJobs.map((raw) =>
          this.jobMatchRepo.save(
            this.jobMatchRepo.create({
              userId,
              title:    raw.title,
              company:  raw.company,
              location: raw.location,
              source:   raw.source,
              jobUrl:   raw.url,
              salary:   raw.salary,
              jobType:  raw.jobType,
              remote:   (raw as any).remote ?? false,
              skills:   raw.skills.slice(0, 20),
              hrEmails: raw.hrEmails ?? [],
              status:   'analyzing',   // signals frontend to show skeleton AI section
              matchScore: 0,
              resumeName,
              isStale:   false,
              isExpired: false,
              postedAt:  raw.postedAt ? new Date(raw.postedAt) : undefined,
            }),
          ).catch(() => null),
        ),
      );

      // Signal to frontend: all jobs visible, AI analysis starting
      await this.sessionRepo.update(sessionId, {
        totalFound: rawJobs.length,
        processed: 0,
      });

      this.logger.log(`[Sync ${sessionId}] Phase 1 done — ${rawJobs.length} stubs saved`);

      // ── Step 4: PHASE 2 — AI analysis in parallel batches, update each record ──
      // First MAX_AI_JOBS → parallel AI. Beyond cap → instant fallback scoring.
      let processed = 0;

      for (let batchStart = 0; batchStart < rawJobs.length; batchStart += AI_BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + AI_BATCH_SIZE, rawJobs.length);
        const batch    = rawJobs.slice(batchStart, batchEnd);
        const batchStubs  = matchStubs.slice(batchStart, batchEnd);
        const batchSavedJobs = savedJobs.slice(batchStart, batchEnd);
        const batchHasAI  = batchStart < MAX_AI_JOBS;

        try {
          const batchResults = await Promise.all(
            batch.map((raw, idx) => {
              const globalIdx = batchStart + idx;
              if (globalIdx < MAX_AI_JOBS) {
                return this.matchingService.analyzeMatch(raw, resume).catch((err: any) => {
                  this.logger.warn(`[Sync ${sessionId}] AI failed "${raw.title}": ${err.message}`);
                  return this.matchingService.fallbackScore(raw, resume);
                });
              }
              return Promise.resolve(this.matchingService.fallbackScore(raw, resume));
            }),
          );

          // Update each stub with AI result (status 'analyzing' → 'pending')
          await Promise.all(
            batch.map(async (raw, idx) => {
              const stub    = batchStubs[idx];
              const result  = batchResults[idx];
              const savedJob = batchSavedJobs[idx];
              const globalIdx = batchStart + idx;

              if (!stub) return;

              await this.jobMatchRepo.update(stub.id, {
                matchScore:      result.matchScore,
                missingSkills:   result.missingSkills?.slice(0, 10) ?? [],
                strengths:       result.strengths?.slice(0, 5) ?? [],
                aiSummary:       result.summary,
                aiReasons:       result.reasons ?? [],
                coverLetter:     result.coverLetter,
                coverLetterLang: 'TH',
                status:          'pending',   // now fully analyzed
              });

              // Non-blocking embedding for AI-ranked jobs only
              if (globalIdx < MAX_AI_JOBS && savedJob?.id) {
                const text = `${raw.title} ${raw.description} ${raw.skills.join(' ')}`.slice(0, 2000);
                this.embeddingService.upsertJobEmbedding(savedJob.id, text).catch(() => {});
              }

              processed++;
            }),
          );

          // Update progress after each batch
          await this.sessionRepo.update(sessionId, { processed });

          // Throttle between AI batches only
          if (batchHasAI && batchEnd < rawJobs.length) {
            await sleep(AI_MATCH_DELAY_MS);
          }
        } catch (err: any) {
          this.logger.warn(`[Sync ${sessionId}] Batch ${batchStart}-${batchEnd} error: ${err.message}`);
        }
      }

      // Mark job matches older than 30 days as expired.
      // Use postedAt (actual job posting date) when available;
      // fall back to scrapedAt only when postedAt is null.
      const expiredCutoff = new Date();
      expiredCutoff.setDate(expiredCutoff.getDate() - 30);
      await this.jobMatchRepo
        .createQueryBuilder()
        .update()
        .set({ isExpired: true })
        .where(
          `"userId" = :userId AND "isExpired" = false AND (
            ("postedAt" IS NOT NULL AND "postedAt" < :cutoff)
            OR
            ("postedAt" IS NULL AND "scrapedAt" < :cutoff)
          )`,
          { userId, cutoff: expiredCutoff },
        )
        .execute()
        .catch(() => {});

      await this.sessionRepo.update(sessionId, {
        status: 'done',
        completedAt: new Date(),
        processed,
      });

      this.logger.log(`[Sync ${sessionId}] Done — ${processed}/${rawJobs.length} ranked`);
    } catch (err: any) {
      this.logger.error(`[Sync ${sessionId}] Fatal: ${err.message}`);
      await this.sessionRepo.update(sessionId, {
        status: 'failed',
        errorMessage: err.message,
        completedAt: new Date(),
      });
    }
  }

  // ── Re-analyze: re-score existing job matches with the latest resume ──────────
  // Only AI-analyze top MAX_REANALYZE_AI jobs (by current matchScore).
  // The rest are immediately marked isStale=true so user sees them flagged —
  // no long wait, no wasted API calls.
  private async processReanalyze(sessionId: string, userId: string): Promise<void> {
    this.logger.log(`[Reanalyze ${sessionId}] Starting for user ${userId}`);
    try {
      const [allMatches, resume] = await Promise.all([
        this.jobMatchRepo.find({
          where: { userId, status: In(['pending', 'applied']), isExpired: false },
          order: { matchScore: 'DESC', scrapedAt: 'DESC' },
        }),
        this.resumeRepo.findOne({ where: { userId } }),
      ]);

      const toReanalyze = allMatches.slice(0, MAX_REANALYZE_AI);
      const toMarkStale = allMatches.slice(MAX_REANALYZE_AI);

      await this.sessionRepo.update(sessionId, { totalFound: toReanalyze.length });
      this.logger.log(
        `[Reanalyze ${sessionId}] AI: ${toReanalyze.length}, mark stale: ${toMarkStale.length}`,
      );

      // Immediately mark the rest as stale — user sees them right away without waiting
      if (toMarkStale.length > 0) {
        await this.jobMatchRepo.update(
          { id: In(toMarkStale.map((m) => m.id)) },
          { isStale: true },
        );
      }

      const resumeName = resume
        ? `${resume.firstName ?? ''} ${resume.lastName ?? ''}`.trim()
        : undefined;

      // Mark ALL jobs-to-reanalyze as isReanalyzing=true upfront.
      // Frontend shows skeleton animation on each card while it awaits its batch.
      if (toReanalyze.length > 0) {
        await this.jobMatchRepo.update(
          { id: In(toReanalyze.map((m) => m.id)) },
          { isReanalyzing: true },
        );
      }

      let processed = 0;

      // Process top jobs in parallel batches
      for (let batchStart = 0; batchStart < toReanalyze.length; batchStart += AI_BATCH_SIZE) {
        const batch = toReanalyze.slice(batchStart, Math.min(batchStart + AI_BATCH_SIZE, toReanalyze.length));

        try {
          const batchResults = await Promise.all(
            batch.map((m) => {
              const jobLike = {
                id: m.id, source: m.source, title: m.title, company: m.company,
                location: m.location, description: m.aiSummary ?? '',
                skills: m.skills ?? [], salary: m.salary, jobType: m.jobType,
                remote: m.remote ?? false, url: m.jobUrl,
              };
              return this.matchingService.analyzeMatch(jobLike as any, resume).catch((err: any) => {
                this.logger.warn(`[Reanalyze] AI failed "${m.title}": ${err.message}`);
                return this.matchingService.fallbackScore(jobLike as any, resume);
              });
            }),
          );

          // Update each job with new AI result + clear isReanalyzing flag
          await Promise.all(
            batch.map((m, idx) => {
              const result = batchResults[idx];
              return this.jobMatchRepo.update(m.id, {
                matchScore:      result.matchScore,
                missingSkills:   result.missingSkills?.slice(0, 10),
                strengths:       result.strengths?.slice(0, 5),
                aiSummary:       result.summary,
                aiReasons:       result.reasons,
                coverLetter:     result.coverLetter,
                coverLetterLang: 'TH',
                resumeName,
                isStale:         false,       // freshly re-analyzed
                isReanalyzing:   false,        // clear loading indicator
              });
            }),
          );

          processed += batch.length;
          await this.sessionRepo.update(sessionId, { processed });

          if (batchStart + AI_BATCH_SIZE < toReanalyze.length) {
            await sleep(AI_MATCH_DELAY_MS);
          }
        } catch (err: any) {
          this.logger.warn(`[Reanalyze] Batch error: ${err.message}`);
          // Ensure flags are cleared even on batch error
          await this.jobMatchRepo.update(
            { id: In(batch.map((m) => m.id)) },
            { isReanalyzing: false },
          ).catch(() => {});
        }
      }

      await this.sessionRepo.update(sessionId, {
        status: 'done',
        completedAt: new Date(),
        processed,
      });

      this.logger.log(
        `[Reanalyze ${sessionId}] Done — ${processed} re-scored, ${toMarkStale.length} marked stale`,
      );
    } catch (err: any) {
      this.logger.error(`[Reanalyze ${sessionId}] Fatal: ${err.message}`);
      // Safety: clear all isReanalyzing flags for this user on fatal error
      await this.jobMatchRepo.update({ userId }, { isReanalyzing: false }).catch(() => {});
      await this.sessionRepo.update(sessionId, {
        status: 'failed',
        errorMessage: err.message,
        completedAt: new Date(),
      });
    }
  }
}
