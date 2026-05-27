import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('job_embeddings')
export class JobEmbedding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index({ unique: true })
  jobId: string;

  @Column()
  embeddingModel: string;

  // Stored as float8 array (compatible with pgvector via raw SQL)
  @Column({ type: 'float8', array: true })
  vector: number[];

  @CreateDateColumn()
  createdAt: Date;
}
