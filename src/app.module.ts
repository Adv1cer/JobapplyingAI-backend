import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule } from '@nestjs/throttler';
import { CacheModule } from '@nestjs/cache-manager';

import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { JobsModule } from './jobs/jobs.module';
import { ResumeModule } from './resume/resume.module';
import { ScanModule } from './scan/scan.module';
import { AiModule } from './ai/ai.module';
import { GmailModule } from './gmail/gmail.module';
import { CollectorsModule } from './collectors/collectors.module';
import { QueuesModule } from './queues/queues.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const dbUrl = config.get<string>('DATABASE_URL');

        // Support individual connection params as fallback
        const host = config.get<string>('DB_HOST') ?? config.get<string>('PGHOST') ?? 'localhost';
        const port = config.get<number>('DB_PORT') ?? config.get<number>('PGPORT') ?? 5432;
        const username = config.get<string>('DB_USERNAME') ?? config.get<string>('DB_USER') ?? config.get<string>('PGUSER') ?? 'postgres';
        const password = config.get<string>('DB_PASSWORD') ?? config.get<string>('PGPASSWORD') ?? '';
        const database = config.get<string>('DB_DATABASE') ?? config.get<string>('DB_NAME') ?? config.get<string>('PGDATABASE') ?? 'jobai';

        const isExternal = dbUrl?.includes('render.com') || dbUrl?.includes('supabase') || host?.includes('render.com');

        const base = {
          type: 'postgres' as const,
          entities: [__dirname + '/**/*.entity{.ts,.js}'],
          synchronize: config.get('NODE_ENV') !== 'production',
          ssl: isExternal ? { rejectUnauthorized: false } : false,
          logging: config.get('NODE_ENV') === 'development' ? (['error', 'warn'] as any) : false,
        };

        // Prefer DATABASE_URL if provided and non-empty
        if (dbUrl && dbUrl.length > 10) {
          return { ...base, url: dbUrl };
        }

        // Fall back to individual params
        return { ...base, host, port: Number(port), username, password: String(password), database };
      },
      inject: [ConfigService],
    }),

    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('REDIS_HOST') ?? 'localhost',
          port: config.get<number>('REDIS_PORT') ?? 6379,
          password: config.get('REDIS_PASSWORD'),
        },
      }),
      inject: [ConfigService],
    }),

    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        ttl: 300, // 5 minutes default
        max: 500,
      }),
      inject: [ConfigService],
    }),

    ThrottlerModule.forRoot([{ ttl: 60000, limit: 30 }]),

    AuthModule,
    UsersModule,
    JobsModule,
    ResumeModule,
    ScanModule,
    AiModule,
    GmailModule,
    CollectorsModule,
    QueuesModule,
  ],
})
export class AppModule {}
