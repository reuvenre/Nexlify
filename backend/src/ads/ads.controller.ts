import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdsService } from './ads.service';

@Controller('ads')
@UseGuards(JwtAuthGuard)
export class AdsController {
  constructor(private readonly svc: AdsService) {}

  @Get()
  list(@Req() req: Request) {
    return this.svc.list((req.user as any).id);
  }

  @Get('summary')
  summary(@Req() req: Request) {
    return this.svc.summary((req.user as any).id);
  }

  /** Manually trigger a performance evaluation + boost pass. */
  @Post('run')
  run(@Req() req: Request) {
    return this.svc.runPerformance((req.user as any).id);
  }
}
