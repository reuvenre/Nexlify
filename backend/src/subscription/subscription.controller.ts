import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SubscriptionService } from './subscription.service';
import { BillingCycle } from './plans.const';

@Controller('subscription')
@UseGuards(JwtAuthGuard)
export class SubscriptionController {
  constructor(private readonly svc: SubscriptionService) {}

  private uid(req: Request): string { return (req.user as any).id; }

  /** Current plan, credit balance and limits for the logged-in user. */
  @Get()
  status(@Req() req: Request) {
    return this.svc.getStatus(this.uid(req));
  }

  /** Plan catalog (prices/credits/limits) — single source of truth for the UI. */
  @Get('plans')
  plans() {
    return this.svc.listPlans();
  }

  /** Demo-mode purchase: activates the chosen plan immediately (no payment). */
  @Post('switch')
  @HttpCode(200)
  switch(
    @Req() req: Request,
    @Body('plan') plan: string,
    @Body('billing') billing?: BillingCycle,
  ) {
    return this.svc.switchPlan(this.uid(req), plan, billing || 'monthly');
  }
}
