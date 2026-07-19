import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Earning } from './earning.entity';
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
const ORDER_STATUSES: { api: string; local: 'estimated' | 'settled' | 'cancelled' }[] = [
  { api: 'Payment Completed', local: 'estimated' },
  { api: 'Buyer Confirmed Goods Receipt', local: 'estimated' },
  { api: 'Completed Settlement', local: 'settled' },
  { api: 'Invalid', local: 'cancelled' },
];

/** The API wants 'yyyy-MM-dd HH:mm:ss' (date-only returns code 407 invalid-pattern). */
function apiTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

@Injectable()
export class EarningsService {
  private readonly logger = new Logger(EarningsService.name);
  /** Users with an in-flight sync — blocks concurrent/duplicate runs. */
  private readonly syncing = new Set<string>();

  constructor(
    @InjectRepository(Earning)
    private readonly repo: Repository<Earning>,
    private readonly credentials: CredentialsService,
    private readonly rates: RatesService,
  ) {}

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
  async sync(userId: string): Promise<{ synced: number; updated: number }> {
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
      return await this.doSync(userId, creds);
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

  private async doSync(userId: string, creds: any): Promise<{ synced: number; updated: number }> {
    const rate = await this.rates.getRate(creds.currency_pair || 'USD_ILS');
    let synced = 0;
    let updated = 0;
    const errors: string[] = [];

    const end = new Date();
    const start = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

    for (const st of ORDER_STATUSES) {
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
            errors.push(`${st.api}: ${res.data.error_response.msg || res.data.error_response.code}`);
            break;
          }

          const result = res.data?.aliexpress_affiliate_order_list_response?.resp_result?.result;
          const orders: any[] = result?.orders?.order || [];

          for (const order of orders) {
            // sub_order_id is the per-item grain (one parent order can hold several
            // commissionable items) — use it as the unique key.
            const orderKey = String(order.sub_order_id || order.order_id);
            const commissionUsd = +(((parseFloat(order.estimated_finished_commission) || parseFloat(order.estimated_paid_commission) || 0) / 100)).toFixed(2);
            const amountUsd = +(((parseFloat(order.finished_amount) || parseFloat(order.paid_amount) || 0) / 100)).toFixed(2);
            const settleAt = order.completed_settlement_time ? new Date(order.completed_settlement_time) : null;

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
              order_date: order.created_time ? new Date(order.created_time) : new Date(),
              settlement_date: settleAt,
            });
            try {
              await this.repo.save(earning);
              synced++;
            } catch (e: any) {
              // Unique (user_id, order_id) violation → a concurrent pass already
              // inserted it; safe to skip rather than duplicate.
              if (e?.code === '23505') continue;
              throw e;
            }
          }

          if (!result || pageNo >= (result.total_page_no || 1)) break;
        } catch (err: any) {
          errors.push(`${st.api}: ${err?.message || 'request failed'}`);
          this.logger.error(`Earnings sync (${st.api}) failed: ${err?.message}`);
          break;
        }
      }
    }

    // Surface failures instead of pretending "0 new orders": if NOTHING worked and
    // there were errors, the user must see why (bad keys, missing permission, etc.).
    if (synced === 0 && updated === 0 && errors.length === ORDER_STATUSES.length) {
      throw new BadRequestException(`סנכרון הרווחים נכשל: ${errors[0]}`);
    }

    return { synced, updated };
  }

  private periodStart(period: string): Date | null {
    const days = { '7d': 7, '30d': 30, '90d': 90 };
    if (!days[period]) return null;
    const d = new Date();
    d.setDate(d.getDate() - days[period]);
    return d;
  }
}
