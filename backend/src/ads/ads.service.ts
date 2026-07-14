import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import axios from 'axios';
import { AdBoost } from './ad-boost.entity';
import { Post } from '../posts/post.entity';
import { CredentialsService, DecryptedCredentials } from '../credentials/credentials.service';
import { RatesService } from '../rates/rates.service';
import { EarningsService } from '../earnings/earnings.service';

const GRAPH = 'https://graph.facebook.com/v19.0';

export interface PerformanceResult {
  evaluated: number;
  boosted: number;
  skipped: number;
  details: { title: string; clicks: number; roas: number; revenue_usd: number; status: string }[];
}

/**
 * Meta Ads auto-boost engine (ported from Nexlify `performance.js`).
 *
 * Walks every published post that has a Facebook post id, reads its Graph
 * Insights, computes ROAS, and — when the user's threshold is cleared — creates
 * an ad creative from the post and records an AdBoost row. Budget caps come from
 * the user's credential settings.
 */
@Injectable()
export class AdsService {
  private readonly logger = new Logger(AdsService.name);

  constructor(
    @InjectRepository(AdBoost)
    private readonly boosts: Repository<AdBoost>,
    @InjectRepository(Post)
    private readonly posts: Repository<Post>,
    private readonly credentials: CredentialsService,
    private readonly rates: RatesService,
    private readonly earnings: EarningsService,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────

  async list(userId: string): Promise<AdBoost[]> {
    return this.boosts.find({ where: { user_id: userId }, order: { created_at: 'DESC' }, take: 100 });
  }

  async summary(userId: string) {
    const rows = await this.boosts.find({ where: { user_id: userId } });
    const boosted = rows.filter((r) => r.status === 'boosted');
    const totalSpend = boosted.reduce((s, r) => s + (r.ad_spend || 0), 0);
    const totalRevenue = boosted.reduce((s, r) => s + (r.revenue_usd || 0), 0);
    const totalClicks = rows.reduce((s, r) => s + (r.clicks || 0), 0);
    const publishedCount = await this.posts.count({
      where: { user_id: userId, facebook_post_id: Not(IsNull()) },
    });
    return {
      boosted: boosted.length,
      published: publishedCount,
      total_clicks: totalClicks,
      total_ad_spend: +totalSpend.toFixed(2),
      total_revenue: +totalRevenue.toFixed(2),
      // Real blended ROAS: revenue / spend across delivered ads. 0 while nothing spent.
      avg_roas: totalSpend > 0 ? +(totalRevenue / totalSpend).toFixed(2) : 0,
    };
  }

  /** Evaluate performance and boost qualifying posts for one user. */
  async runPerformance(userId: string): Promise<PerformanceResult> {
    const creds = await this.credentials.getRaw(userId);
    const result: PerformanceResult = { evaluated: 0, boosted: 0, skipped: 0, details: [] };

    if (!creds?.facebook_page_token) {
      this.logger.warn(`[Ads] user ${userId} has no Facebook token — skipping`);
      return result;
    }

    const hardLimitUsd = creds.boost_hard_limit_usd ?? 200;
    const rate = await this.rates.getRate(creds.currency_pair || 'USD_ILS');
    const dailyBudgetUsd = Math.max(1, Math.round((creds.boost_daily_budget ?? 50) / rate));
    // The bar a post must clear organically before we put money behind it: real
    // commissions AliExpress reported for that product since the post went out.
    const minRevenueUsd = creds.boost_min_revenue_usd ?? 5;

    // Refresh live boosts with REAL spend + revenue first, so the dashboard reflects
    // what actually happened before we decide anything new.
    await this.refreshBoostedRoas(userId, creds).catch((e) =>
      this.logger.warn(`[Ads] ROAS refresh failed for ${userId}: ${e.message}`));

    // Published posts on Facebook that we haven't boosted yet
    const published = await this.posts.find({
      where: { user_id: userId, facebook_post_id: Not(IsNull()), status: 'sent' },
      order: { sent_at: 'DESC' },
      take: 50,
    });

    const alreadyBoosted = new Set(
      (await this.boosts.find({ where: { user_id: userId, status: 'boosted' } }))
        .map((b) => b.facebook_post_id),
    );

    for (const post of published) {
      if (alreadyBoosted.has(post.facebook_post_id)) continue;
      result.evaluated++;

      const insights = await this.getPostInsights(post.facebook_post_id, creds.facebook_page_token);
      const clicks = insights?.post_clicks ?? 0;
      const impressions = insights?.post_impressions ?? 0;
      // REAL organic earnings for this product since the post went out. This — not a
      // stand-in — is the proof that the post is worth spending money on. ROAS itself is
      // meaningless here: nothing has been spent yet, so there is nothing to divide by.
      const organicRevenue = await this.earnings
        .revenueForProduct(userId, post.product_id, post.sent_at)
        .catch(() => 0);

      const boost = this.boosts.create({
        user_id: userId,
        post_id: post.id,
        facebook_post_id: post.facebook_post_id,
        product_title: post.product_title,
        clicks,
        impressions,
        revenue_usd: organicRevenue,
        roas: 0, // no spend yet → no ROAS. Filled in by refreshBoostedRoas once it runs.
        daily_budget: creds.boost_daily_budget ?? 50,
      });

      if (organicRevenue >= minRevenueUsd) {
        try {
          const ids = await this.createBoostAd(post, creds, dailyBudgetUsd, hardLimitUsd);
          boost.status = 'boosted';
          boost.campaign_id = ids.campaign_id;
          boost.adset_id = ids.adset_id;
          boost.creative_id = ids.creative_id;
          boost.ad_id = ids.ad_id;
          boost.ad_spend = 0;
          boost.note = `Boosted (PAUSED) — $${dailyBudgetUsd}/day, account cap $${hardLimitUsd}. Activate in Ads Manager.`;
          result.boosted++;
        } catch (err: any) {
          boost.status = 'failed';
          boost.note = err?.response?.data?.error?.message || err.message;
        }
      } else {
        boost.status = 'skipped';
        boost.note = `עמלות אורגניות $${organicRevenue.toFixed(2)} < סף $${minRevenueUsd}`;
        result.skipped++;
      }

      await this.boosts.save(boost);
      result.details.push({
        title: post.product_title, clicks, roas: boost.roas,
        revenue_usd: organicRevenue, status: boost.status,
      });
    }

    return result;
  }

  /** Runs performance evaluation for every user who has boost_enabled. */
  async runAllEnabled(): Promise<void> {
    const sets = await this.credentials.getAllBoostEnabled();
    for (const cred of sets) {
      try {
        await this.runPerformance(cred.user_id);
      } catch (err: any) {
        this.logger.error(`[Ads] boost run failed for user ${cred.user_id}: ${err.message}`);
      }
    }
  }

  // ── Graph API helpers ─────────────────────────────────────────────────────

  private async getPostInsights(postId: string, token: string): Promise<{ post_clicks: number; post_impressions: number } | null> {
    try {
      const res = await axios.get(
        `${GRAPH}/${postId}/insights`,
        {
          params: {
            metric: 'post_impressions,post_clicks,post_reactions_by_type_total',
            access_token: token,
          },
          timeout: 10_000,
        },
      );
      if (res.data?.error) return null;
      const metrics: Record<string, number> = {};
      (res.data?.data || []).forEach((m: any) => { metrics[m.name] = m.values?.[0]?.value ?? 0; });
      return { post_clicks: metrics.post_clicks || 0, post_impressions: metrics.post_impressions || 0 };
    } catch {
      return null;
    }
  }

  /**
   * Boost an organic Facebook post into a real (but PAUSED) Meta ad.
   *
   * Builds the full Campaign → AdSet → Creative → Ad chain. Everything is created
   * PAUSED and the campaign carries a lifetime `spend_cap`, so no money moves until
   * the user activates it in Ads Manager — a safe, reversible default.
   */
  private async createBoostAd(
    post: Post, creds: DecryptedCredentials, dailyBudgetUsd: number, hardLimitUsd: number,
  ): Promise<{ campaign_id: string; adset_id: string; creative_id: string; ad_id: string }> {
    const token = creds.facebook_page_token;
    const raw = creds.meta_ad_account_id;
    if (!raw) throw new Error('Missing Meta Ad Account ID');
    const adAccount = raw.startsWith('act_') ? raw : `act_${raw}`;
    const label = (post.product_title || 'product').slice(0, 30);

    // 1. Campaign — traffic objective, lifetime spend cap = hard limit.
    const campaign_id = await this.graphPost(`${adAccount}/campaigns`, {
      name: `Nexlify — ${label}`,
      objective: 'OUTCOME_TRAFFIC',
      status: 'PAUSED',
      special_ad_categories: '[]',
      spend_cap: String(Math.round(hardLimitUsd * 100)),
      access_token: token,
    });

    // 2. AdSet — daily budget, optimize for link clicks, geo per user setting.
    const countries = (creds.boost_target_countries || 'IL')
      .split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
    const adset_id = await this.graphPost(`${adAccount}/adsets`, {
      name: `Nexlify AdSet — ${label}`,
      campaign_id,
      daily_budget: String(Math.round(dailyBudgetUsd * 100)),
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'LINK_CLICKS',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      targeting: JSON.stringify({ geo_locations: { countries: countries.length ? countries : ['IL'] } }),
      status: 'PAUSED',
      access_token: token,
    });

    // 3. Creative — reuse the existing organic post.
    const creative_id = await this.graphPost(`${adAccount}/adcreatives`, {
      name: `Nexlify Creative — ${label}`,
      object_story_id: post.facebook_post_id,
      access_token: token,
    });

    // 4. Ad — ties the creative to the adset.
    const ad_id = await this.graphPost(`${adAccount}/ads`, {
      name: `Nexlify Ad — ${label}`,
      adset_id,
      creative: JSON.stringify({ creative_id }),
      status: 'PAUSED',
      access_token: token,
    });

    return { campaign_id, adset_id, creative_id, ad_id };
  }

  /** POST form-encoded params to a Graph endpoint, returning the created object id. */
  private async graphPost(path: string, params: Record<string, string>): Promise<string> {
    const res = await axios.post(
      `${GRAPH}/${path}`,
      new URLSearchParams(params).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15_000 },
    );
    if (res.data?.error) throw new Error(res.data.error.message);
    if (!res.data?.id) throw new Error(`Graph ${path} returned no id`);
    return res.data.id;
  }

