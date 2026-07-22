import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import axios from 'axios';
import { Post } from '../posts/post.entity';
import { CredentialsService } from '../credentials/credentials.service';
import { cacheGet, cacheSet } from '../common/safe-cache';

const API = 'https://api.pinterest.com/v5';
/** Pinterest refreshes pin analytics roughly daily — 1h cache spares the rate limit. */
const CACHE_TTL_MS = 60 * 60 * 1000;

export interface PinAnalytics {
  post_id: string;
  pin_id: string;
  title: string;
  image: string;
  sent_at: Date | null;
  impressions: number;
  saves: number;
  pin_clicks: number;
  outbound_clicks: number;
}

export interface PinterestAnalyticsResult {
  available: boolean;
  /** Human-readable reason when unavailable (no token / API rejected). */
  reason?: string;
  totals: { impressions: number; saves: number; pin_clicks: number; outbound_clicks: number; pins: number } | null;
  pins: PinAnalytics[];
}

@Injectable()
export class PinterestService {
  private readonly logger = new Logger(PinterestService.name);

  constructor(
    @InjectRepository(Post) private readonly posts: Repository<Post>,
    private readonly credentials: CredentialsService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /**
   * Per-pin performance (last 30 days) for the user's published Pins, aggregated from
   * Pinterest's pin-analytics API. Reads the SAME pins the publisher created
   * (posts.pinterest_post_id). Degrades gracefully: no token / Trial-tier rejections
   * come back as { available: false, reason } instead of a 500 — the UI explains.
   */
  async analytics(userId: string): Promise<PinterestAnalyticsResult> {
    const creds = await this.credentials.getRaw(userId).catch(() => null);
    const token = creds?.pinterest_access_token;
    if (!token) {
      return { available: false, reason: 'לא הוגדר טוקן פינטרסט בהגדרות ← אינטגרציות.', totals: null, pins: [] };
    }

    const cacheKey = `pinterest_analytics_${userId}`;
    const cached = await cacheGet<PinterestAnalyticsResult>(this.cache, cacheKey);
    if (cached) return cached;

    const rows = await this.posts.find({
      where: { user_id: userId, pinterest_post_id: Not(IsNull()) },
      order: { sent_at: 'DESC' },
      take: 50,
    });
    if (!rows.length) {
      return { available: true, totals: { impressions: 0, saves: 0, pin_clicks: 0, outbound_clicks: 0, pins: 0 }, pins: [] };
    }

    const end = new Date();
    const start = new Date(end.getTime() - 30 * 86_400_000);
    const day = (d: Date) => d.toISOString().slice(0, 10);

    const pins: PinAnalytics[] = [];
    let authFailure: string | null = null;

    // Sequential on purpose: 50 calls in a burst trips Pinterest's per-second limit.
    for (const post of rows) {
      if (authFailure) break;
      try {
        const res = await axios.get(`${API}/pins/${post.pinterest_post_id}/analytics`, {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            start_date: day(start),
            end_date: day(end),
            metric_types: 'IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK',
          },
          timeout: 10_000,
          validateStatus: () => true,
        });
        if (res.status === 401 || res.status === 403) {
          // Token dead or the tier doesn't allow analytics — no point hammering 49 more pins.
          authFailure = res.data?.message || `Pinterest analytics rejected (${res.status})`;
          break;
        }
        const m = res.data?.all?.summary_metrics || {};
        pins.push({
          post_id: post.id,
          pin_id: post.pinterest_post_id,
          title: post.product_title || '',
          image: post.product_image || '',
          sent_at: post.sent_at || null,
          impressions: Number(m.IMPRESSION) || 0,
          saves: Number(m.SAVE) || 0,
          pin_clicks: Number(m.PIN_CLICK) || 0,
          outbound_clicks: Number(m.OUTBOUND_CLICK) || 0,
        });
      } catch (err: any) {
        this.logger.warn(`pin ${post.pinterest_post_id} analytics failed: ${err.message}`);
      }
    }

    if (authFailure && !pins.length) {
      return { available: false, reason: authFailure, totals: null, pins: [] };
    }

    const totals = pins.reduce(
      (t, p) => ({
        impressions: t.impressions + p.impressions,
        saves: t.saves + p.saves,
        pin_clicks: t.pin_clicks + p.pin_clicks,
        outbound_clicks: t.outbound_clicks + p.outbound_clicks,
        pins: t.pins + 1,
      }),
      { impressions: 0, saves: 0, pin_clicks: 0, outbound_clicks: 0, pins: 0 },
    );

    // Best-performing first — outbound clicks are the money metric (they hit the affiliate link).
    pins.sort((a, b) => b.outbound_clicks - a.outbound_clicks || b.impressions - a.impressions);

    const result: PinterestAnalyticsResult = { available: true, totals, pins };
    await cacheSet(this.cache, cacheKey, result, CACHE_TTL_MS);
    return result;
  }
}
