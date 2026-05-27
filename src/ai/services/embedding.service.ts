import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { JobEmbedding } from '../../jobs/entities/job-embedding.entity';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMS = 1536;

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private pgvectorAvailable = false;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(JobEmbedding)
    private readonly embeddingRepo: Repository<JobEmbedding>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {
    this.initPgVector();
  }

  private async initPgVector() {
    try {
      await this.dataSource.query('CREATE EXTENSION IF NOT EXISTS vector');
      this.pgvectorAvailable = true;
      this.logger.log('pgvector extension enabled');
    } catch {
      this.logger.warn('pgvector not available — using JS cosine similarity fallback');
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const openaiKey = this.config.get<string>('OPENAI_API_KEY');
    const openrouterKey = this.config.get<string>('OPENROUTER_API_KEY');

    // Priority: OpenAI → OpenRouter → mock
    if (openaiKey && !openaiKey.startsWith('your-')) {
      return this.callEmbeddingApi(
        'https://api.openai.com/v1/embeddings',
        openaiKey,
        EMBEDDING_MODEL,
        text,
      );
    }

    if (openrouterKey && !openrouterKey.startsWith('your-')) {
      // OpenRouter supports OpenAI-compatible embeddings endpoint
      return this.callEmbeddingApi(
        'https://openrouter.ai/api/v1/embeddings',
        openrouterKey,
        `openai/${EMBEDDING_MODEL}`,
        text,
      );
    }

    this.logger.debug('No embedding API key — using mock');
    return this.mockEmbedding(text);
  }

  private async callEmbeddingApi(
    url: string,
    apiKey: string,
    model: string,
    text: string,
  ): Promise<number[]> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: text.slice(0, 8192) }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`${response.status}: ${body.slice(0, 200)}`);
      }

      const data = await response.json();
      return data.data[0].embedding as number[];
    } catch (err: any) {
      this.logger.warn(`Embedding failed (${url}): ${err.message} — using mock`);
      return this.mockEmbedding(text);
    }
  }

  async upsertJobEmbedding(jobId: string, text: string): Promise<void> {
    const vector = await this.generateEmbedding(text);
    const existing = await this.embeddingRepo.findOne({ where: { jobId } });

    if (existing) {
      await this.embeddingRepo.update(existing.id, { vector, embeddingModel: EMBEDDING_MODEL });
    } else {
      await this.embeddingRepo.save(this.embeddingRepo.create({ jobId, vector, embeddingModel: EMBEDDING_MODEL }));
    }
  }

  async findSimilarJobs(queryVector: number[], limit = 20): Promise<Array<{ jobId: string; score: number }>> {
    const embeddings = await this.embeddingRepo.find();

    return embeddings
      .map((e) => ({ jobId: e.jobId, score: this.cosineSimilarity(queryVector, e.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  private mockEmbedding(text: string): number[] {
    // Simple hash-based mock — not semantically meaningful but deterministic
    const vec = new Array(EMBEDDING_DIMS).fill(0);
    for (let i = 0; i < text.length; i++) {
      vec[i % EMBEDDING_DIMS] += text.charCodeAt(i) / 1000;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }
}
