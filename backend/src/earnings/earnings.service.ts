import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, Repository } from 'typeorm';
import { Earning } from './earning.entity';
import { Post } from '../posts/post.entity';
import { Campaign } from '../campaigns/campaign.entity';
import { CredentialsService } from '../credentials/credentials.service';
import { RatesService } from '../rates/rates.service';
import { signAliexpress } from '../common/aliexpress-sign';
import axios from 'axios';

const ALI_API = 'https://api-sg.aliexpress.com/sync';

/**
 * order.list statuses → our local earning status. The API requires an explicit
 * status per call, so a full sync loops over all of them (estimated orders that
 * later settle get UPDATED because the settled pass runs after the estimated one).
 */
/**
 * Each status carries how far back to look. This matters: AliExpress only moves a
 * commission to "Completed Settlement" (the "approved" money the Reports screen sums)
 * roughly 60+ days AFTER the order — so a 60-day window for that pass would keep missing
 * settlements right as they mature, and the row would stay 'estimated' forever. The
 * settled/cancelled passes therefore reach back much further than the estimated ones.
 * The gateway limits the span PER call, so doSync walks each lookback in ≤30-day chunks.
 */
const ORDER_STATUSES: { api: string; local: 'estimated' | 'settled' | 'cancelled'; lookbackDays: number }[] = [
  { api: 'Payment Completed', local: 'estimated', lookbackDays: 60 },
  { api: 'Buyer Confirmed Goods Receipt', local: 'estimated', lookbackDays: 90 },
  { api: 'Completed Settlement', local: 'settled', lookbackDays: 210 },
  { api: 'Invalid', local: 'cancelled', lookbackDays: 150 },
];

/** Max span AliExpress accepts per order.list call — walk longer lookbacks in slices this size. */
const WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Per-status outcome of one sync, returned to the UI so an empty 'settled' is explainable. */
type StatusDiag = { found: number; new: number; updated: number; error?: string };

/**
 * The API wants 'yyyy-MM-dd HH:mm:ss' (date-only returns code 407 invalid-pattern) —
 * in AliExpress PLATFORM time (GMT+8). The server runs UTC, so formatting local parts
 * put every window 8 hours in the past: orders paid in the last ~8h fell outside
 * end_time on every sync and looked "missing" next to the portal's live count.
 */
