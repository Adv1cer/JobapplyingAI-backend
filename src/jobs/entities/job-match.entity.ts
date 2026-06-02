import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/user.entity';

@Entity('job_matches')
@Index(['userId', 'status'])
@Index(['userId', 'matchScore'])
export class JobMatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  @Index()
  userId: string;

  // Job data (denormalized snapshot at time of scan)
  @Column()
  title: string;

  @Column()
  company: string;

  @Column()
  location: string;

  @Column()
  source: string;

  @Column({ nullable: true })
  jobUrl: string;

  @Column({ nullable: true })
  salary: string;

  @Column({ nullable: true })
  jobType: string;

  @Column({ type: 'jsonb', default: [] })
  skills: string[];

  // AI matching results
  @Column({ type: 'int', default: 0 })
  matchScore: number;

  @Column({ type: 'jsonb', default: [] })
  missingSkills: string[];

  @Column({ type: 'jsonb', default: [] })
  strengths: string[];

  @Column({ type: 'text', nullable: true })
  aiSummary: string;

  @Column({ type: 'jsonb', default: [] })
  aiReasons: string[];

  // Cover letter
  @Column({ type: 'text', nullable: true })
  coverLetter: string;

  @Column({ nullable: true })
  coverLetterLang: string;

  // Application tracking
  @Column({ default: 'pending' })
  status: string;

  @Column({ nullable: true })
  resumeName: string;

  @Column({ type: 'jsonb', default: [] })
  hrEmails: string[];

  // Company info snapshot
  @Column({ type: 'jsonb', nullable: true })
  companyInfo: Record<string, any>;

  // Gmail integration
  @Column({ nullable: true })
  gmailDraftId: string;

  @Column({ nullable: true })
  gmailThreadId: string;

  @Column({ default: false })
  remote: boolean;

  /** Actual date the job was posted on the source website (not when we scraped it) */
  @Column({ nullable: true, type: 'timestamptz' })
  postedAt?: Date;

  /** True while this match is actively being re-scored in a reanalyze job.
   *  Set to true before each AI batch, false after completion.
   *  Lets the frontend show a skeleton/loading state per card. */
  @Column({ default: false })
  isReanalyzing: boolean;

  /** True when resume was updated after this match was scored → score may be outdated */
  @Column({ default: false })
  isStale: boolean;

  /** True when the original job listing has likely expired (>30 days old) */
  @Column({ default: false })
  isExpired: boolean;

  @CreateDateColumn()
  @Index()
  scrapedAt: Date;
}
