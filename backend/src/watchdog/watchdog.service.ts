import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { Post } from '../posts/post.entity';
import { Campaign } from '../campaigns/campaign.entity';
import { User } from '../users/user.entity';
import { MailService } from '../mail/mail.service';
import { SecurityService } from '../security/security.service';
import { CredentialsService } from '../credentials/credentials.service';

/**
 * 24/7 self-monitoring. Every 15 minutes the watchdog scans for anomalies that
 * historically required the owner to notice by eye — stuck scheduled posts, a
 * failure spike, campaigns whose runs stopped — and REPORTS them:
 *
 *  1. GitHub issue (when GITHUB_WATCHDOG_TOKEN is set): title-prefixed
 *     '[watchdog]', full Hebrew diagnostics. A scheduled Claude session polls
 *     these hourly, investigates, fixes and pushes — closing the loop without
 *     the owner in the middle.
 *  2. Email to every admin (best effort, needs SMTP).
 *
 * Each anomaly key is throttled (6h) so a persisting condition doesn't spam,
 * and the GitHub reporter also dedupes against open '[watchdog]' issues.
 */
@Injectable()
export class WatchdogService {
  private readonly logger = new Logger(WatchdogService.name);
  private running = false;
  /** anomaly key → last-reported ms; suppresses repeats for THROTTLE_MS. */
  private readonly reported = new Map<string, number>();
  private static readonly THROTTLE_MS = 6 * 60 * 60 * 1000;

  constructor(
    @InjectRepository(Post) private readonly posts: Repository<Post>,
    @InjectRepository(Campaign) private readonly campaigns: Repository<Campaign>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly mail: MailService,
    private readonly credentials: CredentialsService,
    private readonly security: SecurityService,
  ) {}

