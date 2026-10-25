import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Earning } from '../earnings/earning.entity';
import { PORTAL_TZ as PORTAL_CLOCK } from '../earnings/portal-time';
import { LinkClick } from '../links/link-click.entity';
import { Post } from '../posts/post.entity';
import { RatesService } from '../rates/rates.service';
import { Campaign } from '../campaigns/campaign.entity';
import {
  COMMISSION_DAY_TZ, commissionDayNow,
  dayKeys, deltaPct, densify, localNowString, monthKeys, monthWindows,
} from './stats.util';

export interface MonthMetric {
  /** The current calendar month so far. */
  current: { key: string; total: number };
  /** The FULL previous calendar month. */
  previous: { key: string; total: number };
  /** Current month vs the SAME elapsed stretch of the previous one — comparing a
   *  half-finished month against a whole one would print a fake collapse every month. */
  delta_pct: number | null;
  /** Monthly totals, oldest → newest, aligned 1:1 with OverviewStats.month_keys. */
  series: number[];
}

export interface OverviewStats {
  /** Commissions are reported in the currency the affiliate network actually pays. */
  currency: 'USD';
  months: number;
  /** 'YYYY-MM' keys for every metric's `series`, oldest → newest; last = current month. */
  month_keys: string[];
  /** Today's rate and the converted current-month commissions — a convenience for a
   *  shekel-thinking reader, explicitly approximate. Null when no rate is available. */
  ils_approx: { rate: number; total: number } | null;
  metrics: {
    commissions: MonthMetric;
    clicks: MonthMetric;
    posts: MonthMetric;
  };
}

const MAX_MONTHS = 24;

/**
 * Everything on the dashboard that moves during the day, in one cheap round trip — the
 * screens poll it (every ~20 s while visible), so it must stay a handful of indexed counts.
 * Clicks and posts are cut on Israel days. Commissions and orders are cut on the portal's
 * own day (commissionDayNow, US Pacific), by payment time: 10:00 to 10:00 Israel time, or
 * 09:00 / 11:00 in the weeks the two countries change DST on different dates, so the tile
 * always matches the portal.
 */
export interface LiveStats {
  /** Server time of this snapshot. */
  at: string;
  /** commissions_usd and orders are for the current commission day (the portal's today). */
  today: { posts_sent: number; clicks: number; failed: number; commissions_usd: number; orders: number };
  last_hour: { clicks: number };
  queue: { scheduled: number; queued: number; pending: number; next_at: string | null };
  campaigns: { active: number; total: number };
  last_click_at: string | null;
  last_post_at: string | null;
  /** The newest order the earnings sync has brought in (commissions arrive in batches). */
  last_order_at: string | null;
  /** Israel days, for clicks and posts. */
  days: string[];
  /** Commission days (the portal's Pacific dates), for commissions_usd — the same length, ending on today's. */
  commission_days: string[];
  daily: { clicks: number[]; posts: number[]; commissions_usd: number[] };
}

/** AliExpress reports by its platform clock — the commissions figure must match the
 *  portal the owner holds it against, so its months are cut on this timezone. */
const PORTAL_TZ = PORTAL_CLOCK;
/** Clicks and posts are the owner's own activity — their months are cut on his calendar. */
const LOCAL_TZ = 'Asia/Jerusalem';

/**
 * A column rendered as the wall clock of `tz`, for month bucketing and range filters.
 *
 * Two storage shapes exist here and they convert DIFFERENTLY: paid_date is a real
 * timestamptz (one AT TIME ZONE renders it local), while order_date / sent_at /
 * clicked_at are naive timestamps holding UTC wall time — those must first be DECLARED
 * as UTC (AT TIME ZONE 'UTC') and only then rendered. Skipping the declaration step
 * would re-interpret the naive value as already-local and shift every bucket boundary.
 */
const naiveUtcAsLocal = (col: string, tz: string) => `(${col} AT TIME ZONE 'UTC') AT TIME ZONE '${tz}'`;
const tstzAsLocal = (col: string, tz: string) => `(${col} AT TIME ZONE '${tz}')`;

@Injectable()
export class StatsService {
  private readonly logger = new Logger(StatsService.name);

  constructor(
    @InjectRepository(Earning) private readonly earnings: Repository<Earning>,
    @InjectRepository(LinkClick) private readonly clicks: Repository<LinkClick>,
    @InjectRepository(Post) private readonly posts: Repository<Post>,
    @InjectRepository(Campaign) private readonly campaigns: Repository<Campaign>,
    private readonly rates: RatesService,
  ) {}

