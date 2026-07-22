import { Controller, Get, Post, Query, Req, UseGuards, HttpCode } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EarningsService } from './earnings.service';

@Controller('earnings')
@UseGuards(JwtAuthGuard)
export class EarningsController {
  constructor(private readonly svc: EarningsService) {}

  @Get('summary')
  summary(
    @Req() req: Request,
    @Query('period') period: '7d' | '30d' | '90d' | 'all' = '30d',
  ) {
    return this.svc.summary((req.user as any).id, period);
  }

  @Get()
  list(
    @Req() req: Request,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.list((req.user as any).id, +page, +limit, status, from, to);
  }

  @Post('sync')
  @HttpCode(200)
  sync(@Req() req: Request) {
    return this.svc.sync((req.user as any).id);
  }

  /** "What actually earns" — commissions by keyword/campaign merged with click data. */
  @Get('attribution')
  attribution(@Req() req: Request) {
    return this.svc.attributionSummary((req.user as any).id);
  }
}