  @Cron('0 */15 * * * *')
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const anomalies = await this.scan();
      for (const a of anomalies) {
        const last = this.reported.get(a.key) || 0;
        if (Date.now() - last < WatchdogService.THROTTLE_MS) continue;
        this.reported.set(a.key, Date.now());
        this.logger.warn(`Watchdog: ${a.key} — ${a.title}`);
        await this.reportGithub(a).catch((err) => this.logger.warn(`watchdog github failed: ${err?.message}`));
        await this.reportTelegram(a).catch((err) => this.logger.warn(`watchdog telegram failed: ${err?.message}`));
        await this.reportEmail(a).catch(() => {});
      }
    } catch (err: any) {
      this.logger.error(`Watchdog tick failed: ${err?.message}`);
    } finally {
      this.running = false;
    }
  }

  // ── Checks ────────────────────────────────────────────────────────────────

  private async scan(): Promise<Array<{ key: string; title: string; body: string }>> {
    const out: Array<{ key: string; title: string; body: string }> = [];
    const now = Date.now();

    // 1. Scheduled posts stuck: due for over 90 minutes. The backlog drip legitimately
    //    delays a due post up to one group interval (usually 60m) — beyond that, the
    //    release pipeline is broken (this exact failure shipped once: the group clock
    //    was stamped by Instagram-only posts and Telegram posts sat on 'מתוזמן' all day).
    const stuck = await this.posts.createQueryBuilder('p')
      .select(['p.id', 'p.user_id', 'p.product_title', 'p.scheduled_at', 'p.channel_override', 'p.campaign_id'])
      .where("p.status = 'scheduled'")
      .andWhere('p.scheduled_at < :cutoff', { cutoff: new Date(now - 90 * 60_000) })
      .orderBy('p.scheduled_at', 'ASC')
      .take(20)
      .getMany();
    if (stuck.length) {
      const oldest = new Date(stuck[0].scheduled_at).toISOString();
      out.push({
        key: `stuck_scheduled:${stuck[0].user_id}`,
        title: `${stuck.length}+ פוסטים מתוזמנים תקועים (הישן ביותר: ${oldest})`,
        body: [
          `**בדיקה:** פוסטים בסטטוס scheduled שמועדם עבר לפני יותר מ-90 דקות.`,
          `**נמצאו:** ${stuck.length} (מוצגים עד 20).`,
          '',
          ...stuck.map((p) => `- \`${p.id}\` · user \`${p.user_id}\` · group \`${p.channel_override || 'default'}\` · scheduled_at ${new Date(p.scheduled_at).toISOString()} · ${String(p.product_title || '').slice(0, 40)}`),
          '',
          'כיווני חקירה: findDueScheduledPosts (דריפ + lastTelegramSendToGroup), sendScheduled/markSent, sendScheduledPosts בסקדולר.',
        ].join('\n'),
      });
    }

    // 2. Failure spike: more than 5 posts failed within the last hour.
    const failRow = await this.posts.createQueryBuilder('p')
      .select('COUNT(*)', 'n')
      .where("p.status = 'failed'")
      .andWhere('p.created_at > :cutoff', { cutoff: new Date(now - 60 * 60_000) })
      .getRawOne();
    const failed = parseInt(failRow?.n, 10) || 0;
    if (failed > 5) {
      const samples = await this.posts.createQueryBuilder('p')
        .select(['p.id', 'p.user_id', 'p.error_message'])
        .where("p.status = 'failed'")
        .andWhere('p.created_at > :cutoff', { cutoff: new Date(now - 60 * 60_000) })
        .take(8)
        .getMany();
      out.push({
        key: 'failure_spike',
        title: `${failed} פוסטים נכשלו בשעה האחרונה`,
        body: [
          `**בדיקה:** קצב כשלונות חריג (מעל 5 בשעה).`,
          '',
          'דוגמאות שגיאה:',
          ...samples.map((p) => `- \`${p.id}\`: ${String(p.error_message || '').slice(0, 160)}`),
        ].join('\n'),
      });
    }

    // 3. Campaign runs stopped: an ACTIVE campaign whose next_run_at is more than
    //    30 minutes in the past means the scheduler is skipping/crashing on it.
    const dead = await this.campaigns.createQueryBuilder('c')
      .select(['c.id', 'c.name', 'c.user_id', 'c.next_run_at', 'c.schedule_cron'])
      .where("c.status = 'active'")
      .andWhere('c.next_run_at < :cutoff', { cutoff: new Date(now - 30 * 60_000) })
      .take(10)
      .getMany();
    if (dead.length) {
      out.push({
        key: `dead_campaigns:${dead.map((c) => c.id).sort().join(',').slice(0, 60)}`,
        title: `${dead.length} קמפיינים פעילים שהריצה שלהם לא מתקדמת`,
        body: [
          `**בדיקה:** קמפיין active עם next_run_at שעבר לפני יותר מ-30 דקות — הסקדולר מדלג או קורס עליהם.`,
          '',
          ...dead.map((c) => `- "${c.name}" \`${c.id}\` · cron \`${c.schedule_cron}\` · next_run_at ${c.next_run_at ? new Date(c.next_run_at).toISOString() : 'null'}`),
          '',
          'כיווני חקירה: runDueCampaigns (this.running נתקע?), markRun/CronTime, חריגות בלוגים של Render.',
        ].join('\n'),
      });
    }

    // 4. Security anomalies (brute-force, privilege escalation) from the audit log.
    //    Reported through the same channels; the 6h throttle per key still applies so
    //    an ongoing attack alerts once, not every 15 minutes.
    const sec = await this.security.scan().catch(() => []);
    out.push(...sec);

    return out;
  }

  // ── Reporters ─────────────────────────────────────────────────────────────

  /** Open a GitHub issue (deduped against open '[watchdog]' issues by title). */
  private async reportGithub(a: { key: string; title: string; body: string }): Promise<void> {
    const token = process.env.GITHUB_WATCHDOG_TOKEN;
    if (!token) return;
    const repo = process.env.GITHUB_WATCHDOG_REPO || 'reuvenre/Nexlify';
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const title = `[watchdog] ${a.title}`;

    // Dedupe: an open watchdog issue with the same title means it's already being handled.
    const open = await axios.get(
      `https://api.github.com/repos/${repo}/issues?state=open&per_page=50`,
      { headers, timeout: 15000 },
    );
    if ((open.data || []).some((i: any) => i.title === title)) return;

    await axios.post(
      `https://api.github.com/repos/${repo}/issues`,
      {
        title,
        body: [
          a.body,
          '',
          '---',
          `_נפתח אוטומטית על ידי ה-Watchdog · ${new Date().toISOString()} · key: \`${a.key}\`_`,
          '_Claude: אחרי תיקון — סגור את ה-issue עם תגובה קצרה מה תוקן._',
        ].join('\n'),
      },
      { headers, timeout: 15000 },
    );
  }

  /**
   * Instant Telegram DM to the owner's personal chat, sent with the admin's own
   * bot (the one already posting to the groups). Needs WATCHDOG_TELEGRAM_CHAT_ID
   * (the owner's numeric Telegram ID — from @userinfobot) and the owner having
   * opened a private chat with the bot (/start) so it is allowed to DM them.
   * WATCHDOG_TELEGRAM_BOT_TOKEN overrides the bot when set.
   */
  private async reportTelegram(a: { title: string; body: string }): Promise<void> {
    const text = [
      `⚠️ Nexlify Watchdog זיהה תקלה:`,
      ``,
      `${a.title}`,
      ``,
      `נפתח Issue אוטומטי ב-GitHub — Claude יטפל בבדיקה הקרובה (כל 4 שעות) ויעדכן בשיחה.`,
    ].join('\n');
    await this.sendTelegram(text);
  }

  /** Resolve the watchdog bot token: explicit override, else the admin's group bot. */
  private async telegramToken(): Promise<string | null> {
    if (process.env.WATCHDOG_TELEGRAM_BOT_TOKEN) return process.env.WATCHDOG_TELEGRAM_BOT_TOKEN;
    const admins = await this.users.find({ where: { role: 'admin' } });
    for (const admin of admins) {
      const t = await this.credentials.getTelegramToken(admin.id).catch(() => null);
      if (t) return t;
    }
    return null;
  }

  /** Low-level send to the owner's watchdog chat. No-op (returns false) when unconfigured. */
  private async sendTelegram(text: string): Promise<boolean> {
    const chatId = process.env.WATCHDOG_TELEGRAM_CHAT_ID;
    if (!chatId) return false;
    const token = await this.telegramToken();
    if (!token) return false;
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId, text,
    }, { timeout: 12000 });
    return true;
  }

  /**
   * Send a test alert NOW and return a precise diagnostic — so "did I set the
   * Telegram vars right?" is answerable from an admin button instead of waiting
   * for a real anomaly. Distinguishes missing config from Telegram's own errors
   * (chat not found / bot blocked / bad token).
   */
  async sendTestAlert(): Promise<{ ok: boolean; error?: string }> {
    if (!process.env.WATCHDOG_TELEGRAM_CHAT_ID) {
      return { ok: false, error: 'חסר WATCHDOG_TELEGRAM_CHAT_ID ב-Render' };
    }
    if (!(await this.telegramToken())) {
      return { ok: false, error: 'לא נמצא טוקן בוט — הגדר WATCHDOG_TELEGRAM_BOT_TOKEN או טוקן טלגרם לאדמין' };
    }
    try {
      await this.sendTelegram('✅ בדיקת Nexlify Watchdog — אם קיבלת את ההודעה הזו, התראות התקלות מוגדרות ופעילות. 🎉');
      return { ok: true };
    } catch (err: any) {
      const tg = err?.response?.data?.description;
      return { ok: false, error: `טלגרם דחה: ${tg || err?.message || err}. ודא שלחצת Start על הבוט ושה-Chat ID נכון.` };
    }
  }

  /** Email every admin (best effort — needs working SMTP). */
  private async reportEmail(a: { title: string; body: string }): Promise<void> {
    if (!this.mail.isConfigured()) return;
    const admins = await this.users.find({ where: { role: 'admin' } });
    const html = `<div dir="rtl" style="font-family:Arial,sans-serif;padding:16px">
      <h3>⚠️ Nexlify Watchdog — ${a.title}</h3>
      <pre dir="ltr" style="background:#f5f5f5;padding:12px;border-radius:8px;white-space:pre-wrap;text-align:left">${a.body.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>
      <p>ה-issue המלא נפתח אוטומטית ב-GitHub ומטופל על ידי Claude.</p>
    </div>`;
    for (const admin of admins) {
      await this.mail.sendHtml(admin.email, `⚠️ Nexlify Watchdog: ${a.title}`, html).catch(() => {});
    }
  }
}