  /** See LiveStats. `days` is the daily chart's length (7–60). */
  async live(userId: string, days = 30): Promise<LiveStats> {
    const n = Math.min(60, Math.max(7, Math.floor(days) || 30));
    const localNow = localNowString(LOCAL_TZ);
    const keys = dayKeys(localNow, n);
    const todayFrom = `${keys[keys.length - 1]} 00:00:00`;
    const fromLocal = `${keys[0]} 00:00:00`;
    const clickCol = naiveUtcAsLocal('c.clicked_at', LOCAL_TZ);
    const postCol = naiveUtcAsLocal('p.sent_at', LOCAL_TZ);
    // Commissions on the commission day, the portal's Pacific date — see LiveStats.
    const portalKeys = dayKeys(commissionDayNow(), n);
    const portalFrom = `${portalKeys[0]} 00:00:00`;
    const commissionCol = `COALESCE(${tstzAsLocal('e.paid_date', COMMISSION_DAY_TZ)}, ${naiveUtcAsLocal('e.order_date', COMMISSION_DAY_TZ)})`;
    const day = (col: string) => `to_char(${col}, 'YYYY-MM-DD')`;
    const hourAgo = new Date(Date.now() - 3600_000);

    const [clickDays, postDays, commissionDays, lastHour, failedToday, queue, camps, lasts] = await Promise.all([
      this.clicks.createQueryBuilder('c').select(day(clickCol), 'bucket').addSelect('COUNT(*)::int', 'value')
        .where('c.user_id = :userId', { userId }).andWhere(`${clickCol} >= :fromLocal`, { fromLocal })
        .groupBy('bucket').getRawMany(),
      this.posts.createQueryBuilder('p').select(day(postCol), 'bucket').addSelect('COUNT(*)::int', 'value')
        .where('p.user_id = :userId', { userId }).andWhere("p.status = 'sent'").andWhere(`${postCol} >= :fromLocal`, { fromLocal })
        .groupBy('bucket').getRawMany(),
      this.earnings.createQueryBuilder('e').select(day(commissionCol), 'bucket')
        .addSelect('COALESCE(SUM(e.commission_usd), 0)', 'value').addSelect('COUNT(*)::int', 'orders')
        .where('e.user_id = :userId', { userId }).andWhere("e.status IN ('estimated', 'settled')")
        .andWhere(`${commissionCol} >= :portalFrom`, { portalFrom })
        .groupBy('bucket').getRawMany(),
      this.clicks.createQueryBuilder('c').select('COUNT(*)::int', 'n')
        .where('c.user_id = :userId', { userId }).andWhere('c.clicked_at >= :hourAgo', { hourAgo })
        .getRawOne(),
      this.posts.createQueryBuilder('p').select('COUNT(*)::int', 'n')
        .where('p.user_id = :userId', { userId }).andWhere("p.status = 'failed'")
        .andWhere(`${naiveUtcAsLocal('p.created_at', LOCAL_TZ)} >= :todayFrom`, { todayFrom })
        .getRawOne(),
      this.posts.createQueryBuilder('p')
        .select("COUNT(*) FILTER (WHERE p.status = 'scheduled')::int", 'scheduled')
        .addSelect("COUNT(*) FILTER (WHERE p.status = 'queued')::int", 'queued')
        .addSelect("COUNT(*) FILTER (WHERE p.status = 'pending')::int", 'pending')
        .addSelect("MIN(p.scheduled_at) FILTER (WHERE p.status = 'scheduled')", 'next_at')
        .where('p.user_id = :userId', { userId }).andWhere("p.status IN ('scheduled', 'queued', 'pending')")
        .getRawOne(),
      this.campaigns.createQueryBuilder('k')
        .select("COUNT(*) FILTER (WHERE k.status = 'active')::int", 'active')
        .addSelect('COUNT(*)::int', 'total')
        .where('k.user_id = :userId', { userId })
        .getRawOne(),
      this.posts.query(
        // user_id is uuid on some of these tables and varchar on others — compare as text.
        `SELECT (SELECT max(clicked_at) FROM link_clicks WHERE user_id::text = $1) AS last_click,
                (SELECT max(sent_at) FROM posts WHERE user_id::text = $1 AND status = 'sent') AS last_post,
                (SELECT max(order_date) FROM earnings WHERE user_id::text = $1) AS last_order`,
        [userId],
      ).then((r: any[]) => r[0]),
    ]);

    const clicks = densify(clickDays, keys);
    const posts = densify(postDays, keys);
    const commissions = densify(commissionDays, portalKeys).map((v) => Math.round(v * 100) / 100);
    const ordersToday = densify(commissionDays.map((r: any) => ({ bucket: r.bucket, value: r.orders })), portalKeys);
    // Naive UTC timestamps (clicked_at, sent_at, order_date, scheduled_at) leave as ISO UTC.
    const iso = (v: any): string | null => {
      if (!v) return null;
      const d = v instanceof Date ? v : new Date(String(v).replace(' ', 'T') + (/[zZ+]/.test(String(v).slice(10)) ? '' : 'Z'));
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    };
    return {
      at: new Date().toISOString(),
      today: {
        posts_sent: posts[posts.length - 1] ?? 0,
        clicks: clicks[clicks.length - 1] ?? 0,
        failed: Number(failedToday?.n) || 0,
        commissions_usd: commissions[commissions.length - 1] ?? 0,
        orders: ordersToday[ordersToday.length - 1] ?? 0,
      },
      last_hour: { clicks: Number(lastHour?.n) || 0 },
      queue: {
        scheduled: Number(queue?.scheduled) || 0,
        queued: Number(queue?.queued) || 0,
        pending: Number(queue?.pending) || 0,
        next_at: iso(queue?.next_at),
      },
      campaigns: { active: Number(camps?.active) || 0, total: Number(camps?.total) || 0 },
      last_click_at: iso(lasts?.last_click),
      last_post_at: iso(lasts?.last_post),
      last_order_at: iso(lasts?.last_order),
      days: keys,
      commission_days: portalKeys,
      daily: { clicks, posts, commissions_usd: commissions },
    };
  }

