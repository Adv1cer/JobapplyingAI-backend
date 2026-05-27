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

@Controller('gmail')
@UseGuards(JwtAuthGuard)
export class GmailController {
  constructor(
    private readonly gmailService: GmailService,
    @InjectRepository(JobMatch)
    private readonly jobMatchRepo: Repository<JobMatch>,
  ) {}

  @Get('auth')
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
  async getStatus(@Req() req: any) {
    return this.gmailService.isConnected(req.user.id);
  }

  @Post('draft')
  async createDraft(@Req() req: any, @Body() dto: CreateDraftDto) {
    const { draftId, threadId } = await this.gmailService.createDraft(
      req.user.id,
      dto.to,
      dto.subject,
      dto.body,
    );

    // Link draft to job match if provided
    if (dto.jobMatchId) {
      await this.jobMatchRepo.update(dto.jobMatchId, { gmailDraftId: draftId });
    }

    return { draftId, threadId, message: 'Draft created. Open Gmail to review and send.' };
  }

  @Delete('disconnect')
  async disconnect(@Req() req: any) {
    await this.gmailService.disconnect(req.user.id);
    return { message: 'Gmail disconnected' };
  }
}
