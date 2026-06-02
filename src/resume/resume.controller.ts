import { Body, Controller, Delete, Get, Post, Put, Request, UseGuards, BadRequestException } from '@nestjs/common';
import { ResumeService } from './resume.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('resume')
export class ResumeController {
  constructor(private readonly resumeService: ResumeService) {}

  @Get()
  get(@Request() req: any) {
    return this.resumeService.getOrCreate(req.user.id);
  }

  @Put()
  async save(@Request() req: any, @Body() body: any) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, userId, createdAt, updatedAt, ...data } = body;
    const resume = await this.resumeService.save(req.user.id, data);
    // Queue re-analysis of existing job matches with updated resume (fire & forget)
    // Returns the session so the frontend can poll progress
    const session = await this.resumeService.queueReanalyze(req.user.id).catch(() => null);
    return { ...resume, reanalyzeSession: session?.id ?? null };
  }

  /** Manually trigger re-analysis without changing resume data */
  @Post('reanalyze')
  reanalyze(@Request() req: any) {
    return this.resumeService.queueReanalyze(req.user.id);
  }

  @Delete('upload-pdf')
  deletePdf(@Request() req: any) {
    return this.resumeService.deletePdf(req.user.id);
  }

  /** Upload PDF resume as base64. Body: { fileBase64: string, fileName: string } */
  @Post('upload-pdf')
  async uploadPdf(@Request() req: any, @Body() body: { fileBase64: string; fileName: string }) {
    if (!body.fileBase64) throw new BadRequestException('fileBase64 is required');
    const resume = await this.resumeService.savePdf(req.user.id, body.fileBase64, body.fileName ?? 'resume.pdf');
    return { message: 'Resume PDF saved', fileName: resume.resumeFileName };
  }
}