function apiTime(d: Date): string {
  const t = new Date(d.getTime() + 8 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`;
}

/** Parse an API timestamp ('yyyy-MM-dd HH:mm:ss', GMT+8) to a real Date. Plain
 *  `new Date(s)` read it as server-local (UTC) and stored every order 8h late. */
function parseAliTime(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(`${String(s).trim().replace(' ', 'T')}+08:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

@Injectable()
export class EarningsService {
  private readonly logger = new Logger(EarningsService.name);
  /** Users with an in-flight sync — blocks concurrent/duplicate runs. */
  private readonly syncing = new Set<string>();

  constructor(
    @InjectRepository(Earning)
    private readonly repo: Repository<Earning>,
    @InjectRepository(Post)
    private readonly postsRepo: Repository<Post>,
    @InjectRepository(Campaign)
    private readonly campaignsRepo: Repository<Campaign>,
    private readonly credentials: CredentialsService,
    private readonly rates: RatesService,
  ) {}

  // ── Revenue attribution ───────────────────────────────────────────────────

  /**
   * Match unattributed commissions to the post that drove them: same product,
   * published (sent) before the order inside a 30-day window. When several posts
   * promoted the product, the one with the most short-link clicks wins (then the
   * most recent) — clicks are the only honest tiebreaker we have. From the post
   * we inherit keyword + campaign, which powers the "what actually earns" report.
   */
  async attributeEarnings(userId: string): Promise<number> {
    const unattributed = await this.repo.find({
      where: { user_id: userId, post_id: IsNull() },
      take: 500,
    });
    const withProduct = unattributed.filter((e) => e.product_id && e.product_id !== 'unknown');
    if (!withProduct.length) return 0;

    // ONE posts query for all products (a per-earning findOne was 500 sequential round
    // trips — seconds of work that once even timed out the sync request). Matching then
    // happens in memory: for each earning, the sent posts of ITS product inside the
    // 30-day pre-order window, best clicks first, then most recent.
    const productIds = Array.from(new Set(withProduct.map((e) => String(e.product_id))));
    const posts = await this.postsRepo.createQueryBuilder('p')
      .where('p.user_id = :userId', { userId })
      .andWhere("p.status = 'sent'")
      .andWhere('p.product_id IN (:...productIds)', { productIds })
      .andWhere('p.sent_at IS NOT NULL')
      .getMany();
    const postsByProduct = new Map<string, Post[]>();
    for (const p of posts) {
      const key = String(p.product_id);
      if (!postsByProduct.has(key)) postsByProduct.set(key, []);
      postsByProduct.get(key)!.push(p);
    }

    let attributed = 0;
    for (const e of withProduct) {
      const orderTime = new Date(e.order_date).getTime();
      const windowStart = orderTime - 30 * 86_400_000;
      const candidates = (postsByProduct.get(String(e.product_id)) || [])
        .filter((p) => {
          const t = new Date(p.sent_at!).getTime();
          return t >= windowStart && t <= orderTime;
        })
        .sort((a, b) => (b.clicks_count || 0) - (a.clicks_count || 0)
          || new Date(b.sent_at!).getTime() - new Date(a.sent_at!).getTime());
      const post = candidates[0];
      if (!post) continue;
      e.post_id = post.id;
      e.keyword = post.keyword || null;
      if (!e.campaign_id) e.campaign_id = post.campaign_id || null;
      await this.repo.save(e);
      attributed++;
    }
    return attributed;
  }

  /** "What actually earns": commissions grouped by keyword and campaign, merged with
   *  the click counts from the short links — the reports screen's money table. */
  async attributionSummary(userId: string) {
    const byKeywordRaw = await this.repo.createQueryBuilder('e')
      .select('e.keyword', 'keyword')
      .addSelect('COUNT(*)', 'orders')
      .addSelect('SUM(e.commission_ils)', 'revenue_ils')
      .where('e.user_id = :u', { u: userId })
      .andWhere("e.status != 'cancelled'")
      .andWhere('e.post_id IS NOT NULL')
      .groupBy('e.keyword')
      .orderBy('SUM(e.commission_ils)', 'DESC')
      .limit(25)
      .getRawMany();

    const clicksRaw = await this.postsRepo.createQueryBuilder('p')
      .select('p.keyword', 'keyword')
      .addSelect('SUM(p.clicks_count)', 'clicks')
      .addSelect('COUNT(*)', 'posts')
      .where('p.user_id = :u', { u: userId })
      .andWhere('p.keyword IS NOT NULL')
      .groupBy('p.keyword')
      .getRawMany();
    const clicksBy = new Map(clicksRaw.map((r) => [r.keyword, r]));

    const by_keyword = byKeywordRaw.map((r) => ({
      keyword: r.keyword || '(ללא מילת מפתח)',
      orders: Number(r.orders) || 0,
      revenue_ils: +(Number(r.revenue_ils) || 0).toFixed(2),
      clicks: Number(clicksBy.get(r.keyword)?.clicks) || 0,
      posts: Number(clicksBy.get(r.keyword)?.posts) || 0,
    }));
    // Keywords with clicks but no revenue yet — shown so dead spenders are visible too.
    for (const r of clicksRaw) {
      if (!byKeywordRaw.some((k) => k.keyword === r.keyword)) {
        by_keyword.push({ keyword: r.keyword, orders: 0, revenue_ils: 0, clicks: Number(r.clicks) || 0, posts: Number(r.posts) || 0 });
      }
    }

    const byCampaignRaw = await this.repo.createQueryBuilder('e')
      .select('e.campaign_id', 'campaign_id')
      .addSelect('COUNT(*)', 'orders')
      .addSelect('SUM(e.commission_ils)', 'revenue_ils')
      .where('e.user_id = :u', { u: userId })
      .andWhere("e.status != 'cancelled'")
      .andWhere('e.campaign_id IS NOT NULL')
      .groupBy('e.campaign_id')
      .orderBy('SUM(e.commission_ils)', 'DESC')
      .limit(15)
      .getRawMany();
    const campaigns = byCampaignRaw.length
      ? await this.campaignsRepo.findByIds(byCampaignRaw.map((r) => r.campaign_id))
      : [];
    const nameBy = new Map(campaigns.map((c) => [c.id, c.name]));
    const by_campaign = byCampaignRaw.map((r) => ({
      campaign_id: r.campaign_id,
      name: nameBy.get(r.campaign_id) || 'קמפיין שנמחק',
      orders: Number(r.orders) || 0,
      revenue_ils: +(Number(r.revenue_ils) || 0).toFixed(2),
    }));

    const un = await this.repo.createQueryBuilder('e')
      .select('COUNT(*)', 'orders')
      .addSelect('SUM(e.commission_ils)', 'revenue_ils')
      .where('e.user_id = :u AND e.post_id IS NULL', { u: userId })
      .andWhere("e.status != 'cancelled'")
      .getRawOne();

    return {
      by_keyword,
      by_campaign,
      unattributed: { orders: Number(un?.orders) || 0, revenue_ils: +(Number(un?.revenue_ils) || 0).toFixed(2) },
    };
  }

  async summary(userId: string, period: '7d' | '30d' | '90d' | 'all' = '30d') {
    const from = this.periodStart(period);
    const qb = this.repo.createQueryBuilder('e')
      .where('e.user_id = :userId', { userId });
    if (from) qb.andWhere('e.order_date >= :from', { from });

    const earnings = await qb.getMany();

    const total_estimated = earnings
      .filter((e) => e.status === 'estimated')
      .reduce((s, e) => s + e.commission_ils, 0);

    const total_settled = earnings
      .filter((e) => e.status === 'settled')
      .reduce((s, e) => s + e.commission_ils, 0);

    const total_cancelled = earnings
      .filter((e) => e.status === 'cancelled')
      .reduce((s, e) => s + e.commission_ils, 0);

    // By campaign
    const campaignMap = new Map<string, { campaign_id: string; campaign_name: string; total: number }>();
    for (const e of earnings) {
      if (!e.campaign_id) continue;
      const existing = campaignMap.get(e.campaign_id) || { campaign_id: e.campaign_id, campaign_name: e.campaign_id, total: 0 };
      existing.total += e.commission_ils;
      campaignMap.set(e.campaign_id, existing);
    }

    // By month
    const monthMap = new Map<string, { month: string; estimated: number; settled: number }>();
    for (const e of earnings) {
      const month = new Date(e.order_date).toISOString().slice(0, 7);
      const existing = monthMap.get(month) || { month, estimated: 0, settled: 0 };
      if (e.status === 'estimated') existing.estimated += e.commission_ils;
      if (e.status === 'settled') existing.settled += e.commission_ils;
      monthMap.set(month, existing);
    }

    return {
      total_estimated,
      total_settled,
      total_cancelled,
      period_start: from?.toISOString() || '2020-01-01T00:00:00.000Z',
      period_end: new Date().toISOString(),
      by_campaign: Array.from(campaignMap.values()),
      by_month: Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month)),
    };
  }

  async list(userId: string, page = 1, limit = 20, status?: string, from?: string, to?: string) {
    // `to` is inclusive of the whole day the user picked (end-of-day), so a same-day
    // from/to range still returns that day's orders.
    const fromD = from ? new Date(from) : null;
    const toD = to ? new Date(new Date(to).setHours(23, 59, 59, 999)) : null;

    const applyFilters = <T>(qb: import('typeorm').SelectQueryBuilder<T>) => {
      qb.where('e.user_id = :userId', { userId });
      if (status) qb.andWhere('e.status = :status', { status });
      if (fromD) qb.andWhere('e.order_date >= :fromD', { fromD });
      if (toD) qb.andWhere('e.order_date <= :toD', { toD });
      return qb;
    };

    const [data, total] = await applyFilters(this.repo.createQueryBuilder('e'))
      .orderBy('e.order_date', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    // Totals across the WHOLE filtered range (not just this page) — cancelled excluded,
    // since it isn't money — so the stat cards match the active filter, not the visible 20.
    const t = await applyFilters(this.repo.createQueryBuilder('e'))
      .andWhere("e.status <> 'cancelled'")
      .select('COALESCE(SUM(e.order_amount_usd), 0)', 'amount_usd')
      .addSelect('COALESCE(SUM(e.commission_usd), 0)', 'commission_usd')
      .addSelect('COALESCE(SUM(e.commission_ils), 0)', 'commission_ils')
      .addSelect('COUNT(*)', 'count')
      .getRawOne();

    return {
      data, total, page, limit,
      totals: {
        amount_usd: +(parseFloat(t?.amount_usd) || 0).toFixed(2),
        commission_usd: +(parseFloat(t?.commission_usd) || 0).toFixed(2),
        commission_ils: +(parseFloat(t?.commission_ils) || 0).toFixed(2),
        count: parseInt(t?.count, 10) || 0,
      },
    };
  }

  /**
   * REAL revenue attributed to a product: the commissions AliExpress actually reported
   * for orders of `productId` placed AFTER `since` (i.e. after the post went out).
   *
   * Attribution grain is the product, not the individual post — AliExpress reports a
   * product_id per order but nothing that identifies which of our links drove it, so a
   * product posted twice shares one revenue pool. Cancelled orders are excluded; they're
   * not money. This is what makes ROAS real instead of a stand-in.
   */
  async revenueForProduct(userId: string, productId: string, since?: Date | null): Promise<number> {
    if (!productId) return 0;
    const qb = this.repo
      .createQueryBuilder('e')
      .select('COALESCE(SUM(e.commission_usd), 0)', 'total')
      .where('e.user_id = :userId AND e.product_id = :productId', { userId, productId })
      .andWhere("e.status <> 'cancelled'");
    if (since) qb.andWhere('e.order_date >= :since', { since });
    const row = await qb.getRawOne();
    return +(parseFloat(row?.total) || 0).toFixed(2);
  }

  /**
   * Pulls real orders from aliexpress.affiliate.order.list (SIGNED — the previous
   * implementation sent an unsigned request, so every call failed and the silent
   * catch made it look like "0 earnings" forever).
   *
   * Response facts (verified live): money fields (paid_amount,
   * estimated_paid_commission, finished_amount, estimated_finished_commission)
   * are integer CENTS of settled_currency; times are 'yyyy-MM-dd HH:mm:ss';
   * the query window is limited, so we fetch the last 60 days per run.
   */
  async sync(userId: string): Promise<{ synced: number; updated: number; by_status?: Record<string, StatusDiag> }> {
    const creds = await this.credentials.getRaw(userId);
    if (!creds?.aliexpress_app_key || !creds?.aliexpress_app_secret) {
      throw new BadRequestException('מפתחות AliExpress לא מוגדרים — הגדר אותם בהגדרות ← שווקים');
    }

    // In-flight guard: a double-click / overlapping sync would otherwise run the
    // same check-then-insert twice and duplicate earnings rows (real money).
    if (this.syncing.has(userId)) {
      throw new BadRequestException('סנכרון כבר רץ — נסה שוב בעוד רגע');
    }
    this.syncing.add(userId);
    try {
      const result = await this.doSync(userId, creds);
      // Attribution rides every sync — but FIRE-AND-FORGET: with hundreds of orders it
      // adds seconds, and awaiting it inside the HTTP request pushed the manual sync past
      // the frontend's timeout (the sync "failed" in the UI while succeeding server-side).
      void this.attributeEarnings(userId).catch((err: any) =>
        this.logger.warn(`attribution failed for ${userId}: ${err?.message}`));
      return result;
    } finally {
      this.syncing.delete(userId);
    }
  }

  /**
   * Scheduled "live" pull: auto-sync affiliate orders for EVERY user with AliExpress keys,
   * so the orders/earnings screens stay current without a manual refresh. Paced between users
   * (the gateway bans bursts); one user's failure (bad keys, API limit) never aborts the rest.
   */
  async syncAllUsers(): Promise<{ users: number; synced: number; updated: number }> {
    const userIds = await this.credentials.listUserIdsWithAliexpress();
    let synced = 0, updated = 0;
    for (const uid of userIds) {
      try {
        const r = await this.sync(uid);
        synced += r.synced;
        updated += r.updated;
      } catch (err: any) {
        this.logger.warn(`Earnings auto-sync failed for ${uid}: ${err?.message}`);
      }
      await new Promise((r) => setTimeout(r, 1500)); // space users out
    }
    return { users: userIds.length, synced, updated };
  }

  private async doSync(userId: string, creds: any): Promise<{ synced: number; updated: number; by_status: Record<string, StatusDiag> }> {
    const rate = await this.rates.getRate(creds.currency_pair || 'USD_ILS');
    let synced = 0;
    let updated = 0;
    const now = Date.now();
    // Per-status diagnostics so "why is 'approved/settled' still 0?" is answerable from
    // the sync result instead of a black box — did that pass error, or genuinely find none?
    const byStatus: Record<string, StatusDiag> = {};

    for (const st of ORDER_STATUSES) {
      const diag: StatusDiag = { found: 0, new: 0, updated: 0 };
      byStatus[st.api] = diag;

      // Walk the lookback in ≤30-day slices (the gateway caps the span per call). Newest
      // slice first; each slice is [start, end).
      const chunks = Math.ceil(st.lookbackDays / WINDOW_DAYS);
      for (let c = 0; c < chunks; c++) {
        const end = new Date(now - c * WINDOW_DAYS * DAY_MS);
        const start = new Date(now - Math.min((c + 1) * WINDOW_DAYS, st.lookbackDays) * DAY_MS);

        for (let pageNo = 1; pageNo <= 5; pageNo++) {
          try {
            // Pace calls — the gateway bans bursts (>~1 req/sec → ApiCallLimit).
            await new Promise((r) => setTimeout(r, 1100));

            const signed = signAliexpress({
              method: 'aliexpress.affiliate.order.list',
              app_key: creds.aliexpress_app_key,
              status: st.api,
              start_time: apiTime(start),
              end_time: apiTime(end),
              page_no: pageNo,
              page_size: 50,
            }, creds.aliexpress_app_secret);

            const res = await axios.get(ALI_API, { params: signed, timeout: 15000 });
            if (res.data?.error_response) {
              diag.error = res.data.error_response.msg || res.data.error_response.code;
              break;
            }

            const result = res.data?.aliexpress_affiliate_order_list_response?.resp_result?.result;
            const orders: any[] = result?.orders?.order || [];
            diag.found += orders.length;

            for (const order of orders) {
              // sub_order_id is the per-item grain (one parent order can hold several
              // commissionable items) — use it as the unique key.
              const orderKey = String(order.sub_order_id || order.order_id);
              const commissionUsd = +(((parseFloat(order.estimated_finished_commission) || parseFloat(order.estimated_paid_commission) || 0) / 100)).toFixed(2);
              const amountUsd = +(((parseFloat(order.finished_amount) || parseFloat(order.paid_amount) || 0) / 100)).toFixed(2);
              const settleAt = parseAliTime(order.completed_settlement_time);

              const exists = await this.repo.findOne({ where: { order_id: orderKey, user_id: userId } });
              if (exists) {
                // Status/commission transitions (estimated → settled/cancelled).
                if (exists.status !== st.local || Math.abs((exists.commission_usd || 0) - commissionUsd) > 0.001) {
                  exists.status = st.local;
                  exists.order_amount_usd = amountUsd;
                  exists.commission_usd = commissionUsd;
                  exists.commission_ils = +(commissionUsd * rate).toFixed(2);
                  exists.settlement_date = settleAt;
                  await this.repo.save(exists);
                  updated++;
                  diag.updated++;
                }
                continue;
              }

              const earning = this.repo.create({
                user_id: userId,
                order_id: orderKey,
                product_id: String(order.product_id || 'unknown'),
                order_amount_usd: amountUsd,
                commission_usd: commissionUsd,
                commission_ils: +(commissionUsd * rate).toFixed(2),
                status: st.local,
                order_date: parseAliTime(order.created_time) || new Date(),
                settlement_date: settleAt,
              });
              try {
                await this.repo.save(earning);
                synced++;
                diag.new++;
              } catch (e: any) {
                // Unique (user_id, order_id) violation → a concurrent pass already
                // inserted it; safe to skip rather than duplicate.
                if (e?.code === '23505') continue;
                throw e;
              }
            }

            if (!result || pageNo >= (result.total_page_no || 1)) break;
          } catch (err: any) {
            diag.error = err?.message || 'request failed';
            this.logger.error(`Earnings sync (${st.api}) failed: ${err?.message}`);
            break;
          }
        }
        if (diag.error) break; // don't keep hammering the same failing status across slices
      }
    }

    this.logger.log(`Earnings sync for ${userId}: ${JSON.stringify(byStatus)}`);

    // Surface failures instead of pretending "0 new orders": only fail loudly when EVERY
    // status errored (bad keys, missing permission, API limit) and nothing synced. A status
    // that simply found 0 orders is a legitimate empty result, not a failure.
    if (synced === 0 && updated === 0 && ORDER_STATUSES.every((st) => byStatus[st.api]?.error)) {
      const firstErr = ORDER_STATUSES.map((st) => byStatus[st.api]?.error).find(Boolean);
      throw new BadRequestException(`סנכרון הרווחים נכשל: ${firstErr}`);
    }

    return { synced, updated, by_status: byStatus };
  }

  private periodStart(period: string): Date | null {
    const days = { '7d': 7, '30d': 30, '90d': 90 };
    if (!days[period]) return null;
    const d = new Date();
    d.setDate(d.getDate() - days[period]);
    return d;
  }
}