  /**
   * Headline numbers for the dashboard, by CALENDAR month: commissions, clicks and posts —
   * each with the current month so far, the full previous month, an elapsed-stretch delta,
   * and a monthly series for the trend chart.
   *
   * Aggregation happens in SQL rather than by loading rows and summing in JS. This endpoint
   * runs on every dashboard visit, and the accounts that matter most are exactly the ones
   * with the most rows — the naive version gets slowest where it can least afford to.
   */
  async overview(userId: string, months = 12): Promise<OverviewStats> {
    const n = Math.min(MAX_MONTHS, Math.max(2, Math.floor(months) || 12));

    // Commissions live on the portal's clock; the owner's activity lives on his. Each
    // metric gets its own key ring — in the hours where the two calendars disagree about
    // what month it is (portal midnight ≠ Israel midnight), sharing keys would misfile
    // the newest bucket of one of them.
    const portalNow = localNowString(PORTAL_TZ);
    const localNow = localNowString(LOCAL_TZ);
    const portalKeys = monthKeys(portalNow, n);
    const localKeys = monthKeys(localNow, n);
    const portalWin = monthWindows(portalNow);
    const localWin = monthWindows(localNow);

    // The portal pays on payment time; paid_date is null only on rows synced before the
    // column existed, where the order date is the best available stand-in.
    const commissionCol = `COALESCE(${tstzAsLocal('e.paid_date', PORTAL_TZ)}, ${naiveUtcAsLocal('e.order_date', PORTAL_TZ)})`;
    const clickCol = naiveUtcAsLocal('c.clicked_at', LOCAL_TZ);
    const postCol = naiveUtcAsLocal('p.sent_at', LOCAL_TZ);

    const [commissionRows, clickRows, postRows, commissionPrevElapsed, clickPrevElapsed, postPrevElapsed] =
      await Promise.all([
        this.monthlySeries(this.earnings, 'e', commissionCol, 'COALESCE(SUM(e.commission_usd), 0)', userId, portalKeys, "e.status IN ('estimated', 'settled')"),
        this.monthlySeries(this.clicks, 'c', clickCol, 'COUNT(*)', userId, localKeys),
        this.monthlySeries(this.posts, 'p', postCol, 'COUNT(*)', userId, localKeys, "p.status = 'sent'"),
        this.windowTotal(this.earnings, 'e', commissionCol, 'COALESCE(SUM(e.commission_usd), 0)', userId, portalWin.prev_from, portalWin.prev_to, "e.status IN ('estimated', 'settled')"),
        this.windowTotal(this.clicks, 'c', clickCol, 'COUNT(*)', userId, localWin.prev_from, localWin.prev_to),
        this.windowTotal(this.posts, 'p', postCol, 'COUNT(*)', userId, localWin.prev_from, localWin.prev_to, "p.status = 'sent'"),
      ]);

    const build = (
      rows: Array<{ bucket: string; value: number }>,
      keys: string[],
      win: { key: string; prev_key: string },
      prevElapsed: number,
    ): MonthMetric => {
      const series = densify(rows, keys).map((v) => Math.round(v * 100) / 100);
      // The series is cut on the same clock and filters as the tiles, so the current and
      // previous totals ARE its last two buckets — no second query that could disagree.
      return {
        current: { key: win.key, total: series[series.length - 1] ?? 0 },
        previous: { key: win.prev_key, total: series[series.length - 2] ?? 0 },
        delta_pct: deltaPct(series[series.length - 1] ?? 0, prevElapsed),
        series,
      };
    };

    const commissions = build(commissionRows, portalKeys, portalWin, commissionPrevElapsed);

    // Best-effort only: a missing rate must not fail the dashboard, it just drops the
    // secondary line. RatesService already caches and falls back to the last good value.
    const rate = await this.rates.getRate('USD_ILS').catch(() => 0);

    return {
      currency: 'USD',
      months: n,
      month_keys: portalKeys,
      ils_approx: rate > 0
        ? { rate, total: Math.round(commissions.current.total * rate * 100) / 100 }
        : null,
      metrics: {
        commissions,
        clicks: build(clickRows, localKeys, localWin, clickPrevElapsed),
        posts: build(postRows, localKeys, localWin, postPrevElapsed),
      },
    };
  }

