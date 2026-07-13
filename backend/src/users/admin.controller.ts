import {
  BadRequestException, Body, Controller, Get, HttpCode, Param, Patch, Post, Req, UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { UsersService } from './users.service';
import { MailService } from '../mail/mail.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { BillingCycle } from '../subscription/plans.const';

/** Admin-only views + user management. Guarded by JWT + admin role. */
@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly users: UsersService,
    private readonly subscription: SubscriptionService,
    private readonly mail: MailService,
  ) {}

  private uid(req: Request) { return (req.user as any).id; }

  @Get('users')
  listUsers() {
    return this.users.listAll();
  }

  @Get('stats')
  stats() {
    return this.users.adminStats();
  }

  /** Create a new user (admin). Optionally sets an initial plan. */
  @Post('users')
  @HttpCode(201)
  async createUser(
    @Body('email') email: string,
    @Body('password') password: string,
    @Body('role') role?: 'user' | 'admin',
    @Body('plan') plan?: string,
  ) {
    const user = await this.users.adminCreate(email, password, role === 'admin' ? 'admin' : 'user');
    if (plan) await this.subscription.setPlanForUser(user.id, plan, 'monthly').catch(() => undefined);
    return this.users.toPublic(user);
  }

  /** Change a user's role. An admin cannot demote their OWN account (avoids lockout). */
  @Patch('users/:id/role')
  @HttpCode(200)
  async setRole(@Req() req: Request, @Param('id') id: string, @Body('role') role: string) {
    if (id === this.uid(req) && role !== 'admin') {
      throw new BadRequestException('אי אפשר להסיר לעצמך הרשאת אדמין');
    }
    await this.users.setRole(id, role);
    return { ok: true };
  }

  /** Block / unblock a user. An admin cannot block their OWN account. */
  @Patch('users/:id/block')
  @HttpCode(200)
  async setBlocked(@Req() req: Request, @Param('id') id: string, @Body('blocked') blocked: boolean) {
    if (id === this.uid(req) && blocked) {
      throw new BadRequestException('אי אפשר לחסום את עצמך');
    }
    await this.users.setBlocked(id, blocked === true);
    return { ok: true, blocked: blocked === true };
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

  /**
   * Send a broadcast email to users. `target`: 'all' | 'users' | 'admins'. Sends
   * sequentially (SMTP-friendly) and reports how many were delivered. When SMTP isn't
   * configured, nothing is delivered and `smtp_configured:false` is returned.
   */
  @Post('broadcast')
  @HttpCode(200)
  async broadcast(
    @Body('subject') subject: string,
    @Body('message') message: string,
    @Body('target') target?: 'all' | 'users' | 'admins',
  ) {
    if (!subject?.trim() || !message?.trim()) {
      throw new BadRequestException('נא למלא נושא ותוכן להודעה');
    }
    const recipients = await this.users.recipients(target || 'all');
    if (!recipients.length) throw new BadRequestException('אין נמענים מתאימים');

    if (!this.mail.isConfigured()) {
      return { smtp_configured: false, total: recipients.length, sent: 0, failed: 0 };
    }
    let sent = 0, failed = 0;
    for (const r of recipients) {
      const ok = await this.mail.sendBroadcast(r.email, subject.trim(), message.trim()).catch(() => false);
      if (ok) sent++; else failed++;
    }
    return { smtp_configured: true, total: recipients.length, sent, failed };
  }
}
