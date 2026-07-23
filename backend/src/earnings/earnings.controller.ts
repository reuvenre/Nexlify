import { Controller, Get, Post, Query, Req, UseGuards, HttpCode } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EarningsService } from './earnings.service';
import { SubscriptionService } from '../subscription/subscription.service';

@Controller('earnings')
@UseGuards(JwtAuthGuard)
export class EarningsController {
  constructor(
    private readonly svc: EarningsService,
    private readonly subscription: SubscriptionService,
  ) {}

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

  /** "What actually earns" — commissions by keyword/campaign merged with click data.
   *  Growth+ feature: gated so the plan cards stay honest about what each tier gets. */
  @Get('attribution')
  async attribution(@Req() req: Request) {
    const userId = (req.user as any).id;
    await this.subscription.requireFeature(userId, 'attribution_report');
    return this.svc.attributionSummary(userId);
  }
}