  // ── ROAS ──────────────────────────────────────────────────────────────────

  /**
   * REAL ad spend for a boost, straight from Meta Insights on the campaign we created.
   * Returns null when the campaign has no delivery yet (a paused ad has never spent),
   * which the caller must treat as "no ROAS yet" rather than as zero spend.
   */
  private async getCampaignSpend(
    campaignId: string,
    token: string,
  ): Promise<{ spend: number; clicks: number; impressions: number } | null> {
    try {
      const res = await axios.get(`${GRAPH}/${campaignId}/insights`, {
        params: { fields: 'spend,clicks,impressions', date_preset: 'maximum', access_token: token },
        timeout: 10_000,
      });
      if (res.data?.error) return null;
      const row = res.data?.data?.[0];
      if (!row) return null; // never delivered → no spend row at all
      return {
        spend: parseFloat(row.spend) || 0,
        clicks: parseInt(row.clicks, 10) || 0,
        impressions: parseInt(row.impressions, 10) || 0,
      };
    } catch {
      return null;
    }
  }

  /**
   * Refresh every boosted ad with REAL numbers: spend from Meta, revenue from the
   * commissions AliExpress reported for that product since the boost started, and
   * ROAS = revenue / spend. Runs before new boost decisions so the dashboard shows
   * what actually happened rather than an estimate.
   *
   * ROAS stays 0 while spend is 0 — a paused or undelivered ad has no return to measure,
   * and dividing by zero would manufacture a number that means nothing.
   */
  private async refreshBoostedRoas(userId: string, creds: DecryptedCredentials): Promise<void> {
    const token = creds.facebook_page_token;
    if (!token) return;
    const live = await this.boosts.find({ where: { user_id: userId, status: 'boosted' } });
    for (const boost of live) {
      if (!boost.campaign_id) continue;
      const stats = await this.getCampaignSpend(boost.campaign_id, token);
      if (!stats) continue;
      const post = boost.post_id
        ? await this.posts.findOne({ where: { id: boost.post_id, user_id: userId } })
        : null;
      const revenue = post?.product_id
        ? await this.earnings.revenueForProduct(userId, post.product_id, boost.created_at)
        : 0;

      boost.ad_spend = +stats.spend.toFixed(2);
      boost.clicks = stats.clicks || boost.clicks;
      boost.impressions = stats.impressions || boost.impressions;
      boost.revenue_usd = revenue;
      boost.roas = stats.spend > 0 ? +(revenue / stats.spend).toFixed(2) : 0;
      await this.boosts.save(boost);
    }
  }
}
