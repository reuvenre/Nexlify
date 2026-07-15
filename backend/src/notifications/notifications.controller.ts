import { Body, Controller, Get, Patch, Post, Req, UseGuards, HttpCode } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  private uid(req: Request) { return (req.user as any).id; }

  @Get()
  async get(@Req() req: Request) {
    const pref = await this.svc.get(this.uid(req));
    return {
      daily_summary: pref.daily_summary,
      campaign_errors: pref.campaign_errors,
      last_daily_sent_on: pref.last_daily_sent_on ?? null,
      // Without SMTP nothing can actually be delivered — the UI says so rather than
      // letting the user switch on a notification that silently never arrives.
      smtp_ready: this.svc.smtpReady(),
    };
  }

  @Patch()
  update(@Req() req: Request, @Body() dto: { daily_summary?: boolean; campaign_errors?: boolean }) {
    return this.svc.upsert(this.uid(req), dto);
  }

  /** Send the digest to yourself now — proves the wiring instead of waiting a day. */
  @Post('test-daily')
  @HttpCode(200)
  async testDaily(@Req() req: Request) {
    const sent = await this.svc.sendDailySummary(this.uid(req));
    return { sent, smtp_ready: this.svc.smtpReady() };
  }
}
