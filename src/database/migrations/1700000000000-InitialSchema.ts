import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1700000000000 implements MigrationInterface {
  name = 'InitialSchema1700000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Enable pgvector extension (optional, non-fatal if unavailable)
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`).catch(() => {});
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`).catch(() => {});

    // users
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        "email" varchar(255) NOT NULL UNIQUE,
        "password" varchar(255) NOT NULL,
        "name" varchar(255),
        "avatarUrl" varchar(500),
        "plan" varchar(50) DEFAULT 'free',
        "createdAt" timestamptz DEFAULT now(),
        "updatedAt" timestamptz DEFAULT now()
      )
    `);

    // user_resumes
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_resumes" (
        "id" uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        "userId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "firstName" varchar(255),
        "lastName" varchar(255),
        "phone" varchar(50),
        "summary" text,
        "education" jsonb DEFAULT '[]',
        "workHistory" jsonb DEFAULT '[]',
        "skills" jsonb DEFAULT '[]',
        "languages" jsonb DEFAULT '[]',
        "desiredPosition" varchar(255),
        "desiredProvince" varchar(255),
        "desiredSalaryMin" numeric,
        "desiredSalaryMax" numeric,
        "createdAt" timestamptz DEFAULT now(),
        "updatedAt" timestamptz DEFAULT now()
      )
    `);

    // jobs (normalized)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "jobs" (
        "id" uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        "externalId" varchar(255),
        "source" varchar(100) NOT NULL,
        "title" varchar(255) NOT NULL,
        "company" varchar(255) NOT NULL,
        "location" varchar(255) NOT NULL,
        "description" text DEFAULT '',
        "skills" jsonb DEFAULT '[]',
        "salary" varchar(255),
        "jobType" varchar(100),
        "remote" boolean DEFAULT false,
        "url" varchar(1000) NOT NULL,
        "hrEmails" jsonb DEFAULT '[]',
        "postedAt" timestamptz,
        "createdAt" timestamptz DEFAULT now(),
        "updatedAt" timestamptz DEFAULT now(),
        UNIQUE("source", "externalId")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company)`);

    // job_embeddings
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "job_embeddings" (
        "id" uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        "jobId" varchar(255) NOT NULL UNIQUE,
        "embeddingModel" varchar(100) NOT NULL,
        "vector" float8[] NOT NULL,
        "createdAt" timestamptz DEFAULT now()
      )
    `);

    // job_matches
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "job_matches" (
        "id" uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        "userId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "title" varchar(255) NOT NULL,
        "company" varchar(255) NOT NULL,
        "location" varchar(255) NOT NULL,
        "source" varchar(100) NOT NULL,
        "jobUrl" varchar(1000),
        "salary" varchar(255),
        "jobType" varchar(100),
        "skills" jsonb DEFAULT '[]',
        "matchScore" int DEFAULT 0,
        "missingSkills" jsonb DEFAULT '[]',
        "strengths" jsonb DEFAULT '[]',
        "aiSummary" text,
        "aiReasons" jsonb DEFAULT '[]',
        "coverLetter" text,
        "coverLetterLang" varchar(5),
        "status" varchar(50) DEFAULT 'pending',
        "resumeName" varchar(255),
        "hrEmails" jsonb DEFAULT '[]',
        "companyInfo" jsonb,
        "gmailDraftId" varchar(255),
        "scrapedAt" timestamptz DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_job_matches_userId ON job_matches("userId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_job_matches_status ON job_matches("userId", "status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_job_matches_score ON job_matches("userId", "matchScore" DESC)`);

    // saved_jobs
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "saved_jobs" (
        "id" uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        "userId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "jobId" uuid REFERENCES jobs(id) ON DELETE CASCADE,
        "title" varchar(255),
        "company" varchar(255),
        "url" varchar(1000),
        "source" varchar(100),
        "savedAt" timestamptz DEFAULT now(),
        UNIQUE("userId", "jobId")
      )
    `);

    // gmail_tokens
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "gmail_tokens" (
        "id" uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        "userId" uuid NOT NULL UNIQUE,
        "accessToken" text NOT NULL,
        "refreshToken" text,
        "expiryDate" bigint,
        "email" varchar(255),
        "createdAt" timestamptz DEFAULT now(),
        "updatedAt" timestamptz DEFAULT now()
      )
    `);

    // scan_sessions
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "scan_sessions" (
        "id" uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        "userId" uuid NOT NULL REFERENCES users(id),
        "status" varchar(50) NOT NULL DEFAULT 'running',
        "filters" jsonb,
        "totalFound" int DEFAULT 0,
        "processed" int DEFAULT 0,
        "errorMessage" text,
        "createdAt" timestamptz DEFAULT now(),
        "completedAt" timestamptz
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS scan_sessions CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS gmail_tokens CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS saved_jobs CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS job_matches CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS job_embeddings CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS jobs CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS user_resumes CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS users CASCADE`);
  }
}
