import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('jobs')
@Index(['source', 'externalId'], { unique: true })
@Index(['company'])
export class Job {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  externalId: string;

  @Column()
  @Index()
  source: string;

  @Column()
  title: string;

  @Column()
  company: string;

  @Column()
  location: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'jsonb', default: [] })
  skills: string[];

  @Column({ nullable: true })
  salary: string;

  @Column({ nullable: true })
  jobType: string;

  @Column({ default: false })
  remote: boolean;

  @Column()
  url: string;

  @Column({ type: 'jsonb', default: [] })
  hrEmails: string[];

  @Column({ nullable: true, type: 'timestamptz' })
  postedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
