import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { Earning } from '../earnings/earning.entity';
import { Post } from '../posts/post.entity';
import { Campaign } from '../campaigns/campaign.entity';
import { CredentialsService } from '../credentials/credentials.service';
import { PostsService } from '../posts/posts.service';
import { ProductsService } from '../products/products.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { focusLabel } from '../posts/group-focus';

/** Picks a focused group may turn down in one tick before recovery waits for the next. */
const RECOVERY_FOCUS_ATTEMPTS = 3;

/**
 * Sales-recovery auto-push. When a user's attributed orders drop below their configured
 * threshold within the window, publish extra hot products — alternating between products
 * the audience already BOUGHT but we never posted, and AliExpress best-sellers — to the
 * groups the user's active campaigns target, until orders recover. Capped per day.
 *
 * Distinct from the paid-ads boost_* settings; this is organic content.
 */
@Injectable()
export class RecoveryService {
  private readonly logger = new Logger(RecoveryService.name);
  private running = false;

  constructor(
    @InjectRepository(Earning) private readonly earnings: Repository<Earning>,
    @InjectRepository(Post) private readonly posts: Repository<Post>,
    @InjectRepository(Campaign) private readonly campaigns: Repository<Campaign>,
    private readonly credentials: CredentialsService,
    private readonly postsService: PostsService,
    private readonly products: ProductsService,
    private readonly subscription: SubscriptionService,
  ) {}

