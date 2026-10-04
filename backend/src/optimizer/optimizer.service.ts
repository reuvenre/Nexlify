import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import { Campaign } from '../campaigns/campaign.entity';
import { Channel } from '../channels/channel.entity';
import { OptimizerRun } from './optimizer-run.entity';
import { ChannelResult, DeliveryOutcome, deliveryOutcome } from './digest-delivery';
import { CredentialsService } from '../credentials/credentials.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { MailService } from '../mail/mail.service';
import { ProductsService } from '../products/products.service';
import { EarningsService } from '../earnings/earnings.service';
import { AiService } from '../ai/ai.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PinterestService } from '../pinterest/pinterest.service';
import { CategoryScore, SoldProduct, newKeywordsFor, scoreCategories } from './order-learning';
import { HotHoursResult, HourClicks, formatHours, hotHours } from './hot-hours';
import { soldPriceBand } from './sold-price-band';
import { tidyRtlBody } from '../posts/rtl';
import { frictionProducts, pickTopAction, trendArrow } from './digest-insights';
import { collapsedKeywords, hoursChanged, postsPerRunDelta } from './manager-rules';
import { BriefAction, buildBrief } from './digest-brief';
import { ActionRow, actionLabel, isUndoable, undoPlan } from './action-undo';
import { digestKeyboard } from './digest-keyboard';
import {
  CampaignProfile, FittedCategory, FIT_SYSTEM_PROMPT, MAX_FIT_CANDIDATES,
  buildFitPrompt, lexicalFit, parseFitVerdicts, rankFitted,
} from './campaign-fit';
import {
  MIN_CLICKS_TO_PICK_WINNER, MIN_POSTS_PER_VARIANT, VariantScore, VariantStat,
  bestVariant, scoreVariants, variantLabel,
} from '../posts/copy-variants';

interface KeywordScore { keyword: string; posts: number; clicks: number; revenue_ils: number }
interface CampaignActions {
  campaign: string; retired: string[]; boosted: string | null; unboosted: string[];
  /** Categories added to this campaign from what actually sold — each one judged to fit
   *  THIS group, with the reason it was judged to fit (opt-in per campaign). */
  learned: FittedCategory[];
  /** Account winners this group was NOT given, because they do not suit its audience. */
  rejected: string[];
  /** The campaign drew too few clicks in the window to call any keyword dead. */
  tooQuietToJudge: boolean;
  /** Clicks actually measured in the window — printed with the "too quiet" line so the
   *  owner sees how far the campaign is from the threshold instead of only that it missed. */
  windowClicks: number;
  /** Days the score window covered — the wide one when the normal window was too quiet. */
  windowDays: number;
  /** Learning from what sold is switched off for this campaign — the reason nothing is
   *  ever added, which reads identically to "nothing worth adding" unless it is said. */
  learningOff: boolean;
  /** Which evidence the decisions stood on: this campaign's own numbers, or the keyword's
   *  behaviour across the account (the fallback that lets a quiet campaign be judged). */
  basis: 'campaign' | 'account';
  /** manager_actions row for tonight's rotation change — the handle the owner's undo
   *  button carries. Null when nothing changed, or when the log write itself failed. */
  actionId?: string | null;
}

/** Scoring window — long enough for commissions to land, short enough to track trends. */
const WINDOW_DAYS = 14;
/** Fallback window for a campaign too quiet to judge over the normal one. Sparse data is
 *  not the same as bad data: look further back before concluding anything. */
const SPARSE_WINDOW_DAYS = 30;
/** Window for the per-channel earnings breakdown — wide enough to have rows on an account
 *  that sees a handful of orders a day, recent enough to still describe how things are. */
const SOURCE_WINDOW_DAYS = 30;
/**
 * Clicks a campaign must have drawn IN TOTAL before any of its keywords can be called dead.
 *
 * Retirement asks "did this keyword fail?", but on a low-traffic campaign the honest answer
 * is usually "nobody clicked anything this week" — a fact about the account, not about the
 * keyword. Without this floor the rule fires on silence: every keyword looks dead, three
 * are retired a day, and the rotation grinds down to the minimum for no reason at all.
 */
const MIN_CAMPAIGN_CLICKS_TO_JUDGE = 10;
/** A keyword must have had this many posted products before it can be judged dead. */
const MIN_POSTS_TO_JUDGE = 5;
/** Never optimize a campaign below this many distinct active keywords. */
const MIN_ACTIVE_KEYWORDS = 5;
/** At most this many retirements per campaign per day — slow, reversible pressure. */
const MAX_RETIRE_PER_DAY = 3;
/**
 * Clicks a product must draw, with NO order behind any of them, before the engine stops
 * recycling it. Set above the retirement threshold on purpose: a product is a bigger unit
 * than a keyword, and the cost of muting a slow converter is higher than the cost of
 * letting one more click go by.
 */
const MIN_CLICKS_TO_MUTE = 8;
/** At most this many products muted per run — a bad rule should cost a night, not a catalog. */
const MAX_MUTES_PER_RUN = 3;
/** How far back ORDERS are read for category learning. Wider than the keyword window:
 *  commissions are sparse, and a category needs several sales before it means anything. */
const ORDER_LEARNING_WINDOW_DAYS = 90;
/** Top-earning sold products resolved per run — bounds the affiliate API calls. */
const MAX_PRODUCTS_TO_RESOLVE = 40;
/** Product ids per productdetail.get call (the endpoint rejects very long id lists). */
const RESOLVE_CHUNK = 20;
/** Categories a campaign may GAIN per run — each one changes what reaches a real channel. */
const MAX_LEARNED_PER_RUN = 2;

/**
 * The learning loop: publish → measure → LEARN → adjust. Runs every morning, scores each
 * campaign's keywords by what they actually produced (posted products → clicks → attributed
 * commissions), then applies small, safe, reversible adjustments:
 *   • RETIRE keywords that got a real chance (≥5 posts) and produced zero clicks — into
 *     campaign.retired_keywords, never deleted, floor of 5 active keywords.
 *   • BOOST the top-earning keyword by doubling its slot in the round-robin (max 2×),
 *     and collapse a boost whose window revenue dried up.
 *   • LEARN the categories that actually sold — per group. The ranking is account-wide, so
 *     each candidate is judged against the specific campaign's audience before it is added;
 *     see campaign-fit.ts for why a shared top-N was making every group the same group.
 * Then it tells the owner what it did — morning digest to Telegram (the watchdog chat)
 * and email: yesterday's numbers, top product, golden hours, actions taken.
 */
@Injectable()
export class OptimizerService {
  private readonly logger = new Logger(OptimizerService.name);

  constructor(
    @InjectRepository(Campaign) private readonly campaigns: Repository<Campaign>,
    @InjectRepository(Channel) private readonly channels: Repository<Channel>,
    @InjectRepository(OptimizerRun) private readonly runs: Repository<OptimizerRun>,
    private readonly credentials: CredentialsService,
    private readonly subscription: SubscriptionService,
    private readonly mail: MailService,
    private readonly products: ProductsService,
    // Judges whether an account-wide winning category suits a specific group's audience.
    private readonly ai: AiService,
    // Owns the delivery SCHEDULE of this report (the user's chosen hour + same-day guard);
    // building and sending the digest stays here.
    private readonly notifications: NotificationsService,
    // Optional so the module still boots if earnings are ever unwired — the digest degrades
    // to whatever the standing 3-hourly sync last pulled instead of failing.
    @Optional() private readonly earnings?: EarningsService,
    // Optional for the same reason: without it, Pinterest keywords simply stay unjudged.
    @Optional() private readonly pinterest?: PinterestService,
  ) {}

