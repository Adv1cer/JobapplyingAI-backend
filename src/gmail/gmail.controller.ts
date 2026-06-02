import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Body,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { GmailService } from './gmail.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateDraftDto } from './dto/create-draft.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobMatch } from '../jobs/entities/job-match.entity';
import { Resume } from '../resume/resume.entity';

@Controller('gmail')
export class GmailController {
  constructor(
    private readonly gmailService: GmailService,
    @InjectRepository(JobMatch)
    private readonly jobMatchRepo: Repository<JobMatch>,
    @InjectRepository(Resume)
    private readonly resumeRepo: Repository<Resume>,
  ) {}

  @Get('auth')
  @UseGuards(JwtAuthGuard)
  getAuthUrl(@Req() req: any) {
    const url = this.gmailService.getAuthUrl(req.user.id);
    return { url };
  }

  @Get('callback')
  async handleCallback(@Query('code') code: string, @Query('state') userId: string, @Res() res: Response) {
    await this.gmailService.handleCallback(code, userId);
    const frontendUrl = process.env.BASEURL ?? 'http://localhost:3000';
    res.redirect(`${frontendUrl}/dashboard?gmail=connected`);
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  async getStatus(@Req() req: any) {
    return this.gmailService.isConnected(req.user.id);
  }

  @Post('draft')
  @UseGuards(JwtAuthGuard)
  async createDraft(@Req() req: any, @Body() dto: CreateDraftDto) {
    // Attach resume PDF if stored
    const resume = await this.resumeRepo.findOne({ where: { userId: req.user.id } });
    const attachmentBase64 = resume?.resumeFilePdf ?? undefined;
    const attachmentName = resume?.resumeFileName ?? undefined;

    const { draftId, threadId } = await this.gmailService.createDraft(
      req.user.id,
      dto.to,
      dto.subject,
      dto.body,
      attachmentBase64,
      attachmentName,
    );

    if (dto.jobMatchId) {
      await this.jobMatchRepo.update(dto.jobMatchId, {
        gmailDraftId: draftId,
        gmailThreadId: threadId,
        status: 'drafted',
      });
    }

    return { draftId, threadId, message: 'Draft created. Open Gmail to review and send.' };
  }

  @Post('check-sent')
  @UseGuards(JwtAuthGuard)
  async checkSent(@Req() req: any, @Body() body: { jobMatchId: string }) {
    const job = await this.jobMatchRepo.findOne({
      where: { id: body.jobMatchId, userId: req.user.id },
    });
    if (!job?.gmailThreadId) return { applied: false };

    const sent = await this.gmailService.checkDraftSent(req.user.id, job.gmailThreadId);
    if (sent && job.status !== 'applied') {
      await this.jobMatchRepo.update(job.id, { status: 'applied' });
    }
    return { applied: sent };
  }

  @Delete('disconnect')
  @UseGuards(JwtAuthGuard)
  async disconnect(@Req() req: any) {
    await this.gmailService.disconnect(req.user.id);
    return { message: 'Gmail disconnected' };
  }
}
