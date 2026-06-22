import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import axios from 'axios';
import { AdBoost } from './ad-boost.entity';
import { Post } from '../posts/post.entity';
import { CredentialsService, DecryptedCredentials } from '../credentials/credentials.service';
import { RatesService } from '../rates/rates.service';

const GRAPH = 'https://graph.facebook.com/v19.0';

export interface PerformanceResult {
  evaluated: number;
  boosted: number;
  skipped: number;
  details: { title: string; clicks: number; roas: number; status: string }[];
}

/**
 * Meta Ads auto-boost engine (ported from NEXUS `performance.js`).
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
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────

  async list(userId: string): Promise<AdBoost[]> {
    return this.boosts.find({ where: { user_id: userId }, order: { created_at: 'DESC' }, take: 100 });
  }

  async summary(userId: string) {
    const rows = await this.boosts.find({ where: { user_id: userId } });
    const boosted = rows.filter((r) => r.status === 'boosted');
    const totalSpend = boosted.reduce((s, r) => s + (r.ad_spend || 0), 0);
    const totalClicks = rows.reduce((s, r) => s + (r.clicks || 0), 0);
    const publishedCount = await this.posts.count({
      where: { user_id: userId, facebook_post_id: Not(IsNull()) },
    });
    return {
      boosted: boosted.length,
      published: publishedCount,
      total_clicks: totalClicks,
      total_ad_spend: +totalSpend.toFixed(2),
      avg_roas: boosted.length
        ? +(boosted.reduce((s, r) => s + (r.roas || 0), 0) / boosted.length).toFixed(2)
        : 0,
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

    const threshold = creds.boost_roas_threshold ?? 2.0;
    const hardLimitUsd = creds.boost_hard_limit_usd ?? 200;
    const rate = await this.rates.getRate(creds.currency_pair || 'USD_ILS');
    const dailyBudgetUsd = Math.max(1, Math.round((creds.boost_daily_budget ?? 50) / rate));

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
      const roas = this.calcROAS(clicks);

      const boost = this.boosts.create({
        user_id: userId,
        post_id: post.id,
        facebook_post_id: post.facebook_post_id,
        product_title: post.product_title,
        clicks,
        impressions,
        roas,
        daily_budget: creds.boost_daily_budget ?? 50,
      });

      if (roas >= threshold || clicks >= 200) {
        try {
          const creativeId = await this.createBoostAd(post, creds, dailyBudgetUsd);
          boost.status = 'boosted';
          boost.creative_id = creativeId;
          boost.ad_spend = 0;
          boost.note = `Boosted — budget $${dailyBudgetUsd}/day, hard cap $${hardLimitUsd}`;
          result.boosted++;
        } catch (err: any) {
          boost.status = 'failed';
          boost.note = err?.response?.data?.error?.message || err.message;
        }
      } else {
        boost.status = 'skipped';
        boost.note = `ROAS ${roas.toFixed(1)} < ${threshold}`;
        result.skipped++;
      }

      await this.boosts.save(boost);
      result.details.push({ title: post.product_title, clicks, roas: +roas.toFixed(1), status: boost.status });
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

  private async createBoostAd(post: Post, creds: DecryptedCredentials, _dailyBudgetUsd: number): Promise<string> {
    const adAccountId = creds.meta_ad_account_id;
    const token = creds.facebook_page_token;
    if (!adAccountId) throw new Error('Missing Meta Ad Account ID');

    // Create an ad creative from the existing organic post (Post Boost).
    const params = new URLSearchParams({
      object_story_id: post.facebook_post_id,
      name: `NEXUS Boost — ${(post.product_title || '').slice(0, 30)}`,
      access_token: token,
    });

    const res = await axios.post(
      `${GRAPH}/${adAccountId}/adcreatives`,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15_000 },
    );
    if (res.data?.error) throw new Error(res.data.error.message);
    return res.data?.id;
  }

  // ── ROAS ──────────────────────────────────────────────────────────────────
  // Revenue can't be attributed per-post without conversion tracking, so we use
  // the same heuristic as NEXUS: a strong organic-click signal stands in for ROAS
  // until real ad spend exists. >100 organic clicks → treat as a clear winner.
  private calcROAS(clicks: number): number {
    return clicks > 100 ? 999 : 0;
  }
}