  /**
   * One 'YYYY-MM' bucket per month with rows, over the chart window.
   *
   * Summed in USD, not ILS, and that choice is load-bearing for commissions:
   * `commission_usd` is what AliExpress reported and never changes, while `commission_ils`
   * is re-derived at each sync's rate — a trend chart built on it silently rewrites its own
   * history between page loads. Cancelled commissions are excluded — revenue that
   * evaporated is not revenue.
   */
  private monthlySeries(
    repo: Repository<any>, alias: string, localCol: string, valueExpr: string,
    userId: string, keys: string[], extraWhere?: string,
  ): Promise<Array<{ bucket: string; value: number }>> {
    const qb = repo.createQueryBuilder(alias)
      .select(`to_char(${localCol}, 'YYYY-MM')`, 'bucket')
      .addSelect(valueExpr, 'value')
      .where(`${alias}.user_id = :userId`, { userId })
      .andWhere(`${localCol} >= :fromLocal`, { fromLocal: `${keys[0]}-01 00:00:00` });
    if (extraWhere) qb.andWhere(extraWhere);
    return qb.groupBy('bucket').getRawMany();
  }

  /** A single scalar over one local-time window — the elapsed-stretch delta baseline. */
  private windowTotal(
    repo: Repository<any>, alias: string, localCol: string, valueExpr: string,
    userId: string, fromLocal: string, toLocal: string, extraWhere?: string,
  ): Promise<number> {
    const qb = repo.createQueryBuilder(alias)
      .select(valueExpr, 'value')
      .where(`${alias}.user_id = :userId`, { userId })
      .andWhere(`${localCol} >= :fromLocal`, { fromLocal })
      .andWhere(`${localCol} < :toLocal`, { toLocal });
    if (extraWhere) qb.andWhere(extraWhere);
    return qb.getRawOne().then((r) => Number(r?.value) || 0).catch(() => 0);
  }

  /**
   * Clicks per PLATFORM over the last N days — where the traffic actually comes from.
   * Source is the ?s= tag each send path stamps on its published link (click-source.ts);
   * NULL = a click on a link published before tagging existed, reported as 'other' so the
   * numbers always add up to the total instead of quietly dropping history.
   */
  async clickSources(userId: string, days = 30): Promise<{ days: number; total: number; sources: Array<{ source: string; clicks: number }> }> {
    const d = Math.min(365, Math.max(1, Math.floor(days) || 30));
    const from = new Date(Date.now() - d * 86_400_000);
    const rows: Array<{ source: string | null; n: number }> = await this.clicks.createQueryBuilder('c')
      .select('c.source', 'source')
      .addSelect('COUNT(*)::int', 'n')
      .where('c.user_id = :userId', { userId })
      .andWhere('c.clicked_at >= :from', { from })
      .groupBy('c.source')
      .getRawMany();
    const sources = rows
      .map((r) => ({ source: r.source || 'other', clicks: Number(r.n) || 0 }))
      .sort((a, b) => b.clicks - a.clicks);
    return { days: d, total: sources.reduce((s, r) => s + r.clicks, 0), sources };
  }
}