  /**
   * Dispatches each user's insights report at the hour THEY chose
   * (notification_prefs.insights_hour, floored at 10 — see report-hours.ts: AliExpress
   * closes its accounting day at 10:00 Israel, and a digest before that reports and learns
   * from numbers still in motion).
   *
   * The FIRST opportunity each hour is still :10, so a 10:00 reader gets the report at
   * 10:10 exactly as before. The later ticks are the retry: this used to run once an hour,
   * which meant any tick lost to a restart, a deploy, or a host that had spun down cost a
   * FULL HOUR — the report then landed at hh:10 of the next hour and read as "late" with
   * nothing in the UI to explain it. Retrying every ten minutes bounds that to ten.
   *
   * The zone is explicit rather than a UTC hour because Israel observes DST: a hardcoded
   * UTC hour would drift an hour off the boundary this schedule exists to sit behind.
   */
  @Cron('0 10,20,30,40,50 * * * *', { timeZone: 'Asia/Jerusalem' })
  async runDaily(): Promise<void> {
    // A pass can take minutes (orders sync, then up to 40 sequential Pinterest analytics
    // calls, then the run itself). At an hourly cadence an overrun was unreachable; at ten
    // minutes it is not, and two concurrent passes would send the owner two reports —
    // neither one stamped before the other started.
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      await this.dispatchDue();
    } finally {
      this.dispatching = false;
    }
  }

  private dispatching = false;

  private async dispatchDue(): Promise<void> {
    let userIds: string[] = [];
    try {
      userIds = await this.credentials.listUserIdsWithOptimizer();
    } catch (err: any) {
      this.logger.error(`optimizer user scan failed: ${err.message}`);
      return;
    }
    const claimed = await this.notifications.insightsDue(userIds).catch((err: any) => {
      this.logger.error(`optimizer due-scan failed: ${err.message}`);
      return [] as string[];
    });
    // SECOND guard, on the run history rather than the stamp: a user who already got a
    // report today does not get another one, whatever the stamp says. This is what the
    // hourly dispatch needed on its first day — every existing user had a NULL stamp
    // (the column had just been added) and so read as "due", which re-sent the morning
    // digest hours after it had already gone out. It also covers a lost stamp write.
    const due: string[] = [];
    for (const uid of claimed) {
      if (await this.ranToday(uid)) continue;
      due.push(uid);
    }
    if (!due.length) return; // nobody this hour — no sync, no work

    // Pull orders FIRST, once per tick that actually has work. The standing sync runs every
    // 3 hours on a UTC grid and can easily have last landed BEFORE the 10:00 close, which
    // would defeat the point of the schedule. Best-effort: a sync failure must not cost the
    // owner the digest.
    if (this.earnings) {
      const r = await this.earnings.syncAllUsers().catch((err: any) => {
        this.logger.warn(`optimizer pre-digest earnings sync failed: ${err.message}`);
        return null;
      });
      if (r) this.logger.log(`optimizer pre-digest sync: ${r.synced} new, ${r.updated} updated across ${r.users} users`);
    }

    for (const uid of due) {
      try {
        // Built today but never arrived? Only the transport failed — repeat just that.
        if (await this.redeliverPending(uid)) {
          await this.notifications.markInsightsSent(uid);
          continue;
        }
        // Pinterest clicks live in Pinterest's analytics, not in link_clicks (a Pin carries
        // the direct affiliate URL). Pull them in BEFORE scoring, or every Pinterest
        // keyword reads as zero-click and the engine can never judge one.
        if (this.pinterest) {
          await this.pinterest.syncPinClicks(uid).catch((err: any) => {
            this.logger.warn(`pinterest click sync failed for ${uid}: ${err.message}`);
          });
        }
        await this.runForUser(uid);
        // Stamped only after a successful run, so a failure retries on the next tick
        // instead of silently costing the user that day's report.
        await this.notifications.markInsightsSent(uid);
      } catch (err: any) {
        this.logger.error(`optimizer failed for ${uid}: ${err.message}`);
      }
    }
  }

  /**
   * Did this user's report already reach them today (local day)?
   *
   * DELIVERED, not merely run. The row is written before the send, so counting a bare row
   * as "done" let one failed transport cost the whole report: the guard saw the run, every
   * later tick skipped, and nothing retried. An undelivered row is unfinished work.
   */
  private async ranToday(userId: string): Promise<boolean> {
    const [row] = await this.campaigns.query(
      `SELECT 1 FROM optimizer_runs
       WHERE user_id = $1
         AND delivered_at IS NOT NULL
         AND (created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jerusalem'
             >= date_trunc('day', (now() AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jerusalem')
       LIMIT 1`,
      [userId],
    ).catch(() => []);
    return !!row;
  }

  /**
   * One optimization pass for a user. Returns the digest text so a manual run can show it
   * on screen immediately — waiting until tomorrow morning to find out whether the engine
   * works is not a reasonable way to verify it.
   */
  async runForUser(userId: string): Promise<{ ok: boolean; digest?: string; detail?: string; reason?: string }> {
    if (!(await this.subscription.allows(userId, 'learning_optimizer'))) {
      return { ok: false, reason: 'המנוע הלומד זמין במסלול Autopilot ומעלה' };
    }

    const active = await this.campaigns.find({
      where: { user_id: userId, status: 'active', source: 'aliexpress' },
    });
    const allActions: CampaignActions[] = [];
    const allScores: Record<string, KeywordScore[]> = {};
    // Every action-log row written by THIS pass, in the order it happened. Collected as we
    // go rather than queried by timestamp afterwards: two passes for the same account (the
    // cron and a manual "run now") would otherwise claim each other's changes.
    const loggedIds: string[] = [];

    // What actually SOLD, ranked by category. Computed once for the account: orders are not
    // reliably attributable to a campaign (most are for products the autopilot never posted),
    // so this is account-level knowledge that each campaign may opt into.
    const soldCategories = await this.learnFromOrders(userId).catch((err: any) => {
      this.logger.warn(`order learning failed for ${userId}: ${err.message}`);
      return [] as CategoryScore[];
    });

    // The groups each campaign publishes to — the audience half of "does this fit here?".
    const channelsById = await this.channelsById(userId);
    // Categories already handed to an earlier campaign in THIS run. Used only as a
    // tie-break, so equally-suitable groups drift apart instead of converging on one list.
    const claimed = new Set<string>();

    for (const c of active) {
      let scores = await this.scoreKeywords(userId, c.id, WINDOW_DAYS);
      let window = WINDOW_DAYS;
      // Too quiet to judge over the normal window? Look further back before deciding
      // anything — a keyword that drew nothing in a slow fortnight may have earned in the
      // month behind it, and the wider window is what tells those two apart.
      if (this.totalClicks(scores) < MIN_CAMPAIGN_CLICKS_TO_JUDGE) {
        scores = await this.scoreKeywords(userId, c.id, SPARSE_WINDOW_DAYS);
        window = SPARSE_WINDOW_DAYS;
      }
      // Still too quiet after looking a month back? Judge the keywords on how they behave
      // ACROSS the account. Without this the engine simply never decided anything at these
      // volumes — every morning reported "not enough data" and changed nothing.
      let basis: 'campaign' | 'account' = 'campaign';
      if (this.totalClicks(scores) < MIN_CAMPAIGN_CLICKS_TO_JUDGE) {
        const wide = await this.scoreKeywordsAccountWide(
          userId, c.keywords || [], SPARSE_WINDOW_DAYS,
        );
        if (this.totalClicks(wide) >= MIN_CAMPAIGN_CLICKS_TO_JUDGE) {
          scores = wide;
          basis = 'account';
        }
      }
      allScores[c.name] = scores;
      const actions = await this.applyActions(
        userId, c, scores, soldCategories, channelsById, claimed, window, basis,
      );
      for (const l of actions.learned) claimed.add(l.keyword.toLowerCase());
      if (actions.actionId) loggedIds.push(actions.actionId);
      if (actions.retired.length || actions.boosted || actions.unboosted.length
        || actions.learned.length || actions.rejected.length || actions.tooQuietToJudge
        || actions.learningOff) {
        allActions.push(actions);
      }
    }

    const stats = await this.digestStats(userId);
    const copyAngles = await this.copyAngleReport(userId);
    const hotByGroup = await this.groupHotHours(userId).catch(() => []);
    // The daily manager: three owner-approved bounded actions, every one logged and
    // reported below. Failures never break the digest.
    const managerLines = await this.runManagerActions(userId, active, hotByGroup, loggedIds).catch((e) => {
      this.logger.warn(`manager actions failed for ${userId}: ${e?.message}`);
      return [] as string[];
    });
    // The findings that used to be printed as homework, acted on instead.
    const autoLines = await this.runAutonomousActions(userId, active, loggedIds).catch((e) => {
      this.logger.warn(`autonomous actions failed for ${userId}: ${e?.message}`);
      return [] as string[];
    });
    let digest = this.buildDigest(stats, allActions, soldCategories, active, copyAngles, hotByGroup);
    // Sunday carries the week's review — the trend view a single day cannot show. Israel
    // time, because that is the week the owner lives in (Sunday is a working day here).
    const weekday = new Date().toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Asia/Jerusalem' });
    if (weekday === 'Sun') {
      const weekly = await this.weeklyReview(userId).catch((e) => {
        this.logger.warn(`weekly review failed for ${userId}: ${e?.message}`);
        return [] as string[];
      });
      if (weekly.length) digest += `\n${weekly.join('\n')}`;
    }
    const changedLines = [...managerLines, ...autoLines];
    if (changedLines.length) {
      digest += `\n\n🤖 סוכן-המנהל — מה שיניתי היום:\n${changedLines.map((l) => `  • ${l}`).join('\n')}`;
    }
    // Pin every line to the right. A bidi renderer picks each LINE's direction from its
    // first strong character, and nearly every line here opens with an emoji or a bullet —
    // neutral — so a line whose first strong character happened to be Latin ("storage box",
    // a product title) flipped left and the report read as a ragged mix. Same fix the post
    // bodies use, applied last so the manager and weekly blocks are covered too.
    digest = tidyRtlBody(digest);

    // What the owner actually receives. The long text above stops being the report and
    // becomes the EVIDENCE behind it — reachable by a button, not delivered unasked.
    const changes = await this.briefActions(userId, loggedIds);
    const brief = tidyRtlBody(buildBrief({
      dateLabel: this.dayLabel(new Date()),
      posts: stats.posts_yesterday, postsArrow: trendArrow(stats.posts_yesterday, stats.avg_posts),
      clicks: stats.clicks_yesterday, clicksArrow: trendArrow(stats.clicks_yesterday, stats.avg_clicks),
      orders: stats.orders_yesterday, ordersArrow: trendArrow(stats.orders_yesterday, stats.avg_orders),
      revenueIls: stats.revenue_yesterday_ils,
      portalDayLabel: stats.portal_day
        ? stats.portal_day.split('-').reverse().slice(0, 2).join('.')
        : null,
      bonusOrders: stats.bonus_orders,
      bonusPaidUsd: stats.bonus_paid_usd,
      actions: changes,
    }));

    // Both texts ride along: a failed delivery re-sends tomorrow's tick without recomputing
    // the day, and the "full detail" button reads the long one straight off the run.
    const run = await this.runs.save(this.runs.create({
      user_id: userId,
      summary_json: JSON.stringify({
        scores: allScores, actions: allActions, stats, soldCategories,
        digest: brief, detail: digest, actionIds: loggedIds,
      }),
      delivered_at: null,
    })).catch(() => null);

    const outcome = await this.deliverDigest(userId, brief, digest, run?.id || null);
    if (outcome.delivered) {
      if (run) await this.runs.update({ id: run.id }, { delivered_at: new Date() }).catch(() => {});
      return { ok: true, digest: brief, detail: digest };
    }
    // Not delivered: leave delivered_at NULL so the next hourly tick re-sends, and fail
    // loudly so markInsightsSent is not called for a report nobody got.
    throw new Error(`הדו"ח לא נמסר — ${outcome.reason}`);
  }

  /**
   * Keyword scorecard over the window: how many products it posted, the clicks those
   * posts drew, and the commissions attributed to those products after their posts went
   * out. Attribution is heuristic (same product, order after post) — the same signal the
   * attribution report uses; good enough to rank keywords, not an accounting statement.
   */
  /**
   * The same scoring, but for a keyword ACROSS THE WHOLE ACCOUNT.
   *
   * A single campaign rarely clears the click floor at these volumes, so the engine spent
   * most mornings declining to judge anything — a learning engine that never learns. The
   * same keyword usually runs in several campaigns, and its behaviour there is evidence
   * about the keyword: five posts and no clicks anywhere is a dead phrase, whichever group
   * it was posted to. This is the fallback signal, used only when the campaign's own window
   * is too quiet, and the digest says which basis a decision stood on.
   *
   * It is deliberately NOT the default: where a campaign has its own numbers, its own
   * audience is the better judge — a phrase that dies with the moms can earn with the
   * tactical crowd, and the account-wide view would flatten exactly that difference.
   */
  private async scoreKeywordsAccountWide(
    userId: string, keywords: string[], windowDays: number,
  ): Promise<KeywordScore[]> {
    const kws = Array.from(new Set((keywords || []).map((k) => String(k).trim()).filter(Boolean)));
    if (!kws.length) return [];
    const rows: any[] = await this.campaigns.query(
      `SELECT pp.keyword,
              count(DISTINCT pp.product_id)::int                    AS posts,
              coalesce(sum(p.clicks_count + p.pinterest_clicks), 0)::int AS clicks,
              coalesce((
                SELECT sum(e.commission_ils)
                FROM earnings e
                WHERE e.user_id = $1
                  AND lower(e.keyword) = lower(pp.keyword)
                  AND e.order_date > now() - ($3 || ' days')::interval
              ), 0)::float                                          AS revenue_ils
       FROM campaign_posted_products pp
       JOIN campaigns c ON c.id = pp.campaign_id AND c.user_id = $1
       LEFT JOIN posts p
         ON p.campaign_id = pp.campaign_id AND p.product_id = pp.product_id AND p.status = 'sent'
       WHERE pp.keyword IS NOT NULL
         AND lower(pp.keyword) = ANY($2::text[])
         AND pp.created_at > now() - ($3 || ' days')::interval
       GROUP BY pp.keyword`,
      [userId, kws.map((k) => k.toLowerCase()), String(windowDays)],
    ).catch(() => []);
    return rows.map((r) => ({
      keyword: String(r.keyword),
      posts: Number(r.posts) || 0,
      clicks: Number(r.clicks) || 0,
      revenue_ils: +(Number(r.revenue_ils) || 0).toFixed(2),
    }));
  }

  private async scoreKeywords(
    userId: string, campaignId: string, windowDays: number,
  ): Promise<KeywordScore[]> {
    const rows: any[] = await this.campaigns.query(
      `SELECT pp.keyword,
              count(DISTINCT pp.product_id)::int                    AS posts,
              coalesce(sum(p.clicks_count + p.pinterest_clicks), 0)::int AS clicks,
              coalesce((
                SELECT sum(e.commission_ils)
                FROM earnings e
                WHERE e.user_id = $1
                  AND e.product_id IN (
                    SELECT pp2.product_id FROM campaign_posted_products pp2
                    WHERE pp2.campaign_id = $2 AND pp2.keyword = pp.keyword
                      AND pp2.created_at > now() - ($3 || ' days')::interval
                  )
                  AND e.order_date > now() - ($3 || ' days')::interval
              ), 0)::float                                          AS revenue_ils
       FROM campaign_posted_products pp
       LEFT JOIN posts p
         ON p.campaign_id = pp.campaign_id AND p.product_id = pp.product_id AND p.status = 'sent'
       WHERE pp.campaign_id = $2
         AND pp.keyword IS NOT NULL
         AND pp.created_at > now() - ($3 || ' days')::interval
       GROUP BY pp.keyword`,
      [userId, campaignId, String(windowDays)],
    ).catch(() => []);
    return rows.map((r) => ({
      keyword: String(r.keyword),
      posts: Number(r.posts) || 0,
      clicks: Number(r.clicks) || 0,
      revenue_ils: +(Number(r.revenue_ils) || 0).toFixed(2),
    }));
  }

  /** Everything this campaign's keywords drew in the window — the measure of whether the
   *  campaign produced enough signal to judge any single keyword by. */
  private totalClicks(scores: KeywordScore[]): number {
    return scores.reduce((n, s) => n + s.clicks, 0);
  }

  /**
   * The products that actually sold, resolved to their AliExpress categories and ranked.
   *
   * Per-post attribution is not usable here: of the products sold on this account only a
   * handful were ever published by the autopilot, so "which of my posts earned" sees a
   * couple of percent of reality. Categories aggregate across ALL orders — including the
   * owner's other traffic on the same tracking id — which is where the signal lives.
   *
   * Bounded on purpose: the top earners by commission, in chunks, so a daily run costs a
   * predictable couple of affiliate API calls.
   */
  private async learnFromOrders(userId: string): Promise<CategoryScore[]> {
    const rows: any[] = await this.campaigns.query(
      `SELECT product_id,
              count(*)::int                            AS orders,
              coalesce(sum(commission_ils), 0)::float  AS commission_ils
       FROM earnings
       WHERE user_id = $1 AND product_id IS NOT NULL
         AND order_date > now() - ($2 || ' days')::interval
       GROUP BY product_id
       ORDER BY commission_ils DESC, orders DESC
       LIMIT $3`,
      [userId, String(ORDER_LEARNING_WINDOW_DAYS), MAX_PRODUCTS_TO_RESOLVE],
    ).catch(() => []);
    if (!rows.length) return [];

    const ids = rows.map((r) => String(r.product_id));
    const resolved = new Map<string, any>();
    for (let i = 0; i < ids.length; i += RESOLVE_CHUNK) {
      const chunk = ids.slice(i, i + RESOLVE_CHUNK);
      const batch = await this.products.refreshPricesBatch(userId, chunk).catch(() => new Map());
      for (const [id, product] of batch) resolved.set(String(id), product);
    }

    const sold: SoldProduct[] = rows.map((r) => {
      const product = resolved.get(String(r.product_id));
      return {
        productId: String(r.product_id),
        orders: Number(r.orders) || 0,
        commissionIls: Number(r.commission_ils) || 0,
        category: product?.category ?? null,
        subcategory: product?.subcategory ?? null,
      };
    });

    const scored = scoreCategories(sold);
    if (scored.length) {
      this.logger.log(`order learning [${userId}]: ${scored.length} categories from `
        + `${sold.length} sold products — top: ${scored.slice(0, 3).map((s) => `${s.keyword} (₪${s.commissionIls})`).join(', ')}`);
    }
    return scored;
  }

  /** Small, safe, reversible adjustments to the campaign's keyword rotation. */
  private async applyActions(
    userId: string, c: Campaign, scores: KeywordScore[], soldCategories: CategoryScore[] = [],
    channelsById: Map<string, Channel> = new Map(), claimed: Set<string> = new Set(),
    windowDays: number = WINDOW_DAYS, basis: 'campaign' | 'account' = 'campaign',
  ): Promise<CampaignActions> {
    const out: CampaignActions = {
      campaign: c.name, retired: [], boosted: null, unboosted: [], learned: [], rejected: [],
      tooQuietToJudge: false,
      windowClicks: this.totalClicks(scores),
      windowDays,
      learningOff: !c.learn_from_orders,
      basis,
    };
    const byKw = new Map(scores.map((s) => [s.keyword, s]));
    let kws = [...(c.keywords || [])];
    const distinct = () => Array.from(new Set(kws));
    // The state to put back if the owner rejects tonight's rotation. Captured before the
    // rules run, and including retired_keywords — a retirement moves a word between the
    // two lists, so restoring only one of them would lose it.
    const keywordsBefore = [...kws];
    const retiredBefore = [...(c.retired_keywords || [])];

    // 1) Collapse stale boosts: a duplicated keyword whose window revenue dried up goes
    //    back to a single slot (fully reversible pressure valve).
    for (const kw of distinct()) {
      const copies = kws.filter((k) => k === kw).length;
      if (copies > 1 && (byKw.get(kw)?.revenue_ils || 0) <= 0) {
        kws = kws.filter((k) => k !== kw); kws.push(kw);
        out.unboosted.push(kw);
      }
    }

    // 2) Retire dead keywords: a fair chance (≥MIN_POSTS_TO_JUDGE products posted) and not
    //    a single click. Into retired_keywords (visible, restorable), never below the floor.
    //
    //    But only when the campaign drew enough clicks IN TOTAL to tell a dead keyword from
    //    a quiet window. Below that floor every keyword scores zero and the rule would fire
    //    on all of them — retiring the good ones right along with the bad, and calling the
    //    account's silence a verdict on the rotation. Nothing is retired instead.
    out.tooQuietToJudge = this.totalClicks(scores) < MIN_CAMPAIGN_CLICKS_TO_JUDGE;
    if (out.tooQuietToJudge) {
      this.logger.log(`optimizer [${c.name}]: ${this.totalClicks(scores)} clicks over `
        + `${windowDays}d — below the floor to judge a keyword dead, retiring nothing`);
    } else {
      const dead = scores
        .filter((s) => s.posts >= MIN_POSTS_TO_JUDGE && s.clicks === 0 && s.revenue_ils <= 0)
        .map((s) => s.keyword)
        .filter((kw) => kws.includes(kw));
      for (const kw of dead.slice(0, MAX_RETIRE_PER_DAY)) {
        if (distinct().length <= MIN_ACTIVE_KEYWORDS) break;
        kws = kws.filter((k) => k !== kw);
        c.retired_keywords = Array.from(new Set([...(c.retired_keywords || []), kw]));
        out.retired.push(kw);
      }
    }

    // 3) Boost the top earner: double its slot in the round-robin (cap 2×) so it posts
    //    twice per cycle. Only one boosted keyword at a time — focus beats spray.
    const top = [...scores].sort((a, b) => b.revenue_ils - a.revenue_ils)[0];
    if (top && top.revenue_ils > 0 && kws.includes(top.keyword)) {
      const copies = kws.filter((k) => k === top.keyword).length;
      if (copies === 1) { kws.push(top.keyword); out.boosted = top.keyword; }
    }

    // 4) LEARN from what sold — but only what suits THIS group.
    //    The categories are ranked account-wide, so the top of that list is the same list for
    //    every campaign. Handing it out as-is made all the groups converge on one rotation:
    //    a mothers-and-brands group and a general-deals group were both given "Hunting" the
    //    same night. So each candidate now has to pass a per-group fit judgement first, and
    //    a group that fits none of tonight's winners simply gains nothing.
    if (c.learn_from_orders && soldCategories.length) {
      const profile = this.profileOf(c, kws, scores, channelsById);
      const candidates = newKeywordsFor(
        soldCategories, kws, c.retired_keywords || [], MAX_FIT_CANDIDATES,
      );
      const { fitted, rejected } = await this.judgeFit(
        userId, profile, candidates, claimed, MAX_LEARNED_PER_RUN,
      );
      for (const a of fitted) {
        kws.push(a.keyword);
        out.learned.push(a);
      }
      out.rejected = rejected;
    }

    if (out.retired.length || out.boosted || out.unboosted.length || out.learned.length) {
      c.keywords = kws;
      await this.campaigns.save(c).catch((err: any) =>
        this.logger.warn(`optimizer save failed for campaign ${c.id}: ${err.message}`));
      this.logger.log(`optimizer [${c.name}]: retired=${out.retired.join(',') || '—'} boosted=${out.boosted || '—'} unboosted=${out.unboosted.join(',') || '—'} learned=${out.learned.map((l) => l.keyword).join(',') || '—'}`);

      // The rotation used to change with nothing written down, so the morning report could
      // describe it but the owner could not take it back. One row per campaign per night:
      // the unit he sees in the brief is the unit his undo button addresses.
      const why = [
        out.learned.length ? `נלמדו: ${out.learned.map((l) => l.keyword).join(', ')}` : '',
        out.retired.length ? `הודחו: ${out.retired.join(', ')}` : '',
        out.boosted ? `הוכפלה: ${out.boosted}` : '',
        out.unboosted.length ? `חזרו למינון רגיל: ${out.unboosted.join(', ')}` : '',
      ].filter(Boolean).join(' · ');
      out.actionId = await this.logAction(userId, {
        kind: 'keywords',
        targetId: c.id,
        targetLabel: c.name,
        before: JSON.stringify({ keywords: keywordsBefore, retired: retiredBefore }),
        after: JSON.stringify({ keywords: kws, retired: c.retired_keywords || [] }),
        reason: why,
      });
    }
    return out;
  }

  /** The user's groups by id, so a campaign's target_channels resolve to real audiences. */
  private async channelsById(userId: string): Promise<Map<string, Channel>> {
    const rows = await this.channels.find({ where: { user_id: userId } }).catch(() => [] as Channel[]);
    return new Map(rows.map((ch) => [ch.id, ch]));
  }

  /** What this campaign IS, assembled from everything that describes it. */
  private profileOf(
    c: Campaign, keywords: string[], scores: KeywordScore[], channelsById: Map<string, Channel>,
  ): CampaignProfile {
    let ids: string[] = [];
    try { ids = JSON.parse(c.target_channels || '[]'); } catch { ids = []; }
    const channels = ids
      .map((id) => channelsById.get(String(id)))
      .filter((ch): ch is Channel => !!ch)
      .map((ch) => (ch.description ? `${ch.name} — ${ch.description}` : ch.name));

    return {
      name: c.name,
      keywords: Array.from(new Set(keywords)),
      retired: c.retired_keywords || [],
      channels,
      // Proven appetite inside THIS group, which outranks any account-wide number.
      earning: scores.filter((s) => s.revenue_ils > 0 || s.clicks > 0).map((s) => s.keyword),
    };
  }

  /**
   * Ask the account's model which of tonight's winners belong in this group.
   *
   * Failure is not neutral here, so it is never treated as such: if no model answers, the
   * decision falls back to the vocabulary check, which only passes a category the group's
   * own rotation already talks about. Both gates closed means the group gains nothing — the
   * correct outcome, and the one the old code got wrong by adding regardless.
   */
  private async judgeFit(
    userId: string, profile: CampaignProfile, candidates: CategoryScore[],
    claimed: Set<string>, max: number,
  ): Promise<{ fitted: FittedCategory[]; rejected: string[] }> {
    if (!candidates.length) return { fitted: [], rejected: [] };

    const creds = await this.credentials.getRaw(userId).catch(() => null);
    const result = creds
      ? await this.ai.generate(creds, {
        system: FIT_SYSTEM_PROMPT,
        prompt: buildFitPrompt(profile, candidates),
        maxTokens: 700,
        // A fit judgement is not creative writing — the same group and the same candidates
        // should not swing between "belongs" and "off-brand" from one night to the next.
        temperature: 0,
      }).catch((err: any) => {
        this.logger.warn(`fit judge failed for [${profile.name}]: ${err?.message}`);
        return null;
      })
      : null;

    const verdicts = result?.text
      ? parseFitVerdicts(result.text, candidates)
      : candidates.map((c) => ({
        keyword: c.keyword,
        fits: lexicalFit(c.keyword, profile),
        reason: 'תואמת את מילות המפתח של הקבוצה',
      }));

    if (!result?.text) {
      this.logger.warn(`fit judge unavailable for [${profile.name}] — falling back to the vocabulary check`);
    }

    // Only an explicit "does not belong" is reported as a rejection. A candidate that fit
    // but lost to the per-run cap is still a candidate tomorrow, not an off-brand one.
    const rejected = verdicts.filter((v) => !v.fits).map((v) => v.keyword);
    return { fitted: rankFitted(candidates, verdicts, profile, claimed, max), rejected };
  }

  /**
   * Golden hours PER GROUP — when each group's own audience actually clicks (local
   * Asia/Jerusalem hours, last 30 days). A click is attributed to the post's primary
   * target group (channel_override). Groups below the data floor come back with
   * `verdict: null` so the digest can say "not enough data yet" instead of guessing.
   */
  async groupHotHours(userId: string): Promise<Array<{ channel_id: string; name: string; verdict: HotHoursResult | null }>> {
    const rows: Array<{ channel_id: string; hour: number; clicks: number }> = await this.campaigns.query(
      `SELECT p.channel_override AS channel_id,
              extract(hour from (lc.clicked_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jerusalem')::int AS hour,
              count(*)::int AS clicks
       FROM link_clicks lc
       JOIN posts p ON p.id = lc.post_id
       WHERE lc.user_id = $1
         AND lc.clicked_at > now() - interval '30 days'
         AND p.channel_override IS NOT NULL
       GROUP BY 1, 2`,
      [userId],
    ).catch(() => []);
    if (!rows.length) return [];

    const byChannel = new Map<string, HourClicks[]>();
    for (const r of rows) {
      const list = byChannel.get(r.channel_id) || [];
      list.push({ hour: Number(r.hour), clicks: Number(r.clicks) });
      byChannel.set(r.channel_id, list);
    }

    const names: Array<{ id: string; name: string }> = await this.campaigns.query(
      `SELECT id, name FROM channels WHERE user_id = $1`, [userId],
    ).catch(() => []);
    const nameOf = new Map(names.map((n) => [String(n.id), String(n.name || '')]));

    return Array.from(byChannel.entries())
      .filter(([id]) => nameOf.has(id)) // clicks for a deleted group teach nothing actionable
      .map(([id, hours]) => ({ channel_id: id, name: nameOf.get(id)!, verdict: hotHours(hours) }))
      .sort((a, b) => (b.verdict?.total || 0) - (a.verdict?.total || 0));
  }

  /** dd.MM in the owner's timezone — the report's own date, not the portal's. */
  private dayLabel(d: Date): string {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: '2-digit', timeZone: process.env.SCHEDULER_TZ || 'Asia/Jerusalem',
    }).format(d).replace('/', '.');
  }

  /** The action-log rows this pass wrote, as the brief's bullet list. */
  private async briefActions(userId: string, ids: string[]): Promise<BriefAction[]> {
    const rows = await this.actionRows(userId, ids);
    return rows.map((r) => ({ id: r.id, text: actionLabel(r) }));
  }

  /** Action-log rows by id, scoped to their owner. Order follows the ids given. */
  private async actionRows(userId: string, ids: string[]): Promise<ActionRow[]> {
    if (!ids.length) return [];
    const rows: ActionRow[] = await this.campaigns.query(
      `SELECT id, kind, target_id, target_label, "before", "after", reason, until_at, undone_at
       FROM manager_actions WHERE user_id = $1 AND id = ANY($2::uuid[])`,
      [userId, ids],
    ).catch((err: any) => {
      this.logger.warn(`action rows read failed: ${err?.message}`);
      return [] as ActionRow[];
    });
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    return ids.map((id) => byId.get(id)).filter((r): r is ActionRow => !!r);
  }

  /**
   * The changes still standing from the last few days, newest first — what the dashboard
   * lists and what the "undo" button offers when the owner asks for the list.
   */
  async recentActions(userId: string, days = 7): Promise<Array<{
    id: string; label: string; reason: string | null; undoable: boolean;
    undone: boolean; at: string;
  }>> {
    const rows: Array<ActionRow & { created_at: Date }> = await this.campaigns.query(
      `SELECT id, kind, target_id, target_label, "before", "after", reason, until_at, undone_at, created_at
       FROM manager_actions
       WHERE user_id = $1 AND created_at > now() - ($2 || ' days')::interval
       ORDER BY created_at DESC LIMIT 60`,
      [userId, String(days)],
    ).catch(() => []);
    return rows.map((r) => ({
      id: String(r.id),
      label: actionLabel(r),
      reason: r.reason,
      undoable: isUndoable(r),
      undone: !!r.undone_at,
      at: new Date(r.created_at).toISOString(),
    }));
  }

  /**
   * Put one change back.
   *
   * The row is stamped BEFORE the state is restored is deliberately NOT the order used:
   * stamping first would mark a change reversed that then failed to revert. The write
   * happens first, and only a successful one is recorded as undone.
   */
  async undoAction(userId: string, actionId: string): Promise<{ ok: boolean; label?: string; reason?: string }> {
    const [row] = await this.actionRows(userId, [actionId]);
    if (!row) return { ok: false, reason: 'הפעולה לא נמצאה' };
    if (row.undone_at) return { ok: false, reason: 'הפעולה כבר בוטלה' };
    const plan = undoPlan(row);
    if (!plan) return { ok: false, reason: 'לא ניתן לבטל את הפעולה הזו' };

    const q = (sql: string, params: any[]) => this.campaigns.query(sql, params);
    try {
      switch (plan.kind) {
        case 'keywords':
          await q(`UPDATE campaigns SET keywords = $1, retired_keywords = $2 WHERE id = $3 AND user_id = $4`,
            [plan.keywords, plan.retired, plan.campaignId, userId]);
          break;
        case 'posts_per_run':
          await q(`UPDATE campaigns SET posts_per_run = $1 WHERE id = $2 AND user_id = $3`,
            [plan.value, plan.campaignId, userId]);
          break;
        case 'keyword_pause':
          // Expiring the pause IS the inverse — the rotation reads until_at, so a past
          // timestamp releases the keyword on the next run with no other state to touch.
          await q(`UPDATE manager_actions SET until_at = now()
                   WHERE user_id = $1 AND kind = 'keyword_pause' AND target_id = $2 AND target_label = $3
                     AND until_at > now()`,
          [userId, plan.campaignId, plan.keyword]);
          break;
        case 'campaign_status':
          await q(`UPDATE campaigns SET status = $1 WHERE id = $2 AND user_id = $3`,
            [plan.status, plan.campaignId, userId]);
          break;
        case 'learn_from_orders':
          await q(`UPDATE campaigns SET learn_from_orders = $1 WHERE id = $2 AND user_id = $3`,
            [plan.value, plan.campaignId, userId]);
          break;
        case 'seasonal_keywords':
          await q(`UPDATE campaigns SET seasonal_keywords = $1 WHERE id = $2 AND user_id = $3`,
            [plan.value, plan.campaignId, userId]);
          break;
        case 'product_mute':
          // Nothing to write: the standing row IS the mute (the recycler reads the log
          // directly), so the undone_at stamp below is the entire inverse.
          break;
      }
    } catch (err: any) {
      this.logger.warn(`undo ${actionId} failed: ${err?.message}`);
      return { ok: false, reason: 'הביטול נכשל — נסה שוב' };
    }

    await this.campaigns.query(`UPDATE manager_actions SET undone_at = now() WHERE id = $1 AND user_id = $2`,
      [actionId, userId]).catch(() => {});
    return { ok: true, label: actionLabel(row) };
  }

  /** The full report behind the brief, for the "show detail" button and the dashboard. */
  async lastRunDetail(userId: string, runId?: string | null): Promise<string | null> {
    const rows: Array<{ summary_json: string }> = await this.runs.query(
      runId
        ? `SELECT summary_json FROM optimizer_runs WHERE id = $2 AND user_id = $1`
        : `SELECT summary_json FROM optimizer_runs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      runId ? [userId, runId] : [userId],
    ).catch(() => []);
    if (!rows.length) return null;
    try {
      const parsed = JSON.parse(rows[0].summary_json);
      return parsed?.detail || parsed?.digest || null;
    } catch { return null; }
  }

  /**
   * Record one change in the action log, and hand back its id.
   *
   * EVERY change the engine makes goes through here — the manager's bounded numeric moves
   * and, since the owner gave the brain authority to act on its own, the keyword rotation
   * too. The id is the undo handle: the morning brief names the change and its button
   * carries this id, so "take that one back" addresses exactly one row.
   *
   * Never throws. A change that happened but failed to log is bad; a logging failure that
   * aborts the run is worse.
   */
  private async logAction(userId: string, a: {
    kind: string; targetId: string | null; targetLabel: string | null;
    before?: string | null; after?: string | null; baseline?: string | null;
    reason: string; untilAt?: Date | null;
  }): Promise<string | null> {
    try {
      const [row] = await this.campaigns.query(
        `INSERT INTO manager_actions (user_id, kind, target_id, target_label, "before", "after", baseline, reason, until_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [userId, a.kind, a.targetId, a.targetLabel, a.before ?? null, a.after ?? null,
          a.baseline ?? null, a.reason, a.untilAt ?? null],
      );
      return row?.id ? String(row.id) : null;
    } catch (err: any) {
      this.logger.warn(`action log failed (${a.kind}): ${err?.message}`);
      return null;
    }
  }

  /**
   * The findings the report used to hand back as homework, done instead of said.
   *
   * Three lines in the old report were instructions to the owner: "switch learning on for
   * this campaign", "check the price on this product", "this campaign has stopped". He
   * asked for an engine that makes the change rather than one that files a request, so
   * each of these is now an action — logged, named in the brief, and one tap from being
   * put back.
   *
   * A change he ALREADY undid is never re-applied: an undone row is him saying no, and an
   * engine that re-decides the same thing every night is not autonomous, it is a nag with
   * write access.
   */
  private async runAutonomousActions(
    userId: string, campaigns: Campaign[], logged: string[],
  ): Promise<string[]> {
    const q = (sql: string, params: any[]) => this.campaigns.query(sql, params).catch(() => []);
    const lines: string[] = [];

    /** Did the owner reverse this exact decision before? Then it is settled. */
    const wasRejected = async (kind: string, targetId: string): Promise<boolean> => {
      const [row] = await q(
        `SELECT 1 FROM manager_actions
         WHERE user_id = $1 AND kind = $2 AND target_id = $3 AND undone_at IS NOT NULL LIMIT 1`,
        [userId, kind, targetId]);
      return !!row;
    };
    const record = async (a: Parameters<OptimizerService['logAction']>[1], line: string) => {
      const id = await this.logAction(userId, a);
      if (id) logged.push(id);
      lines.push(line);
    };

    // 1) A campaign with NO keywords left cannot publish, whatever else is configured —
    //    that is the whole of why it went quiet, and it has a determinate fix. Retired
    //    words are the only ones we know it once ran, so they come back.
    for (const c of campaigns) {
      if ((c.keywords || []).length || !(c.retired_keywords || []).length) continue;
      if (await wasRejected('keywords', c.id)) continue;
      const restored = [...(c.retired_keywords || [])];
      await q(`UPDATE campaigns SET keywords = $1, retired_keywords = $2 WHERE id = $3 AND user_id = $4`,
        [restored, [], c.id, userId]);
      await record({
        kind: 'keywords', targetId: c.id, targetLabel: c.name,
        before: JSON.stringify({ keywords: [], retired: restored }),
        after: JSON.stringify({ keywords: restored, retired: [] }),
        reason: 'הטייס נשאר בלי אף מילת מפתח ולכן הפסיק לפרסם — המילים שהודחו הוחזרו',
      }, `[${c.name}] החזרתי ${restored.length} מילות מפתח — הטייס נשאר בלי אף אחת והפסיק לפרסם`);
    }

    // 2) "Learning from sales is off here" was a line asking him to go flip a switch. The
    //    switch is his, in his account, and the report is the place he sees it flipped.
    for (const c of campaigns) {
      if (c.learn_from_orders) continue;
      if (await wasRejected('learn_from_orders', c.id)) continue;
      await q(`UPDATE campaigns SET learn_from_orders = true WHERE id = $1 AND user_id = $2`,
        [c.id, userId]);
      await record({
        kind: 'learn_from_orders', targetId: c.id, targetLabel: c.name,
        before: 'false', after: 'true',
        reason: 'קטגוריות שמוכרות בחשבון לא נכנסו לטייס הזה כי הלימוד היה כבוי',
      }, `[${c.name}] הדלקתי "למידה ממכירות" — קטגוריות שמוכרות ייכנסו לרוטציה`);
    }

    // 3) Clicks that led nowhere used to be printed as "check the price/shipping". Worse
    //    than useless on its own: winner-recycling ranks by CLICKS, so the products proven
    //    not to convert were exactly the ones it republished. Muting one keeps it out of
    //    that rotation. The standing row is the mute — no side table, and undo is the stamp.
    const friction: any[] = await q(
      `SELECT p.product_id, max(p.product_title) AS title,
              sum(p.clicks_count + coalesce(p.pinterest_clicks, 0))::int AS clicks
       FROM posts p
       WHERE p.user_id = $1 AND p.status = 'sent'
         AND p.sent_at > now() - ($2 || ' days')::interval
         AND p.product_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM earnings e
           WHERE e.user_id = $1 AND e.product_id = p.product_id AND e.status <> 'cancelled')
         AND NOT EXISTS (
           SELECT 1 FROM manager_actions ma
           WHERE ma.user_id = $1 AND ma.kind = 'product_mute' AND ma.target_id = p.product_id)
       GROUP BY p.product_id
       HAVING sum(p.clicks_count + coalesce(p.pinterest_clicks, 0)) >= $3
       ORDER BY clicks DESC LIMIT $4`,
      [userId, String(WINDOW_DAYS), MIN_CLICKS_TO_MUTE, MAX_MUTES_PER_RUN]);
    for (const f of friction) {
      const title = String(f.title || '').slice(0, 50);
      await record({
        kind: 'product_mute', targetId: String(f.product_id), targetLabel: title,
        before: 'false', after: 'true',
        reason: `${f.clicks} קליקים ואף הזמנה ב-${WINDOW_DAYS} יום`,
      }, `הפסקתי למחזר את "${title}" — ${f.clicks} קליקים ואף הזמנה`);
    }

    return lines;
  }

  /**
   * The daily manager (project 3): reviews the account once a day and takes small actions
   * from the OWNER-APPROVED list — nothing else, nothing silent. Each action inserts a
   * manager_actions row (the audit log AND the manager's own memory) and returns a Hebrew
   * line for the digest. Deterministic rules (manager-rules.ts): a bounded numeric change
   * needs a reproducible reason, not a vibe.
   */
  private async runManagerActions(
    userId: string,
    campaigns: Campaign[],
    hotByGroup: Array<{ channel_id: string; name: string; verdict: HotHoursResult | null }>,
    /** Ids of the rows written here, so the brief can offer an undo button per change. */
    logged: string[] = [],
  ): Promise<string[]> {
    const q = (sql: string, params: any[]) => this.campaigns.query(sql, params);
    const lines: string[] = [];
    const act = async (kind: string, targetId: string, targetLabel: string, before: string | null,
      after: string | null, baseline: string | null, reason: string, untilAt: Date | null) => {
      const id = await this.logAction(userId, {
        kind, targetId, targetLabel, before, after, baseline, reason, untilAt,
      });
      if (id) logged.push(id);
    };

    // 1) Golden-hours refresh for groups the owner opted into smart timing. The snap cache
    //    refreshes itself half-hourly anyway; what the manager adds is the RECORD — the
    //    owner sees the shift instead of wondering why posts moved.
    const smartGroups: Array<{ id: string; name: string }> = await q(
      `SELECT id, name FROM channels WHERE user_id = $1 AND smart_timing = true`, [userId],
    ).catch(() => []);
    for (const g of smartGroups) {
      const current = hotByGroup.find((h) => h.channel_id === g.id)?.verdict?.hours ?? null;
      const [last] = await q(
        `SELECT "after" FROM manager_actions
         WHERE user_id = $1 AND kind = 'golden_hours' AND target_id = $2
         ORDER BY created_at DESC LIMIT 1`, [userId, g.id],
      ).catch(() => []);
      let prev: number[] | null = null;
      try { prev = last?.after ? JSON.parse(last.after) : null; } catch { prev = null; }
      if (hoursChanged(prev, current)) {
        await act('golden_hours', g.id, g.name, prev ? JSON.stringify(prev) : null,
          current ? JSON.stringify(current) : null, null,
          'שעות הזהב חושבו מחדש מ-30 ימי קליקים', null).catch(() => {});
        // The scheduler's own snap cache refreshes itself within 30 minutes — the manager's
        // job here is the RECORD, so the owner sees the shift instead of wondering.
        lines.push(`⏰ ${g.name}: שעות הזהב עודכנו — ${prev?.length ? formatHours(prev) : 'טרם נלמדו'} ← ${current?.length ? formatHours(current) : 'אין מספיק דאטה'}`);
      }
    }

    // 2) posts_per_run ±1, never drifting more than ±1 from the OWNER's own value. The
    //    baseline rides the action log: the last row's baseline continues the chain, and a
    //    current value that doesn't match the last row's `after` means the owner changed it
    //    since — the baseline resets to THEIR value.
    for (const c of campaigns) {
      const [perf] = await q(
        `SELECT count(*)::int AS posts, coalesce(sum(clicks_count + pinterest_clicks), 0)::int AS clicks
         FROM posts WHERE campaign_id = $1 AND status = 'sent' AND sent_at > now() - interval '7 days'`,
        [c.id],
      ).catch(() => [null]);
      if (!perf) continue;
      const [lastAct] = await q(
        `SELECT "after", baseline FROM manager_actions
         WHERE kind = 'posts_per_run' AND target_id = $1
         ORDER BY created_at DESC LIMIT 1`, [c.id],
      ).catch(() => []);
      const current = Number(c.posts_per_run) || 1;
      const baseline = lastAct && Number(lastAct.after) === current
        ? Number(lastAct.baseline) || current
        : current;
      const delta = postsPerRunDelta(current, baseline,
        { posts7d: Number(perf.posts) || 0, clicks7d: Number(perf.clicks) || 0 });
      if (!delta) continue;
      await q(`UPDATE campaigns SET posts_per_run = $1 WHERE id = $2`, [delta.next, c.id]).catch(() => {});
      await act('posts_per_run', c.id, c.name, String(current), String(delta.next),
        String(baseline), delta.reason, null).catch(() => {});
      lines.push(`📈 [${c.name}] פוסטים לריצה: ${current} ← ${delta.next} (${delta.reason})`);
    }

    // 3) 24h pause for a COLLAPSED keyword — earned before, dead in the last 48h while the
    //    campaign as a whole still earns. One keyword per campaign per day, auto-expires.
    for (const c of campaigns) {
      const pulses: Array<{ keyword: string; before_clicks: number; recent_clicks: number; recent_posts: number }> = await q(
        `SELECT keyword,
                count(*) FILTER (WHERE sent_at > now() - interval '2 days')::int AS recent_posts,
                sum(CASE WHEN sent_at <= now() - interval '2 days' THEN clicks_count + pinterest_clicks ELSE 0 END)::int AS before_clicks,
                sum(CASE WHEN sent_at >  now() - interval '2 days' THEN clicks_count + pinterest_clicks ELSE 0 END)::int AS recent_clicks
         FROM posts
         WHERE campaign_id = $1 AND status = 'sent' AND keyword IS NOT NULL
           AND sent_at > now() - interval '9 days'
         GROUP BY keyword`, [c.id],
      ).catch(() => []);
      if (!pulses.length) continue;
      const campaignRecent = pulses.reduce((s, p) => s + (Number(p.recent_clicks) || 0), 0);
      const collapsed = collapsedKeywords(
        pulses.map((p) => ({
          keyword: String(p.keyword), clicksBefore: Number(p.before_clicks) || 0,
          clicksRecent: Number(p.recent_clicks) || 0, postsRecent: Number(p.recent_posts) || 0,
        })),
        campaignRecent,
      );
      for (const k of collapsed.slice(0, 1)) {
        const [already] = await q(
          `SELECT id FROM manager_actions
           WHERE kind = 'keyword_pause' AND target_id = $1 AND target_label = $2 AND until_at > now()`,
          [c.id, k.keyword],
        ).catch(() => []);
        if (already) continue;
        const until = new Date(Date.now() + 24 * 3600_000);
        await act('keyword_pause', c.id, k.keyword, null, null, null,
          `${k.clicksBefore} קליקים בשבוע שקדם, 0 ב-48 השעות האחרונות — הפסקה של 24 שעות`, until).catch(() => {});
        lines.push(`⏸️ [${c.name}] "${k.keyword}" בהפסקה של 24 שעות (${k.clicksBefore} קליקים קודם, 0 ב-48 שעות — מילים אחרות ממשיכות כרגיל)`);
      }
    }

    return lines;
  }

  /** Yesterday's numbers + golden hours + top product — the digest's raw material. */
  private async digestStats(userId: string) {
    const q = (sql: string, params: any[]) => this.campaigns.query(sql, params).catch(() => []);
    const [posts] = await q(
      `SELECT count(*)::int AS n FROM posts
       WHERE user_id = $1 AND status = 'sent' AND sent_at > now() - interval '1 day'`, [userId]);
    // link_clicks' timestamp column is clicked_at — there IS no created_at on that table.
    // These two queries filtered on created_at, Postgres errored, the best-effort catch
    // swallowed it, and the digest reported 0 clicks (and no golden hours) every single
    // morning while the posts screen — fed by posts.clicks_count — showed the truth.
    const [clicks] = await q(
      `SELECT count(*)::int AS n FROM link_clicks
       WHERE user_id = $1 AND clicked_at > now() - interval '1 day'`, [userId]);
    // Orders are counted on the ALIEXPRESS ACCOUNTING DAY that just closed, by the date the
    // ORDER carries — the exact rows the owner sees in the portal, so the two agree.
    //
    // It used to count `created_at > now() - interval '1 day'`: rows OUR SYNC inserted in
    // the last 24 hours. That is the sync's clock, not the shop's — an order placed
    // yesterday and first seen 25 hours ago fell out of the window, and one placed the day
    // before but discovered late fell in. The owner counted 4 orders in the portal against
    // a digest that said 3.
    const [day] = await q(`SELECT ((now() AT TIME ZONE 'Asia/Shanghai')::date - 1) AS d`, []);
    const portalDay: string | null = day?.d
      ? new Date(day.d).toISOString().slice(0, 10)
      : null;
    // order_date is a naive timestamp holding UTC, so it must be DECLARED as UTC before it
    // can be rendered on the portal's clock — one AT TIME ZONE would re-read it as local.
    const orderDayFilter = `((order_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date = $2::date`;
    const [rev] = portalDay ? await q(
      `SELECT count(*)::int AS orders, coalesce(sum(commission_ils), 0)::float AS ils
       FROM earnings
       WHERE user_id = $1 AND status <> 'cancelled' AND ${orderDayFilter}`, [userId, portalDay]) : [];
    // Of those, the ones the BONUS pools earned on: their keywords are the ones paying a
    // premium, so "how much of yesterday came from them" is the number that says whether
    // registering for the pools is doing anything.
    // Bonus membership is the PORTAL's verdict — an order it paid an incentive commission
    // on — not our guess from the keyword. AliExpress pays the bonus by product CATEGORY,
    // while the keyword is only the phrase the product was found through, so matching
    // keywords undercounted badly: an order with no attributed post carries no keyword at
    // all, and an attributed one counted only if our phrase happened to sit in the pool's
    // list. Rows synced before that figure was captured are NULL, and fall back to the old
    // keyword match so history does not read as zero.
    const [bonus] = portalDay ? await q(
      `SELECT count(*)::int AS orders,
              coalesce(sum(e.commission_ils), 0)::float AS ils,
              coalesce(sum(e.incentive_commission_usd), 0)::float AS bonus_usd
       FROM earnings e
       WHERE e.user_id = $1 AND e.status <> 'cancelled' AND ${orderDayFilter}
         AND (
           e.incentive_commission_usd > 0
           OR (e.incentive_commission_usd IS NULL AND lower(e.keyword) IN (
             SELECT lower(trim(k))
             FROM incentive_programs p, jsonb_array_elements_text(p.keywords_json::jsonb) AS k
             WHERE p.user_id = $1 AND p.active = true AND now() BETWEEN p.starts_at AND p.ends_at
           ))
         )`, [userId, portalDay]) : [];
    const [topProduct] = await q(
      `SELECT product_title, clicks_count FROM posts
       WHERE user_id = $1 AND sent_at > now() - interval '7 days' AND clicks_count > 0
       ORDER BY clicks_count DESC LIMIT 1`, [userId]);

    // A number with nothing to stand against says nothing: is 4 orders a good day? The
    // baseline is the DAILY AVERAGE of the preceding week (yesterday excluded, so a strong
    // day can't flatter its own comparison).
    const [base] = await q(
      `SELECT (count(*) FILTER (WHERE kind = 'post'))::float / 7  AS posts,
              (count(*) FILTER (WHERE kind = 'click'))::float / 7 AS clicks
       FROM (
         SELECT 'post'::text AS kind FROM posts
          WHERE user_id = $1 AND status = 'sent'
            AND sent_at BETWEEN now() - interval '8 days' AND now() - interval '1 day'
         UNION ALL
         SELECT 'click'::text FROM link_clicks
          WHERE user_id = $1
            AND clicked_at BETWEEN now() - interval '8 days' AND now() - interval '1 day'
       ) s`, [userId]);
    const [ordersBase] = portalDay ? await q(
      `SELECT count(*)::float / 7 AS orders, coalesce(sum(commission_ils), 0)::float / 7 AS ils
       FROM earnings
       WHERE user_id = $1 AND status <> 'cancelled'
         AND ((order_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date
             BETWEEN $2::date - 7 AND $2::date - 1`, [userId, portalDay]) : [];

    // Clicks that produced nothing: the shopper went to the page and walked away. Almost
    // always price or shipping, and the one signal here the owner can act on the same day.
    const frictionRows: any[] = await q(
      `SELECT p.product_title AS title,
              (p.clicks_count + coalesce(p.pinterest_clicks, 0))::int AS clicks,
              (SELECT count(*)::int FROM earnings e
                WHERE e.user_id = $1 AND e.product_id = p.product_id
                  AND e.status <> 'cancelled') AS orders
       FROM posts p
       WHERE p.user_id = $1 AND p.status = 'sent'
         AND p.sent_at > now() - ($2 || ' days')::interval
         AND (p.clicks_count + coalesce(p.pinterest_clicks, 0)) > 0
       ORDER BY clicks DESC LIMIT 40`, [userId, String(WINDOW_DAYS)]);

    // Posts vs clicks per GROUP — where the effort goes against where the attention is.
    const groupRows: any[] = await q(
      `SELECT coalesce(ch.name, 'ערוץ ברירת המחדל') AS name,
              count(*)::int                          AS posts,
              coalesce(sum(p.clicks_count + coalesce(p.pinterest_clicks, 0)), 0)::int AS clicks
       FROM posts p
       LEFT JOIN channels ch ON ch.channel_id = p.channel_override AND ch.user_id = $1
       WHERE p.user_id = $1 AND p.status = 'sent'
         AND p.sent_at > now() - ($2 || ' days')::interval
       GROUP BY 1`, [userId, String(WINDOW_DAYS)]);

    // Active campaigns that have published nothing for over a day — the one finding that
    // outranks every optimisation in the report.
    const silentRows: any[] = await q(
      `SELECT c.name FROM campaigns c
       WHERE c.user_id = $1 AND c.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM posts p
           WHERE p.campaign_id = c.id AND p.status = 'sent'
             AND p.sent_at > now() - interval '1 day')
         AND EXISTS (SELECT 1 FROM posts p2 WHERE p2.campaign_id = c.id AND p2.status = 'sent')`,
      [userId]);

    const [poolCount] = await q(
      `SELECT count(*)::int AS n FROM incentive_programs
       WHERE user_id = $1 AND active = true AND now() BETWEEN starts_at AND ends_at`, [userId]);

    // WHICH channel actually earns. Every order is attributed to the post that most likely
    // drove it (same product, published before the order, most-clicked wins), and that post
    // belongs to a campaign and a group — so the money can be traced back to where it was
    // published. This is the line that answers "is Pinterest producing anything, or only
    // the Telegram groups?", which no other figure in the report can say.
    //
    // Orders we could not attribute to any post are shown as their own row rather than
    // dropped: they are real income, and hiding them would make the shares add up to a
    // total that isn't the total.
    const bySourceRows: any[] = await q(
      `SELECT coalesce(c.name, ch.name, 'לא משויך לפוסט') AS src,
              count(*)::int                              AS orders,
              coalesce(sum(e.commission_ils), 0)::float  AS ils
       FROM earnings e
       LEFT JOIN posts p     ON p.id = e.post_id
       LEFT JOIN campaigns c ON c.id = p.campaign_id
       LEFT JOIN channels ch ON ch.channel_id = p.channel_override AND ch.user_id = $1
       WHERE e.user_id = $1 AND e.status <> 'cancelled'
         AND e.order_date > now() - ($2 || ' days')::interval
       GROUP BY 1 ORDER BY ils DESC, orders DESC`, [userId, String(SOURCE_WINDOW_DAYS)]);
    // The account's proven price band (what buyers actually pay) — the sales-profile
    // signal product selection now prefers; shown so the owner sees what steers it.
    const bandRows: any[] = await q(
      `SELECT order_amount_usd AS amt FROM earnings
       WHERE user_id = $1 AND order_amount_usd > 0
         AND order_date > now() - interval '90 days'
       LIMIT 3000`, [userId]);
    const priceBand = soldPriceBand(bandRows.map((r) => r.amt));
    // Raw top hours are polluted by NIGHT clicks (scrapers with browser-like user agents
    // that the bot filter can't catch, VPN/abroad readers) — the digest showed 03:00 as a
    // "golden hour" days running, which no follower of these groups produced. The ACTING
    // per-group logic already drops hours outside the send window; align the display line
    // with it: only hours inside the account's window are worth showing the owner.
    const hourRows: any[] = await q(
      `SELECT extract(hour from (clicked_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jerusalem')::int AS hour,
              count(*)::int AS n
       FROM link_clicks WHERE user_id = $1 AND clicked_at > now() - ($2 || ' days')::interval
       GROUP BY 1 ORDER BY n DESC`, [userId, String(WINDOW_DAYS)]);
    const [sched] = await q(
      `SELECT schedule_start_hour AS s, schedule_end_hour AS e FROM credentials WHERE user_id = $1`, [userId]);
    const winStart = Number.isInteger(Number(sched?.s)) ? Number(sched.s) : 9;
    const winEnd0 = Number.isInteger(Number(sched?.e)) ? Number(sched.e) : 22;
    const winEnd = winEnd0 === 0 ? 24 : winEnd0;
    // Top-3 by clicks, then CHRONOLOGICAL for display — the digest listed them in rank
    // order ("13:00, 16:00, 09:00"), which read as a broken sort, and without the counts
    // the owner had no way to see these are measured hours rather than a frozen default.
    const goldenHours = hourRows.filter((h) => (winStart < winEnd
      ? h.hour >= winStart && h.hour < winEnd
      : h.hour >= winStart || h.hour < winEnd0))
      .slice(0, 3)
      .sort((a, b) => a.hour - b.hour);
    return {
      posts_yesterday: Number(posts?.n) || 0,
      clicks_yesterday: Number(clicks?.n) || 0,
      orders_yesterday: Number(rev?.orders) || 0,
      revenue_yesterday_ils: +(Number(rev?.ils) || 0).toFixed(2),
      /** The AliExpress accounting day the order figures cover (YYYY-MM-DD). */
      portal_day: portalDay,
      bonus_orders: Number(bonus?.orders) || 0,
      bonus_revenue_ils: +(Number(bonus?.ils) || 0).toFixed(2),
      /** The bonus AliExpress actually paid on those orders — no longer an estimate. */
      bonus_paid_usd: +(Number(bonus?.bonus_usd) || 0).toFixed(2),
      /** Daily averages over the preceding week — what yesterday is measured against. */
      avg_posts: +(Number(base?.posts) || 0).toFixed(1),
      avg_clicks: +(Number(base?.clicks) || 0).toFixed(1),
      avg_orders: +(Number(ordersBase?.orders) || 0).toFixed(1),
      avg_revenue_ils: +(Number(ordersBase?.ils) || 0).toFixed(2),
      friction: frictionProducts(frictionRows.map((r) => ({
        title: String(r.title || ''),
        clicks: Number(r.clicks) || 0,
        orders: Number(r.orders) || 0,
      }))),
      groups: groupRows.map((r) => ({
        name: String(r.name),
        posts: Number(r.posts) || 0,
        clicks: Number(r.clicks) || 0,
      })),
      silent_campaigns: silentRows.map((r) => String(r.name)),
      has_bonus_pools: (Number(poolCount?.n) || 0) > 0,
      by_source: bySourceRows.map((r) => ({
        src: String(r.src),
        orders: Number(r.orders) || 0,
        ils: +(Number(r.ils) || 0).toFixed(2),
      })),
      top_product: topProduct?.product_title ? String(topProduct.product_title).slice(0, 60) : null,
      top_product_clicks: Number(topProduct?.clicks_count) || 0,
      golden_hours: goldenHours.map((h) => ({
        hour: `${String(h.hour).padStart(2, '0')}:00`,
        clicks: Number(h.n) || 0,
      })),
      price_band: priceBand,
    };
  }

  /**
   * How the copy ANGLES are performing account-wide — the "how we write" half of the loop.
   *
   * Reported whether or not a winner has emerged: seeing four angles at similar rates is
   * itself the finding, and it is what stops the owner reading an early front-runner as a
   * conclusion the numbers do not yet support.
   */
  private async copyAngleReport(userId: string): Promise<{ scored: VariantScore[]; winner: VariantScore | null }> {
    const rows: any[] = await this.campaigns.query(
      `SELECT copy_variant                          AS variant,
              count(*)::int                         AS posts,
              coalesce(sum(clicks_count + pinterest_clicks), 0)::int AS clicks
       FROM posts
       WHERE user_id = $1 AND status = 'sent' AND copy_variant IS NOT NULL
         AND sent_at > now() - ($2 || ' days')::interval
       GROUP BY copy_variant`,
      [userId, String(ORDER_LEARNING_WINDOW_DAYS)],
    ).catch(() => []);
    const stats: VariantStat[] = rows.map((r) => ({
      variant: String(r.variant),
      posts: Number(r.posts) || 0,
      clicks: Number(r.clicks) || 0,
    }));
    return { scored: scoreVariants(stats), winner: bestVariant(stats) };
  }

  /**
   * The week against the week before it — appended to Sunday's report.
   *
   * A daily report is a smoke alarm; it cannot show a trend, and a trend is what a decision
   * needs. Rather than a second delivery to ignore, the weekly comparison rides the report
   * the owner already opens, once a week.
   */
  private async weeklyReview(userId: string): Promise<string[]> {
    const q = (sql: string, params: any[]) => this.campaigns.query(sql, params).catch(() => []);
    const [wk] = await q(
      `SELECT
         (SELECT count(*)::int FROM posts
           WHERE user_id = $1 AND status = 'sent' AND sent_at > now() - interval '7 days')  AS posts,
         (SELECT count(*)::int FROM posts
           WHERE user_id = $1 AND status = 'sent'
             AND sent_at BETWEEN now() - interval '14 days' AND now() - interval '7 days')  AS posts_prev,
         (SELECT count(*)::int FROM link_clicks
           WHERE user_id = $1 AND clicked_at > now() - interval '7 days')                   AS clicks,
         (SELECT count(*)::int FROM link_clicks
           WHERE user_id = $1
             AND clicked_at BETWEEN now() - interval '14 days' AND now() - interval '7 days') AS clicks_prev,
         (SELECT count(*)::int FROM earnings
           WHERE user_id = $1 AND status <> 'cancelled' AND order_date > now() - interval '7 days') AS orders,
         (SELECT count(*)::int FROM earnings
           WHERE user_id = $1 AND status <> 'cancelled'
             AND order_date BETWEEN now() - interval '14 days' AND now() - interval '7 days') AS orders_prev,
         (SELECT coalesce(sum(commission_ils), 0)::float FROM earnings
           WHERE user_id = $1 AND status <> 'cancelled' AND order_date > now() - interval '7 days') AS ils,
         (SELECT coalesce(sum(commission_ils), 0)::float FROM earnings
           WHERE user_id = $1 AND status <> 'cancelled'
             AND order_date BETWEEN now() - interval '14 days' AND now() - interval '7 days') AS ils_prev`,
      [userId]);
    if (!wk) return [];

    const n = (v: any) => Number(v) || 0;
    const lines = [
      '',
      '📅 סיכום שבועי (7 ימים מול השבוע שלפניו):',
      `  • פוסטים: ${n(wk.posts)}${trendArrow(n(wk.posts), n(wk.posts_prev))} (${n(wk.posts_prev)} בשבוע שעבר)`,
      `  • קליקים: ${n(wk.clicks)}${trendArrow(n(wk.clicks), n(wk.clicks_prev))} (${n(wk.clicks_prev)})`,
      `  • הזמנות: ${n(wk.orders)}${trendArrow(n(wk.orders), n(wk.orders_prev))} (${n(wk.orders_prev)})`,
      `  • עמלות בסיס: ₪${n(wk.ils).toFixed(2)}${trendArrow(n(wk.ils), n(wk.ils_prev))} (₪${n(wk.ils_prev).toFixed(2)})`,
    ];

    // The week's best group and best keyword — where to put next week's effort.
    const [topGroup] = await q(
      `SELECT coalesce(ch.name, 'ערוץ ברירת המחדל') AS name,
              coalesce(sum(p.clicks_count + coalesce(p.pinterest_clicks, 0)), 0)::int AS clicks
       FROM posts p
       LEFT JOIN channels ch ON ch.channel_id = p.channel_override AND ch.user_id = $1
       WHERE p.user_id = $1 AND p.status = 'sent' AND p.sent_at > now() - interval '7 days'
       GROUP BY 1 ORDER BY clicks DESC LIMIT 1`, [userId]);
    if (topGroup?.name && n(topGroup.clicks) > 0) {
      lines.push(`  • הקבוצה המובילה: ${topGroup.name} (${n(topGroup.clicks)} קליקים)`);
    }
    const [topKw] = await q(
      `SELECT lower(keyword) AS kw, count(*)::int AS orders,
              coalesce(sum(commission_ils), 0)::float AS ils
       FROM earnings
       WHERE user_id = $1 AND status <> 'cancelled' AND keyword IS NOT NULL
         AND order_date > now() - interval '7 days'
       GROUP BY 1 ORDER BY ils DESC LIMIT 1`, [userId]);
    if (topKw?.kw) {
      lines.push(`  • מילת המפתח המכניסה: "${topKw.kw}" — ${n(topKw.orders)} הזמנות, ₪${n(topKw.ils).toFixed(2)}`);
    }
    return lines;
  }

  private buildDigest(
    stats: Awaited<ReturnType<OptimizerService['digestStats']>>,
    actions: CampaignActions[],
    soldCategories: CategoryScore[] = [],
    campaigns: Campaign[] = [],
    copyAngles: { scored: VariantScore[]; winner: VariantScore | null } = { scored: [], winner: null },
    hotByGroup: Array<{ channel_id: string; name: string; verdict: HotHoursResult | null }> = [],
  ): string {
    const lines: string[] = [];
    lines.push('🧠 דו"ח הבוקר של המנוע הלומד');
    lines.push('');

    // THE ACTION FIRST. A report read in fifteen seconds and acted on beats a complete one
    // that is skimmed: everything below is the evidence, this is the ask. Null on a quiet
    // day on purpose — an invented action teaches the owner to ignore the line.
    const action = pickTopAction({
      groups: stats.groups,
      friction: stats.friction,
      silentCampaigns: stats.silent_campaigns,
      orders: stats.orders_yesterday,
      bonusOrders: stats.bonus_orders,
      hasBonusPools: stats.has_bonus_pools,
      enoughSignal: !actions.some((a) => a.tooQuietToJudge),
    });
    if (action) {
      lines.push(`🎯 הפעולה של היום: ${action}`);
      lines.push('');
    }
    // "24 השעות האחרונות", not "אתמול": the window is rolling and now ends at the AliExpress
    // 10:00 close, so it covers the day that just shut rather than a calendar yesterday.
    // Two clocks, two lines. Posts and clicks are OUR activity on the owner's day; orders
    // belong to the AliExpress accounting day and are printed with that date, so the figure
    // can be held against the portal row by row instead of "roughly the same period".
    // Every figure carries its movement against the past week's daily average — "4 orders"
    // is meaningless until it is 4 against 2.
    lines.push(`📊 24 השעות האחרונות: ${stats.posts_yesterday} פוסטים${trendArrow(stats.posts_yesterday, stats.avg_posts)}`
      + ` · ${stats.clicks_yesterday} קליקים${trendArrow(stats.clicks_yesterday, stats.avg_clicks)}`);
    const dayLabel = stats.portal_day
      ? stats.portal_day.split('-').reverse().slice(0, 2).join('.')
      : null;
    lines.push(`💰 הזמנות${dayLabel ? ` ליום ${dayLabel}` : ''} (יום החשבונאות של אלי אקספרס): `
      + `${stats.orders_yesterday} הזמנות${trendArrow(stats.orders_yesterday, stats.avg_orders)}`
      + ` · ₪${stats.revenue_yesterday_ils} עמלות בסיס${trendArrow(stats.revenue_yesterday_ils, stats.avg_revenue_ils)}`);
    if (stats.avg_orders > 0) {
      lines.push(`   📐 ממוצע יומי בשבוע שקדם: ${stats.avg_orders} הזמנות · ₪${stats.avg_revenue_ils}`);
    }
    if (stats.bonus_orders > 0) {
      // With the figure from the portal this stops being "paid on top, somewhere" and
      // becomes the actual amount.
      const paid = stats.bonus_paid_usd > 0
        ? ` · בונוס ששולם: $${stats.bonus_paid_usd}`
        : ' — הבונוס עצמו משולם מעל זה';
      lines.push(`   🎁 מתוכן ${stats.bonus_orders} ממסלולי הבונוס (₪${stats.bonus_revenue_ils} עמלות בסיס)${paid}`);
    } else if (stats.orders_yesterday > 0) {
      lines.push('   🎁 אף הזמנה לא הגיעה ממילות מסלולי הבונוס');
    }
    if (stats.top_product) lines.push(`🏆 המוביל השבוע: ${stats.top_product} (${stats.top_product_clicks} קליקים)`);
    // Per-group golden hours (30 days) beat the account-wide line when we have them —
    // each group's audience has its own rhythm, and per-group is what the scheduler will
    // act on. The account-wide line stays as the fallback for thin data.
    const withVerdict = hotByGroup.filter((g) => g.verdict);
    if (withVerdict.length) {
      lines.push('⏰ שעות הזהב לפי קבוצה (30 יום):');
      for (const g of withVerdict) {
        const v = g.verdict!;
        lines.push(`  • ${g.name}: ${formatHours(v.hours)} — ${Math.round(v.share * 100)}% מ-${v.total} קליקים`);
      }
      for (const g of hotByGroup.filter((x) => !x.verdict)) {
        lines.push(`  • ${g.name}: עוד אין מספיק קליקים למסקנה`);
      }
    } else if (stats.golden_hours.length) {
      const parts = stats.golden_hours.map((g) => `${g.hour} (${g.clicks} קליקים)`);
      lines.push(`⏰ שעות הזהב שלך: ${parts.join(', ')} — לפי ${WINDOW_DAYS} הימים האחרונים`);
    }
    // Clicks that led nowhere. Named, because "improve conversion" is not an action and
    // "this product got 12 clicks and sold nothing" is.
    if (stats.friction.length) {
      lines.push(`🧲 קיבלו קליקים ולא נמכרו (${WINDOW_DAYS} יום) — בדוק מחיר/משלוח:`);
      for (const f of stats.friction) lines.push(`  • ${f.title} — ${f.clicks} קליקים, 0 הזמנות`);
    }
    // Where the money is actually made. Shown only with at least two sources — with one
    // there is no comparison to draw, and the line would be a restatement of the total.
    if (stats.by_source.length > 1) {
      const totalIls = stats.by_source.reduce((n, s) => n + s.ils, 0);
      lines.push(`📡 מאיפה הגיעו ההזמנות (${SOURCE_WINDOW_DAYS} יום):`);
      for (const s of stats.by_source) {
        const share = totalIls > 0 ? ` · ${Math.round((s.ils / totalIls) * 100)}%` : '';
        lines.push(`  • ${s.src} — ${s.orders} הזמנות · ₪${s.ils}${share}`);
      }
      lines.push('  ↳ לפי הפוסט שהוביל להזמנה (אותו מוצר, פורסם לפני ההזמנה) — שיוך משוער, לא נתון מהפורטל.');
    }
    if (stats.price_band) {
      lines.push(`💵 פרופיל הקנייה שלך: רוב ההזמנות בין $${stats.price_band.low} ל-$${stats.price_band.high} `
        + `(חציון $${stats.price_band.median}, ${stats.price_band.orders} הזמנות ב-90 יום) — בחירת המוצרים מעדיפה את הטווח הזה`);
    }
    if (actions.length) {
      lines.push('');
      lines.push('🔧 מה כיוונתי הלילה:');
      for (const a of actions) {
        if (a.boosted) lines.push(`  • [${a.campaign}] הכפלתי את "${a.boosted}" — היא מייצרת עמלות`);
        for (const kw of a.retired) lines.push(`  • [${a.campaign}] הוצאתי את "${kw}" — ${MIN_POSTS_TO_JUDGE}+ פוסטים בלי קליק אחד`);
        for (const kw of a.unboosted) lines.push(`  • [${a.campaign}] החזרתי את "${kw}" למינון רגיל — ההכנסות מהחלון האחרון התייבשו`);
        for (const l of a.learned) {
          const why = l.reason ? ` — ${l.reason}` : '';
          // "(3 orders)" beside a campaign name reads as "this campaign sold three" — it is
          // not: the category's record is account-wide, which is exactly why it is worth
          // giving to another group. Say whose numbers these are.
          lines.push(`  • [${a.campaign}] הוספתי "${l.keyword}" — הקטגוריה הזו הכניסה ₪${l.commissionIls} ב-${l.orders} הזמנות בכל החשבון${why}`);
        }
        // Saying what a group did NOT get is the point of the change: it shows the engine
        // considered the account's winners for this group and turned them down on purpose,
        // rather than never having looked.
        if (a.rejected.length) {
          lines.push(`  • [${a.campaign}] לא הוספתי: ${a.rejected.join(', ')} — לא מתאימות לקהל של הקבוצה`);
        }
        // Saying "I chose not to decide" beats quietly retiring good keywords on silence —
        // and printing the clicks actually measured turns "not enough data" into a distance
        // the owner can watch close, instead of a sentence that reads the same every day.
        if (a.tooQuietToJudge) {
          lines.push(`  • [${a.campaign}] לא הדחתי אף מילה — ${a.windowClicks} קליקים ב-${a.windowDays} ימים `
            + `(נדרשים ${MIN_CAMPAIGN_CLICKS_TO_JUDGE}), אין מספיק דאטה כדי לקבוע שמילה מתה`);
        }
        // "Nothing was added" and "adding is switched off" look identical in a report and
        // mean opposite things — one is a verdict, the other is a setting waiting for him.
        if (a.learningOff) {
          lines.push(`  • [${a.campaign}] לא הוספתי מילים — "למידה ממכירות" כבויה בטייס הזה (הפעל בעריכת הטייס כדי שאוסיף קטגוריות שמוכרות)`);
        }
        // A decision made on the account-wide fallback is a weaker claim than one made on
        // the group's own numbers, and the report should never blur the two.
        if (a.basis === 'account' && (a.retired.length || a.boosted || a.unboosted.length)) {
          lines.push(`  • [${a.campaign}] ההחלטות למעלה נשענו על ביצועי המילים בכל החשבון — לקבוצה הזו לבדה עוד אין מספיק קליקים`);
        }
      }
    } else {
      lines.push('');
      lines.push('🔧 הלילה לא נדרש כוונון — הרוטציה מאוזנת.');
    }

    // What the ORDERS say, always — including for campaigns that haven't opted in, so the
    // knowledge is never hidden behind a flag. Only acting on it is opt-in.
    if (soldCategories.length) {
      lines.push('');
      lines.push(`💰 הקטגוריות שבאמת נמכרו (${ORDER_LEARNING_WINDOW_DAYS} ימים):`);
      for (const c of soldCategories.slice(0, 5)) {
        lines.push(`  • ${c.keyword} — ₪${c.commissionIls} · ${c.orders} הזמנות`);
      }
      lines.push('  ↳ כל קטגוריה נבחנת מול הקהל של כל קבוצה בנפרד — לא כל קבוצה מקבלת את אותן מילים.');
    }

    // The "how we write" half of the loop.
    if (copyAngles.scored.length) {
      lines.push('');
      lines.push('✍️ סגנונות הכתיבה (קליקים לפוסט):');
      for (const s of copyAngles.scored) {
        const label = variantLabel(s.variant);
        lines.push(`  • ${label} — ${s.clicksPerPost} (${s.clicks} קליקים ב-${s.posts} פוסטים)`);
      }
      if (copyAngles.winner) {
        const label = variantLabel(copyAngles.winner.variant);
        lines.push(`  ↳ רוב הפוסטים נכתבים עכשיו בסגנון "${label}", וחלק קטן ממשיך לבדוק את השאר.`);
      } else {
        // Explicitly NOT a winner yet — so an early front-runner is not read as a verdict.
        lines.push(`  ↳ עוד אין מנצח מובהק — צריך ${MIN_CLICKS_TO_PICK_WINNER}+ קליקים ו-${MIN_POSTS_PER_VARIANT}+ פוסטים לסגנון. עד אז הכתיבה מתחלקת שווה בשווה.`);
      }
      const optedOut = campaigns.filter((c) => !c.learn_from_orders).map((c) => c.name);
      if (optedOut.length) {
        lines.push(`  ↳ לא מתווספות אוטומטית ל: ${optedOut.join(', ')} — הפעל "לימוד מהזמנות" בקמפיין כדי שכן.`);
      }
    }
    return lines.join('\n');
  }

  /** Telegram (the owner's watchdog chat, via the user's own bot) + email. Best-effort. */
  /**
   * Email is the digest's home for EVERY user — it's the one channel that is provably
   * theirs. Telegram is an extra, and only for the platform operator: the watchdog chat
   * is the owner's, so routing a customer's keyword and revenue report there would leak
   * their business data into someone else's inbox.
   */
  private async deliverDigest(
    userId: string, text: string, detail = '', runId: string | null = null,
  ): Promise<DeliveryOutcome> {
    const results: ChannelResult[] = [];
    const { email, isAdmin } = await this.credentials.userContact(userId).catch(
      () => ({ email: null as string | null, isAdmin: false }),
    );

    if (isAdmin) {
      try {
        const chatId = process.env.WATCHDOG_TELEGRAM_CHAT_ID;
        const creds = await this.credentials.getRaw(userId).catch(() => null);
        const token = process.env.WATCHDOG_TELEGRAM_BOT_TOKEN || creds?.telegram_bot_token;
        if (chatId && token) {
          await axios.post(`https://api.telegram.org/bot${token}/sendMessage`,
            { chat_id: chatId, text, reply_markup: { inline_keyboard: digestKeyboard(runId) } },
            { timeout: 10_000 });
          results.push({ channel: 'telegram', attempted: true, ok: true });
        }
      } catch (err: any) {
        this.logger.warn(`digest telegram failed: ${err?.message}`);
        results.push({ channel: 'telegram', attempted: true, ok: false, error: err?.message });
      }
    }

    try {
      if (email && this.mail.isConfigured()) {
        // Email has no buttons, so the evidence cannot hide behind one — it ships below a
        // rule instead. The brief still leads, so the mail opens the same way the chat does.
        const body = detail ? `${text}\n\n──────────\n\n${detail}` : text;
        await this.mail.sendHtml(email, '🧠 Nexlify — דו"ח הבוקר של המנוע הלומד',
          `<div dir="rtl" style="font-family:Arial,sans-serif;white-space:pre-line;padding:16px">${body}</div>`);
        results.push({ channel: 'email', attempted: true, ok: true });
      }
    } catch (err: any) {
      this.logger.warn(`digest email failed: ${err?.message}`);
      results.push({ channel: 'email', attempted: true, ok: false, error: err?.message });
    }
    return deliveryOutcome(results);
  }

  /**
   * Re-send a digest that was BUILT today but never arrived, without recomputing anything.
   *
   * Recomputing would re-apply the manager's actions (retiring keywords, pausing
   * campaigns) for a day they were already applied to. The text is already on the run row;
   * only the transport failed, so only the transport is repeated.
   */
  private async redeliverPending(userId: string): Promise<boolean> {
    const [row] = await this.runs.query(
      `SELECT id, summary_json FROM optimizer_runs
       WHERE user_id = $1 AND delivered_at IS NULL
         AND (created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jerusalem'
             >= date_trunc('day', (now() AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jerusalem')
       ORDER BY created_at DESC LIMIT 1`,
      [userId],
    ).catch(() => []);
    if (!row) return false;
    let digest = '';
    let detail = '';
    try {
      const parsed = JSON.parse(row.summary_json);
      digest = parsed?.digest || '';
      detail = parsed?.detail || '';
    } catch { digest = ''; }
    // A row from before the digest text was stored has nothing to re-send; let the normal
    // path rebuild it rather than delivering an empty report.
    if (!digest) return false;
    const outcome = await this.deliverDigest(userId, digest, detail, String(row.id));
    if (!outcome.delivered) {
      this.logger.warn(`digest re-delivery still failing for ${userId} — ${outcome.reason}`);
      return false;
    }
    await this.runs.update({ id: row.id }, { delivered_at: new Date() }).catch(() => {});
    this.logger.log(`digest re-delivered for ${userId} (built earlier today, transport had failed)`);
    return true;
  }
}
