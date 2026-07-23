import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SubscriptionService } from './subscription.service';

@Controller('subscription')
export class SubscriptionController {
  constructor(private readonly svc: SubscriptionService) {}

  private uid(req: Request): string { return (req.user as any).id; }

  /** Current plan, credit balance and limits for the logged-in user. */
  @Get()
  @UseGuards(JwtAuthGuard)
  status(@Req() req: Request) {
    return this.svc.getStatus(this.uid(req));
  }

  /** Plan catalog (prices/credits/limits) — single source of truth for the UI.
   *  PUBLIC: the marketing /pricing page renders it before signup. Contains no
   *  user data — just the static plan definitions. */
  @Get('plans')
  plans() {
    return this.svc.listPlans();
  }

  /** One-time credit-pack catalog (public, static). Purchase itself goes through
   *  the team (admin grants via POST /admin/users/:id/credits) until a payment
   *  gateway is wired — same policy as plan upgrades. */
  @Get('packs')
  packs() {
    return this.svc.listPacks();
  }

  /** Self-service upgrade (confirm-dialog flow). With a payment gateway configured
   *  this returns a checkout redirect; until then it records the request for manual
   *  activation. Never activates a paid tier by itself. */
  @Post('upgrade')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  upgrade(@Req() req: Request, @Body('plan') plan: string, @Body('billing') billing?: string) {
    return this.svc.requestUpgrade(this.uid(req), plan, billing as any);
  }

  // NOTE: there is deliberately NO self-service plan-switch route. Plans are paid,
  // and no payment gateway is wired yet, so letting a user POST their own plan was a
  // free-upgrade hole (any user could grant themselves the top tier). Plan changes go
  // through the admin path (PATCH /admin/users/:id/subscription → setPlanForUser) until
  // a real payment gateway + webhook is added, which will call setPlanForUser on success.
}
