import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationPref } from './notification-pref.entity';
import { Post } from '../posts/post.entity';
import { Earning } from '../earnings/earning.entity';
import { User } from '../users/user.entity';
import { MailService } from '../mail/mail.service';

const TZ = process.env.SCHEDULER_TZ || 'Asia/Jerusalem';

/** yyyy-mm-dd in the product's timezone — the digest is a *local* day, not a UTC one. */
function dayKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
}
/** Hour 0-23 in the product's timezone. */
function hourIn(d: Date): number {
  const h = new Intl.DateTimeFormat('en-US', { hour: '2-digit', hour12: false, timeZone: TZ }).format(d);
  const n = parseInt(h, 10);
  return n === 24 ? 0 : n;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(NotificationPref) private readonly repo: Repository<NotificationPref>,
    @InjectRepository(Post) private readonly posts: Repository<Post>,
    @InjectRepository(Earning) private readonly earnings: Repository<Earning>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly mail: MailService,
  ) {}

  async get(userId: string): Promise<NotificationPref> {
    const found = await this.repo.findOne({ where: { user_id: userId } });
    if (found) return found;
    return this.repo.create({ user_id: userId, daily_summary: false, campaign_errors: false });
  }

  async upsert(userId: string, dto: { daily_summary?: boolean; campaign_errors?: boolean }) {
    const row = (await this.repo.findOne({ where: { user_id: userId } }))
      || this.repo.create({ user_id: userId });
    if (dto.daily_summary !== undefined) row.daily_summary = dto.daily_summary;
    if (dto.campaign_errors !== undefined) row.campaign_errors = dto.campaign_errors;
    return this.repo.save(row);
  }

  /** True when email can actually be delivered — the UI shows this instead of pretending. */
  smtpReady(): boolean {
    return this.mail.isConfigured();
  }

  // ── Daily summary ─────────────────────────────────────────────────────────

  /**
   * Send the digest to everyone who opted in, once per local day, at/after `sendHour`.
   * Driven by an hourly cron; `last_daily_sent_on` is the idempotency key.
   */
  async runDailySummaries(sendHour = 9): Promise<void> {
    if (!this.mail.isConfigured()) return; // nothing to send with — stay silent, don't spin
    const now = new Date();
    if (hourIn(now) < sendHour) return;
    const today = dayKey(now);

    const opted = await this.repo.find({ where: { daily_summary: true } });
    for (const pref of opted) {
      if (pref.last_daily_sent_on === today) continue; // already went out today
      try {
        const sent = await this.sendDailySummary(pref.user_id, now);
        if (sent) {
          pref.last_daily_sent_on = today;
          await this.repo.save(pref);
        }
      } catch (err: any) {
        this.logger.error(`Daily summary failed for ${pref.user_id}: ${err.message}`);
      }
    }
  }

  /** Build + send one user's digest from real data. Returns false if there's no address. */
  async sendDailySummary(userId: string, now = new Date()): Promise<boolean> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user?.email) return false;

    // The window is the local day so far — matches what the user sees in the dashboard.
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    const [sentToday, failedToday, queued, earningsToday] = await Promise.all([
      this.posts.createQueryBuilder('p')
        .where('p.user_id = :userId AND p.status = :s', { userId, s: 'sent' })
        .andWhere('p.sent_at >= :start', { start }).getCount(),
      this.posts.createQueryBuilder('p')
        .where('p.user_id = :userId AND p.status = :s', { userId, s: 'failed' })
        .andWhere('p.created_at >= :start', { start }).getCount(),
      this.posts.count({ where: { user_id: userId, status: 'queued' } }),
      this.earnings.createQueryBuilder('e')
        .select('COUNT(*)', 'orders')
        .addSelect('COALESCE(SUM(e.commission_ils), 0)', 'commission')
        .where('e.user_id = :userId', { userId })
        .andWhere("e.status <> 'cancelled'")
        .andWhere('e.order_date >= :start', { start })
        .getRawOne(),
    ]);

    const orders = parseInt(earningsToday?.orders, 10) || 0;
    const commission = +(parseFloat(earningsToday?.commission) || 0).toFixed(2);
    const dateLabel = now.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', timeZone: TZ });

    const row = (label: string, value: string) =>
      `<tr><td style="padding:8px 0;color:#6b7280;font-size:14px;">${label}</td>
           <td style="padding:8px 0;text-align:left;font-weight:600;font-size:14px;">${value}</td></tr>`;

    const html = `
      <div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111;">
        <div style="padding:20px 24px;background:#6366f1;color:#fff;border-radius:12px 12px 0 0;">
          <strong style="font-size:18px;">Nexlify — סיכום יומי</strong>
          <div style="opacity:.85;font-size:13px;margin-top:2px;">${dateLabel}</div>
        </div>
        <div style="padding:20px 24px;border:1px solid #eee;border-top:0;border-radius:0 0 12px 12px;">
          <table style="width:100%;border-collapse:collapse;">
            ${row('פוסטים שנשלחו היום', String(sentToday))}
            ${row('פוסטים שנכשלו', failedToday ? `<span style="color:#dc2626;">${failedToday}</span>` : '0')}
            ${row('ממתינים בתור', String(queued))}
            ${row('הזמנות חדשות', String(orders))}
            ${row('עמלות היום', `₪${commission.toFixed(2)}`)}
            ${row('קרדיטים שנותרו', String(user.credits_remaining ?? 0))}
          </table>
          ${failedToday
            ? `<p style="margin-top:16px;padding:10px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b;font-size:13px;">
                 ${failedToday} פוסטים נכשלו היום — כדאי לבדוק במסך "ניהול פוסטים".
               </p>` : ''}
          <p style="color:#9ca3af;font-size:11px;margin-top:18px;">
            קיבלת את המייל הזה כי הפעלת "סיכום ביצועים יומי" בהגדרות ← התראות.
          </p>
        </div>
      </div>`;

    await this.mail.sendHtml(user.email, `Nexlify — סיכום יומי · ${dateLabel}`, html);
    this.logger.log(`Daily summary sent to ${user.email}`);
    return true;
  }

  // ── Campaign error alert ──────────────────────────────────────────────────

  /**
   * Alert on a failed campaign run. Best-effort and never throws: it is called from the
   * scheduler's catch block, and a broken mailer must not break error handling itself.
   */
  async notifyCampaignError(userId: string, campaignName: string, message: string): Promise<void> {
    try {
      if (!this.mail.isConfigured()) return;
      const pref = await this.repo.findOne({ where: { user_id: userId } });
      if (!pref?.campaign_errors) return;
      const user = await this.users.findOne({ where: { id: userId } });
      if (!user?.email) return;

      const safe = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const html = `
        <div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111;">
          <div style="padding:20px 24px;background:#dc2626;color:#fff;border-radius:12px 12px 0 0;">
            <strong style="font-size:17px;">Nexlify — קמפיין נכשל</strong>
          </div>
          <div style="padding:20px 24px;border:1px solid #eee;border-top:0;border-radius:0 0 12px 12px;">
            <p style="font-size:14px;">הקמפיין <b>${safe(campaignName)}</b> נתקל בשגיאה ולא הושלם:</p>
            <pre style="background:#f9fafb;border:1px solid #eee;border-radius:8px;padding:10px;font-size:12px;white-space:pre-wrap;">${safe(message)}</pre>
            <p style="color:#9ca3af;font-size:11px;margin-top:18px;">
              קיבלת את המייל הזה כי הפעלת "שגיאות קמפיין" בהגדרות ← התראות.
            </p>
          </div>
        </div>`;
      await this.mail.sendHtml(user.email, `Nexlify — הקמפיין "${campaignName}" נכשל`, html);
    } catch (err: any) {
      this.logger.warn(`Campaign-error alert failed for ${userId}: ${err.message}`);
    }
  }
}
