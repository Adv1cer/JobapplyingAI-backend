import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export type ScanStatus = 'running' | 'done' | 'failed';

@Entity('scan_sessions')
export class ScanSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  @Column({ default: 'running' })
  status: ScanStatus;

  @Column({ type: 'jsonb', nullable: true })
  filters: object;

  @Column({ default: 0 })
  totalFound: number;

  @Column({ default: 0 })
  processed: number;

  @Column({ nullable: true })
  errorMessage: string;

  @Column({ nullable: true })
  completedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
