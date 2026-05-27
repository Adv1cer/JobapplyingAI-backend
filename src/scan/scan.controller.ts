import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ScanService } from './scan.service';
import { ScanFiltersDto } from './dto/scan-filters.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('scan')
export class ScanController {
  constructor(private readonly scanService: ScanService) {}

  @Post('start')
  start(@Request() req: any, @Body() dto: ScanFiltersDto) {
    return this.scanService.startScan(req.user.id, dto);
  }

  @Get('status/:id')
  getStatus(@Request() req: any, @Param('id') id: string) {
    return this.scanService.getStatus(req.user.id, id);
  }

  @Get('latest')
  getLatest(@Request() req: any) {
    return this.scanService.getLatestSession(req.user.id);
  }
}