  /** Hourly at :05 (offset from the other minute/quarter crons). One publish per tick,
   *  capped by recovery_posts_per_day; the scheduler paces delivery per group. */
  @Cron('0 5 * * * *')
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const users = await this.credentials.recoverySettings();
      for (const u of users) {
        try { await this.runForUser(u); }
        catch (err: any) { this.logger.warn(`recovery for ${u.userId} failed: ${err?.message}`); }
      }
    } catch (err: any) {
      this.logger.error(`recovery tick failed: ${err?.message}`);
    } finally {
      this.running = false;
    }
  }

  private async runForUser(u: { userId: string; minOrders: number; windowDays: number; postsPerDay: number; campaignIds: string[] }): Promise<void> {
    // Plan gate: sales-recovery is an Autopilot+ feature. A Starter/Growth user who
    // toggled the flag must not get free auto-push. (Admins bypass in allows().)
    if (!(await this.subscription.allows(u.userId, 'sales_recovery'))) return;

    const now = Date.now();

    // 1) Orders in the window (one earnings row per order). Healthy → nothing to do.
    const windowStart = new Date(now - u.windowDays * 86_400_000);
    const orders = await this.earnings.count({ where: { user_id: u.userId, order_date: MoreThan(windowStart) } });
    if (orders >= u.minOrders) return;

    // 2) Daily cap on recovery posts.
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const boostToday = await this.posts.count({ where: { user_id: u.userId, is_boost: true, created_at: MoreThan(startOfDay) } });
    if (boostToday >= u.postsPerDay) return;

    // 3) Target groups + their topic keywords. Each group inherits the keywords of the
    //    campaign(s) that publish to it, so a boost can be matched to the group's niche
    //    (a tactical group must never get a random best-seller). An explicit campaignIds
    //    selection narrows the set; empty = every active campaign.
    const active = await this.campaigns.find({ where: { user_id: u.userId, status: 'active' as any } });
    const selected = u.campaignIds.length
      ? active.filter((c) => u.campaignIds.includes(String(c.id)))
      : active;
    const groupKeywords = new Map<string, Set<string>>();
    for (const c of selected) {
      let chans: string[] = [];
      try { chans = JSON.parse(c.target_channels || '[]'); } catch { /* ignore */ }
      const kws = Array.isArray(c.keywords) ? c.keywords : [];
      for (const g of chans) {
        if (!g) continue;
        const key = String(g);
        if (!groupKeywords.has(key)) groupKeywords.set(key, new Set());
        for (const k of kws) if (k) groupKeywords.get(key)!.add(String(k));
      }
    }
    const groupList = [...groupKeywords.keys()];
    if (!groupList.length) return; // nowhere to publish

    // 4) Products we've already posted (any status) — never re-push these.
    const postedRows = await this.posts.createQueryBuilder('p')
      .select('DISTINCT p.product_id', 'product_id')
      .where('p.user_id = :uid', { uid: u.userId })
      .getRawMany();
    const posted = new Set(postedRows.map((r) => String(r.product_id)));

    // 5) Target group (rotate across the groups) and its keywords.
    const group = groupList[boostToday % groupList.length];
    const keywords = [...(groupKeywords.get(group) || [])];

    // 6) Pick a fresh product MATCHED to the group's niche. When the group has keywords,
    //    prefer a bought-but-unposted product whose title matches one, else a keyword-
    //    searched best-seller — both guaranteed on-topic. Only a keyword-less group
    //    (e.g. a brand/FLYLINK channel) falls back to a generic best-seller.
    //    A group with a declared core focus (posts/group-focus.ts) takes only a product
    //    clearly inside it: a rejected pick is set aside and the next one tried, a few times.
    const creds = await this.credentials.getRaw(u.userId).catch(() => null);
    let product: any = null;
    let mixChannel: string | null = null;
    let productOffFocus = false;
    for (let attempt = 0; attempt < RECOVERY_FOCUS_ATTEMPTS && !product; attempt++) {
      let pick: any = null;
      if (keywords.length) {
        pick = (await this.pickBoughtMatching(u.userId, posted, keywords))
          || (await this.pickKeywordBestSeller(u.userId, posted, keywords, boostToday + attempt));
      } else {
        pick = (boostToday % 2 === 0)
          ? (await this.pickBoughtNotPosted(u.userId, posted)) || (await this.pickBestSeller(u.userId, posted))
          : (await this.pickBestSeller(u.userId, posted)) || (await this.pickBoughtNotPosted(u.userId, posted));
      }
      if (!pick) break;
      const { foci, verdicts, mixChannel: mc } = await this.postsService.groupFocusCheck(u.userId, creds, [group], [{
        id: String(pick.product_id), keyword: keywords[0] || '', title: String(pick.title || ''), category: pick.category,
      }]);
      if (verdicts[0].fits) { product = pick; mixChannel = mc; productOffFocus = !!verdicts[0].offFocus; break; }
      this.logger.log(`recovery ${u.userId}: ${focusLabel(foci)} rejected ${pick.product_id} (${verdicts[0].reason || 'off focus'})`);
      posted.add(String(pick.product_id)); // never offered again this tick
    }
    if (!product) { this.logger.log(`recovery ${u.userId}: no fresh on-topic product for group ${group}`); return; }

    // 7) Publish as a SCHEDULED post (paced per group by the scheduler, independent of the
    //    manual queue toggle), then flag it so it counts toward the daily cap.
    const saved = await this.postsService.createQueuedPost(
      u.userId,
      {
        product_id: String(product.product_id),
        title: product.title || '',
        image_url: product.image_url || '',
        affiliate_url: product.affiliate_url || product.product_url || '',
        sale_price: Number(product.sale_price) || 0,
        original_price: Number(product.original_price) || Number(product.sale_price) || 0,
        currency: product.currency || '',
        discount_percent: Number(product.discount_percent) || 0,
        orders_count: Number(product.orders_count) || 0,
        rating: Number(product.rating) || 0,
      },
      undefined, undefined, group, undefined, undefined, [group],
      { scheduledAt: new Date() },
    );
    if (saved) {
      if (mixChannel) await this.postsService.recordFocusMix(u.userId, mixChannel, productOffFocus);
      saved.is_boost = true;
      await this.posts.save(saved).catch(() => {});
      this.logger.log(`recovery ${u.userId}: pushed product ${product.product_id} → group ${group} (orders=${orders}<${u.minOrders})`);
    }
  }

  /** A best-seller that MATCHES the group's niche — searched with one of the campaign's
   *  keywords (rotated by the daily counter), sorted by sales. Guarantees on-topic boosts. */
  private async pickKeywordBestSeller(userId: string, posted: Set<string>, keywords: string[], seed: number): Promise<any | null> {
    // Try a couple of keywords (rotating) so a niche/empty result doesn't block recovery.
    for (let i = 0; i < Math.min(keywords.length, 4); i++) {
      const keyword = keywords[(seed + i) % keywords.length];
      try {
        const res: any = await this.products.search(userId, { keyword, sort: 'LAST_VOLUME_DESC', page: 1, limit: 40 });
        const items: any[] = res?.data || [];
        const hit = items.find((p) => p?.product_id && !posted.has(String(p.product_id)) && p.title && Number(p.sale_price) > 0);
        if (hit) return hit;
      } catch { /* try next keyword */ }
    }
    return null;
  }

  /** A bought-but-unposted product whose title matches one of the group's keywords —
   *  proven demand AND on-topic. Returns null when nothing matches (caller falls back). */
  private async pickBoughtMatching(userId: string, posted: Set<string>, keywords: string[]): Promise<any | null> {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const rows = await this.earnings.createQueryBuilder('e')
      .select('DISTINCT e.product_id', 'product_id')
      .where('e.user_id = :uid', { uid: userId })
      .andWhere('e.order_date > :since', { since })
      .getRawMany()
      .catch(() => []);
    const terms = keywords.map((k) => k.toLowerCase()).filter(Boolean);
    const candidates = rows.map((r) => String(r.product_id)).filter((id) => id && !posted.has(id)).slice(0, 8);
    for (const id of candidates) {
      const p = await this.products.refreshPrice(userId, id).catch(() => null);
      if (!p || String(p.product_id) !== id || !p.title || !(Number(p.sale_price) > 0)) continue;
      const title = String(p.title).toLowerCase();
      if (terms.some((t) => title.includes(t) || t.split(/\s+/).some((w) => w.length > 3 && title.includes(w)))) return p;
    }
    return null;
  }

  /** A top AliExpress best-seller we haven't posted yet. */
  private async pickBestSeller(userId: string, posted: Set<string>): Promise<any | null> {
    try {
      const res: any = await this.products.getFeatured(userId, { sort: 'best_selling', page: 1, limit: 50 });
      const items: any[] = res?.data || [];
      return items.find((p) => p?.product_id && !posted.has(String(p.product_id))) || null;
    } catch { return null; }
  }

  /** A product the audience bought in the last 30d that we never posted. refreshPrice
   *  returns the exact product (by id) or null, so a mismatch can't publish a wrong item. */
  private async pickBoughtNotPosted(userId: string, posted: Set<string>): Promise<any | null> {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const rows = await this.earnings.createQueryBuilder('e')
      .select('DISTINCT e.product_id', 'product_id')
      .where('e.user_id = :uid', { uid: userId })
      .andWhere('e.order_date > :since', { since })
      .getRawMany()
      .catch(() => []);
    const candidates = rows.map((r) => String(r.product_id)).filter((id) => id && !posted.has(id)).slice(0, 8);
    for (const id of candidates) {
      const p = await this.products.refreshPrice(userId, id).catch(() => null);
      if (p && String(p.product_id) === id && p.title && Number(p.sale_price) > 0) return p;
    }
    return null;
  }
}
