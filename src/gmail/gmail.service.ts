import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { google } from 'googleapis';
import { GmailToken } from './entities/gmail-token.entity';

@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(GmailToken)
    private readonly tokenRepo: Repository<GmailToken>,
  ) {}

  private getOAuth2Client() {
    return new google.auth.OAuth2(
      this.config.get('GOOGLE_CLIENT_ID'),
      this.config.get('GOOGLE_CLIENT_SECRET'),
      this.config.get('GOOGLE_REDIRECT_URI') ?? 'http://localhost:3001/api/gmail/callback',
    );
  }

  getAuthUrl(userId: string): string {
    const oauth2 = this.getOAuth2Client();
    return oauth2.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/gmail.compose'],
      state: userId,
      prompt: 'consent',
    });
  }

  async handleCallback(code: string, userId: string): Promise<{ email: string }> {
    const oauth2 = this.getOAuth2Client();
    const { tokens } = await oauth2.getToken(code);

    oauth2.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2 });
    const profile = await gmail.users.getProfile({ userId: 'me' });

    const existing = await this.tokenRepo.findOne({ where: { userId } });
    const tokenData = {
      userId,
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token ?? existing?.refreshToken ?? '',
      expiryDate: tokens.expiry_date ? Number(tokens.expiry_date) : undefined,
      email: profile.data.emailAddress ?? '',
    };

    if (existing) {
      await this.tokenRepo.update(existing.id, tokenData);
    } else {
      await this.tokenRepo.save(this.tokenRepo.create(tokenData));
    }

    return { email: tokenData.email };
  }

  async createDraft(
    userId: string,
    to: string,
    subject: string,
    body: string,
  ): Promise<{ draftId: string; threadId: string }> {
    const oauth2 = await this.getAuthedClient(userId);
    const gmail = google.gmail({ version: 'v1', auth: oauth2 });

    const message = this.buildMimeMessage(to, subject, body);
    const encoded = Buffer.from(message).toString('base64url');

    const res = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw: encoded } },
    });

    const draftId = res.data.id!;
    const threadId = res.data.message?.threadId ?? '';

    this.logger.log(`Gmail draft created: ${draftId} for user ${userId}`);
    return { draftId, threadId };
  }

  async isConnected(userId: string): Promise<{ connected: boolean; email?: string }> {
    const token = await this.tokenRepo.findOne({ where: { userId } });
    if (!token) return { connected: false };
    return { connected: true, email: token.email };
  }

  async disconnect(userId: string): Promise<void> {
    await this.tokenRepo.delete({ userId });
  }

  private async getAuthedClient(userId: string) {
    const token = await this.tokenRepo.findOne({ where: { userId } });
    if (!token) throw new UnauthorizedException('Gmail not connected. Please authorize first.');

    const oauth2 = this.getOAuth2Client();
    oauth2.setCredentials({
      access_token: token.accessToken,
      refresh_token: token.refreshToken,
      expiry_date: token.expiryDate ? Number(token.expiryDate) : undefined,
    });

    // Auto-refresh if expired
    if (token.expiryDate && Date.now() > Number(token.expiryDate) - 60_000) {
      const { credentials } = await oauth2.refreshAccessToken();
      await this.tokenRepo.update(token.id, {
        accessToken: credentials.access_token!,
        expiryDate: credentials.expiry_date ? Number(credentials.expiry_date) : undefined,
      });
      oauth2.setCredentials(credentials);
    }

    return oauth2;
  }

  private buildMimeMessage(to: string, subject: string, body: string): string {
    const lines = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      body,
    ];
    return lines.join('\r\n');
  }
}
