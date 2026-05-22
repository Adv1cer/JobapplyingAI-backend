import { Controller, Get, Post, Delete, Param, Request, UseGuards } from '@nestjs/common';
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
  getMatches(@Request() req: any) {
    return this.jobsService.getJobMatches(req.user.id);
  }

  @Post(':id/confirm')
  confirm(@Request() req: any, @Param('id') id: string) {
    return this.jobsService.confirmApplication(req.user.id, id);
  }

  @Delete(':id/discard')
  discard(@Request() req: any, @Param('id') id: string) {
    return this.jobsService.discardJob(req.user.id, id);
  }

  @Get('bots')
  getBots() {
    return this.jobsService.getActiveBots();
  }

  @Get('interviews')
  getInterviews() {
    return this.jobsService.getUpcomingInterviews();
  }
}
