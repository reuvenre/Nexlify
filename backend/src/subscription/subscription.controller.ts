import { Controller, Get, Req, UseGuards } from '@nestjs/common';
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

  // NOTE: there is deliberately NO self-service plan-switch route. Plans are paid,
  // and no payment gateway is wired yet, so letting a user POST their own plan was a
  // free-upgrade hole (any user could grant themselves the top tier). Plan changes go
  // through the admin path (PATCH /admin/users/:id/subscription → setPlanForUser) until
  // a real payment gateway + webhook is added, which will call setPlanForUser on success.
}
