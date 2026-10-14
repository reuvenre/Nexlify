import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import { Coupon } from './coupon.entity';
import { Campaign } from '../campaigns/campaign.entity';
import { Post } from '../posts/post.entity';
import { User } from '../users/user.entity';
import { CredentialsService } from '../credentials/credentials.service';
import { PersistentValueStore } from '../common/persistent-value.store';
import { SaleWindow } from '../common/sale-calendar';
import { ReadinessFacts, aiFailureNote, readinessDue, readinessReport } from './sale-readiness';

/** Sends the pre-sale checklist (sale-readiness.ts) to the owner's Telegram chat. */
@Injectable()
export class SaleReadinessService {
  private readonly logger = new Logger(SaleReadinessService.name);

  constructor(
    @InjectRepository(Coupon) private readonly coupons: Repository<Coupon>,
    @InjectRepository(Campaign) private readonly campaigns: Repository<Campaign>,
    @InjectRepository(Post) private readonly posts: Repository<Post>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly credentials: CredentialsService,
    @Optional() private readonly memory?: PersistentValueStore,
  ) {}

  /** Daily at 09:40 Israel time; sends only on the checklist days, once each. */
  @Cron('0 40 9 * * *', { timeZone: 'Asia/Jerusalem' })
  async daily(): Promise<void> {
    if (process.env.SALE_READINESS_DISABLED === '1') return;
    const due = readinessDue();
    if (!due) return;
    const admins = await this.users.find({ where: { role: 'admin' } }).catch(() => [] as User[]);
    for (const admin of admins) {
      const key = `sale_ready:${admin.id}:${due.window.key}:${due.window.liveFrom.getUTCFullYear()}:${due.days}`;
      try {
        if (await this.memory?.load<boolean>(key)) continue;
        const text = await this.report(admin.id, due.window, due.days);
        if (await this.send(admin.id, text)) await this.memory?.save(key, true, 30 * 86_400_000);
      } catch (err: any) {
        this.logger.warn(`sale readiness failed for ${admin.id}: ${err?.message}`);
      }
    }
  }

  /** The checklist for one account, as of now. */
  async report(userId: string, window: SaleWindow, days: number): Promise<string> {
    return readinessReport(window, days, await this.facts(userId, window));
  }

  private async facts(userId: string, window: SaleWindow): Promise<ReadinessFacts> {
    const coupons = await this.coupons.find({ where: { user_id: userId, is_active: true } }).catch(() => [] as Coupon[]);
    const from = window.liveFrom.getTime();
    const to = window.liveTo.getTime();
    const couponsForSale = coupons.filter((c) =>
      (!c.starts_at || new Date(c.starts_at).getTime() < to) && (!c.ends_at || new Date(c.ends_at).getTime() > from),
    ).length;
    const active = await this.campaigns.find({ where: { user_id: userId, status: 'active' as any } }).catch(() => [] as Campaign[]);
    const postsLast24h = await this.posts.createQueryBuilder('p')
      .where('p.user_id = :userId', { userId })
      .andWhere("p.status = 'sent'")
      .andWhere("p.sent_at > now() - interval '1 day'")
      .getCount().catch(() => 0);
    const creds = await this.credentials.getRaw(userId).catch(() => null);
    return {
      couponsForSale,
      activeCampaigns: active.length,
      aiFailing: active.filter((c) => aiFailureNote(c.last_run_note)).map((c) => c.name),
      postsLast24h,
      seasonalEnabled: creds?.seasonal_enabled !== false,
    };
  }

  private async send(userId: string, text: string): Promise<boolean> {
    const chatId = process.env.WATCHDOG_TELEGRAM_CHAT_ID;
    const token = process.env.WATCHDOG_TELEGRAM_BOT_TOKEN
      || await this.credentials.getTelegramToken(userId).catch(() => null);
    if (!chatId || !token) return false;
    return axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId, text, disable_web_page_preview: true,
    }, { timeout: 12_000 })
      .then(() => true)
      .catch((err) => { this.logger.warn(`sale readiness telegram failed: ${err?.message}`); return false; });
  }
}
