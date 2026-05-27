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

/**
 * How many milliseconds to wait between AI matching calls.
 * Prevents hammering OpenRouter rate limits when processing many jobs.
 * Set AI_MATCH_DELAY_MS env var to override (default 500 ms).
 */
const AI_MATCH_DELAY_MS = parseInt(process.env.AI_MATCH_DELAY_MS ?? '500', 10);

/**
 * Maximum jobs to run through AI analysis per scan.
 * The rest are saved to DB but not AI-ranked (matchScore = 0).
 * Keeps scan times reasonable and avoids excessive AI API usage.
 * Set MAX_AI_JOBS env var to override (default 60).
 */
const MAX_AI_JOBS = parseInt(process.env.MAX_AI_JOBS ?? '60', 10);

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

      // ── Step 3: Rank + save ALL jobs ─────────────────────────────────────────
      // First MAX_AI_JOBS → full AI analysis (throttled).
      // Beyond cap → instant fallback scoring (keyword match, no API call).
      // All jobs are saved to the match table so the user sees everything.

      let processed = 0;
      for (let i = 0; i < rawJobs.length; i++) {
        const raw = rawJobs[i];
        const savedJob = savedJobs[i];
        const useAI = i < MAX_AI_JOBS;

        try {
          const aiResult = useAI
            ? await this.matchingService.analyzeMatch(raw, resume)
            : this.matchingService.fallbackScore(raw, resume);

          await this.jobMatchRepo.save(
            this.jobMatchRepo.create({
              userId,
              title:         raw.title,
              company:       raw.company,
              location:      raw.location,
              source:        raw.source,
              jobUrl:        raw.url,
              salary:        raw.salary,
              jobType:       raw.jobType,
              skills:        raw.skills.slice(0, 20),
              matchScore:    aiResult.matchScore,
              missingSkills: aiResult.missingSkills?.slice(0, 10),
              strengths:     aiResult.strengths?.slice(0, 5),
              aiSummary:     aiResult.summary,
              aiReasons:     aiResult.reasons,
              coverLetter:   aiResult.coverLetter,
              coverLetterLang: 'TH',
              status:        'pending',
              resumeName:    resume
                ? `${resume.firstName ?? ''} ${resume.lastName ?? ''}`.trim()
                : undefined,
              hrEmails: raw.hrEmails ?? [],
            }),
          );

          // Non-blocking embedding (only for AI-ranked jobs to save resources)
          if (useAI && savedJob?.id) {
            const text = `${raw.title} ${raw.description} ${raw.skills.join(' ')}`.slice(0, 2000);
            this.embeddingService.upsertJobEmbedding(savedJob.id, text).catch(() => {});
          }

          processed++;
          if (processed % 10 === 0) {
            await this.sessionRepo.update(sessionId, { processed });
          }

          // Throttle only AI calls (fallback is instant, no API)
          if (useAI && i < rawJobs.length - 1) await sleep(AI_MATCH_DELAY_MS);
        } catch (err: any) {
          this.logger.warn(`[Sync ${sessionId}] Skip "${raw.title}": ${err.message}`);
        }
      }

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
  private async processReanalyze(sessionId: string, userId: string): Promise<void> {
    this.logger.log(`[Reanalyze ${sessionId}] Starting for user ${userId}`);
    try {
      const [matches, resume] = await Promise.all([
        this.jobMatchRepo.find({
          where: { userId, status: In(['pending', 'applied']) },
          order: { scrapedAt: 'DESC' },
        }),
        this.resumeRepo.findOne({ where: { userId } }),
      ]);

      await this.sessionRepo.update(sessionId, { totalFound: matches.length });
      this.logger.log(`[Reanalyze ${sessionId}] ${matches.length} matches to re-score`);

      const resumeName = resume
        ? `${resume.firstName ?? ''} ${resume.lastName ?? ''}`.trim()
        : undefined;

      let processed = 0;
      for (let i = 0; i < matches.length; i++) {
        const m = matches[i];

        // Reconstruct a NormalizedJob-like object from the denormalized match data
        const jobLike = {
          id: m.id,
          source: m.source,
          title: m.title,
          company: m.company,
          location: m.location,
          description: m.aiSummary ?? '',  // best available description we stored
          skills: m.skills ?? [],
          salary: m.salary,
          jobType: m.jobType,
          remote: false,
          url: m.jobUrl,
        };

        try {
          const useAI = i < MAX_AI_JOBS;
          const result = useAI
            ? await this.matchingService.analyzeMatch(jobLike as any, resume)
            : this.matchingService.fallbackScore(jobLike as any, resume);

          await this.jobMatchRepo.update(m.id, {
            matchScore:    result.matchScore,
            missingSkills: result.missingSkills?.slice(0, 10),
            strengths:     result.strengths?.slice(0, 5),
            aiSummary:     result.summary,
            aiReasons:     result.reasons,
            coverLetter:   result.coverLetter,
            coverLetterLang: 'TH',
            resumeName,
          });

          processed++;
          if (processed % 10 === 0) {
            await this.sessionRepo.update(sessionId, { processed });
          }

          if (useAI && i < matches.length - 1) await sleep(AI_MATCH_DELAY_MS);
        } catch (err: any) {
          this.logger.warn(`[Reanalyze] Skip "${m.title}": ${err.message}`);
        }
      }

      await this.sessionRepo.update(sessionId, {
        status: 'done',
        completedAt: new Date(),
        processed,
      });

      this.logger.log(`[Reanalyze ${sessionId}] Done — ${processed}/${matches.length} re-scored`);
    } catch (err: any) {
      this.logger.error(`[Reanalyze ${sessionId}] Fatal: ${err.message}`);
      await this.sessionRepo.update(sessionId, {
        status: 'failed',
        errorMessage: err.message,
        completedAt: new Date(),
      });
    }
  }
}
