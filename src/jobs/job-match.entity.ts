import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity('job_matches')
export class JobMatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  @Column()
  title: string;

  @Column()
  company: string;

  @Column({ nullable: true })
  companyLogoUrl: string;

  @Column()
  location: string;

  @Column()
  source: string;

  @Column({ type: 'int' })
  matchScore: number;

  @Column({ type: 'text', nullable: true })
  coverLetter: string;

  @Column({ nullable: true })
  resumeName: string;

  @Column({ nullable: true })
  resumeOptimizedFor: string;

  @Column({ default: 'pending' })
  status: string;

  @CreateDateColumn()
  scrapedAt: Date;
}
