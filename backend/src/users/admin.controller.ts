import {
  BadRequestException, Body, Controller, Get, HttpCode, Param, Patch, Post, Req, UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import axios from 'axios';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { UsersService } from './users.service';
import { MailService } from '../mail/mail.service';
import { ChannelsService } from '../channels/channels.service';
import { CredentialsService } from '../credentials/credentials.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { BillingCycle } from '../subscription/plans.const';

type BroadcastChannel = 'email' | 'telegram' | 'whatsapp';

/** Admin-only views + user management. Guarded by JWT + admin role. */
@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly users: UsersService,
    private readonly subscription: SubscriptionService,
    private readonly mail: MailService,
    private readonly channels: ChannelsService,
    private readonly credentials: CredentialsService,
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
   * Multi-channel broadcast. `channels` selects any of email / telegram / whatsapp:
   *  • email    → registered users (`target`: all | users | admins)
   *  • telegram → the admin's saved Telegram groups (announcement)
   *  • whatsapp → the phone numbers pasted in `whatsapp_numbers` (WhatsApp Cloud API)
   * Each channel reports its own delivery counts; a channel that isn't configured returns
   * `configured:false` rather than failing the whole request.
   */
  @Post('broadcast')
  @HttpCode(200)
  async broadcast(
    @Req() req: Request,
    @Body('subject') subject: string,
    @Body('message') message: string,
    @Body('target') target?: 'all' | 'users' | 'admins',
    @Body('channels') channels?: BroadcastChannel[],
    @Body('whatsapp_numbers') whatsappNumbers?: string,
    @Body('whatsapp_mode') whatsappMode?: 'text' | 'template',
    @Body('whatsapp_template_name') waTemplateName?: string,
    @Body('whatsapp_template_lang') waTemplateLang?: string,
    @Body('whatsapp_template_params') waTemplateParams?: string,
  ) {
    const chans: BroadcastChannel[] = Array.isArray(channels) && channels.length ? channels : ['email'];
    const waMode: 'text' | 'template' = whatsappMode === 'template' ? 'template' : 'text';

    // The message body is needed for email/telegram and for the WhatsApp free-text mode
    // (a WhatsApp *template* broadcast carries no free text — it uses the approved template).
    const needsMessage = chans.includes('email') || chans.includes('telegram')
      || (chans.includes('whatsapp') && waMode === 'text');
    if (needsMessage && !message?.trim()) throw new BadRequestException('נא למלא תוכן להודעה');
    if (chans.includes('whatsapp') && waMode === 'template' && !waTemplateName?.trim()) {
      throw new BadRequestException('נא להזין שם תבנית WhatsApp מאושרת');
    }

    const userId = this.uid(req);
    const msg = (message || '').trim();
    const subj = subject?.trim() || 'הודעה מ-Nexlify';
    const result: any = {};

    // ── Email ──
    if (chans.includes('email')) {
      if (!this.mail.isConfigured()) {
        result.email = { configured: false, total: 0, sent: 0, failed: 0 };
      } else {
        const recipients = await this.users.recipients(target || 'all');
        let sent = 0, failed = 0;
        for (const r of recipients) {
          const ok = await this.mail.sendBroadcast(r.email, subj, msg).catch(() => false);
          if (ok) sent++; else failed++;
        }
        result.email = { configured: true, total: recipients.length, sent, failed };
      }
    }

    // ── Telegram groups ──
    if (chans.includes('telegram')) {
      const fallback = await this.credentials.getTelegramToken(userId).catch(() => null);
      result.telegram = await this.channels.broadcastText(userId, msg, fallback);
    }

    // ── WhatsApp (Cloud API → pasted numbers) ──
    if (chans.includes('whatsapp')) {
      const wa = await this.credentials.getWhatsApp(userId);
      const numbers = this.parseNumbers(whatsappNumbers);
      if (!wa) {
        result.whatsapp = { configured: false, total: numbers.length, sent: 0, failed: 0 };
      } else if (!numbers.length) {
        result.whatsapp = { configured: true, total: 0, sent: 0, failed: 0, note: 'no_numbers' };
      } else {
        // Free text only reaches users inside the 24h service window; a cold broadcast
        // needs an APPROVED template (Meta rule). `waMode` picks which path.
        const tplParams = (waTemplateParams || '').split('|').map((s) => s.trim()).filter(Boolean);
        const lastErrors: string[] = [];
        let sent = 0, failed = 0;
        for (const to of numbers) {
          const ok = await (waMode === 'template'
            ? this.sendWhatsAppTemplate(wa.phoneNumberId, wa.token, to, waTemplateName!.trim(), (waTemplateLang || 'he').trim(), tplParams)
            : this.sendWhatsApp(wa.phoneNumberId, wa.token, to, msg)
          ).catch((e: any) => { lastErrors.push(e?.response?.data?.error?.message || e.message); return false; });
          if (ok) sent++; else failed++;
        }
        result.whatsapp = { configured: true, total: numbers.length, sent, failed, mode: waMode };
        if (failed && lastErrors.length) result.whatsapp.error = lastErrors[lastErrors.length - 1];
      }
    }

    return result;
  }

  /** Parse a pasted list of phone numbers (comma/space/newline separated) → E.164 digits. */
  private parseNumbers(raw?: string): string[] {
    if (!raw) return [];
    return Array.from(new Set(
      raw.split(/[\s,;]+/)
        .map((n) => n.replace(/[^\d+]/g, '').replace(/^\+/, ''))
        .filter((n) => n.length >= 8 && n.length <= 15),
    ));
  }

  /** Send one WhatsApp text message via the Cloud API (24h session window only). */
  private async sendWhatsApp(phoneNumberId: string, token: string, to: string, body: string): Promise<boolean> {
    const res = await axios.post(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      { messaging_product: 'whatsapp', to, type: 'text', text: { body, preview_url: false } },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 12000 },
    );
    if (res.data?.error) throw new Error(res.data.error.message);
    return true;
  }

  /**
   * Send one WhatsApp APPROVED-TEMPLATE message via the Cloud API — the only way to reach
   * a user OUTSIDE the 24h window (cold broadcast). `params` fill the template's body
   * variables ({{1}}, {{2}}, …) in order; omit them for a template with no variables.
   */
  private async sendWhatsAppTemplate(
    phoneNumberId: string, token: string, to: string, name: string, lang: string, params: string[],
  ): Promise<boolean> {
    const template: any = { name, language: { code: lang || 'he' } };
    if (params.length) {
      template.components = [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }];
    }
    const res = await axios.post(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      { messaging_product: 'whatsapp', to, type: 'template', template },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 12000 },
    );
    if (res.data?.error) throw new Error(res.data.error.message);
    return true;
  }
}
