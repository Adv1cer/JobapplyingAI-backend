import {
  Controller, Get, Post, Delete, Param,
  Request, UseGuards, Body, Query,
} from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get('dashboard')
  getDashboard(@Request() req: any) {
    return this.jobsService.getDashboardStats(req.user.id);
  }

  @Get('matches')
  getMatches(
    @Request() req: any,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('includeExpired') includeExpired = 'false',
  ) {
    return this.jobsService.getJobMatches(
      req.user.id,
      Math.max(1, parseInt(page, 10) || 1),
      Math.min(50, Math.max(1, parseInt(limit, 10) || 10)),
      includeExpired === 'true',
    );
  }

  @Get('saved')
  getSaved(@Request() req: any) {
    return this.jobsService.getSavedJobs(req.user.id);
  }

  @Post(':id/confirm')
  confirm(@Request() req: any, @Param('id') id: string) {
    return this.jobsService.confirmApplication(req.user.id, id);
  }

  @Delete(':id/discard')
  discard(@Request() req: any, @Param('id') id: string) {
    return this.jobsService.discardJob(req.user.id, id);
  }

  @Post(':id/save')
  saveJob(@Request() req: any, @Param('id') id: string) {
    return this.jobsService.saveJob(req.user.id, id);
  }

  @Delete(':id/save')
  unsaveJob(@Request() req: any, @Param('id') id: string) {
    return this.jobsService.unsaveJob(req.user.id, id);
  }

  @Post(':id/cover-letter')
  regenerateCoverLetter(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { language?: 'TH' | 'EN' },
  ) {
    return this.jobsService.regenerateCoverLetter(req.user.id, id, body.language);
  }

  @Delete('clear/pending')
  clearPending(@Request() req: any) {
    return this.jobsService.clearPendingJobs(req.user.id);
  }

  @Delete('clear/all')
  clearAll(@Request() req: any) {
    return this.jobsService.clearAllJobs(req.user.id);
  }

  /**
   * GET /jobs/:id/hr-email
   * Look up HR / recruiter email addresses for the company that posted this job.
   * Calls Hunter.io API (requires HUNTER_API_KEY env var).
   * Results are cached in-process and persisted to the job match record.
   */
  @Get(':id/hr-email')
  getHrEmail(@Request() req: any, @Param('id') id: string) {
    return this.jobsService.getHrEmails(req.user.id, id);
  }

  @Get('bots')
  getBots(@Request() req: any) { return this.jobsService.getActiveBots(req.user.id); }

  @Get('interviews')
  getInterviews(@Request() req: any) { return this.jobsService.getUpcomingInterviews(req.user.id); }
}
