import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity('user_resumes')
export class Resume {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  @Column({ nullable: true })
  firstName: string;

  @Column({ nullable: true })
  lastName: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true })
  summary: string;

  // [{ school, degree, field, startYear, endYear, gpa }]
  @Column({ type: 'jsonb', default: '[]' })
  education: object[];

  // [{ company, position, startDate, endDate, description }]
  @Column({ type: 'jsonb', default: '[]' })
  workHistory: object[];

  // ["React", "Node.js", ...]
  @Column({ type: 'jsonb', default: '[]' })
  skills: string[];

  // [{ language, level: "Native|Fluent|Intermediate|Basic" }]
  @Column({ type: 'jsonb', default: '[]' })
  languages: object[];

  // Desired job preferences
  @Column({ nullable: true })
  desiredPosition: string;

  @Column({ nullable: true })
  desiredSalaryMin: number;

  @Column({ nullable: true })
  desiredSalaryMax: number;

  @Column({ nullable: true })
  desiredProvince: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
