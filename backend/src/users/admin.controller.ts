import { Body, Controller, Get, HttpCode, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { UsersService } from './users.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { BillingCycle } from '../subscription/plans.const';

/** Admin-only views. Guarded by JWT + admin role. */
@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly users: UsersService,
    private readonly subscription: SubscriptionService,
  ) {}

  @Get('users')
  listUsers() {
    return this.users.listAll();
  }

  @Get('stats')
  stats() {
    return this.users.adminStats();
  }

  /** Set any user's subscription plan (demo-mode billing — instant activation). */
  @Patch('users/:id/subscription')
  @HttpCode(200)
  setSubscription(
    @Param('id') id: string,
    @Body('plan') plan: string,
    @Body('billing') billing?: BillingCycle,
  ) {
    return this.subscription.setPlanForUser(id, plan, billing || 'monthly');
  }
}
