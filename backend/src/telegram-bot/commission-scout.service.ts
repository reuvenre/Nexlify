import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Not, Repository } from 'typeorm';
import { Campaign } from '../campaigns/campaign.entity';
import { Post } from '../posts/post.entity';
import { ProductsService, ScoutSource } from '../products/products.service';
import { PersistentValueStore } from '../common/persistent-value.store';
import {
  MAX_SCAN_PROMOS, SEEN_TTL_MS, ScoutCandidate, ScoutPick,
  minCommissionPct, picksPerReport, scanKeywords, selectPicks,
} from '../products/commission-scout';

/** AliExpress bans bursts over ~1 call a second; the scan stays under it. */
const CALL_GAP_MS = 1100;
/** What the account published this recently is not recommended again. */
const POSTED_WINDOW_MS = 30 * 86_400_000;

export interface ScoutReport {
  picks: ScoutPick[];
  qualified: number;
  scanned: number;
  minRate: number;
  errors: string[];
}

/**
 * Runs the commission scan (products/commission-scout.ts) for one account: AliExpress's
 * promotion lists for affiliates, then every active campaign's keywords in the regular and
 * the hot-products search. Products the account posted or was recommended in the last 30
 * days are left out; the recommended ones are remembered in persistent_values
 * (`commission_scout_seen:<user>`), so a deploy cannot make them come back.
 */
@Injectable()
export class CommissionScoutService {
  private readonly logger = new Logger(CommissionScoutService.name);

  constructor(
    @InjectRepository(Campaign) private readonly campaigns: Repository<Campaign>,
    @InjectRepository(Post) private readonly posts: Repository<Post>,
    private readonly products: ProductsService,
    private readonly memory: PersistentValueStore,
  ) {}

  async scan(userId: string): Promise<ScoutReport> {
    const minRate = minCommissionPct();
    const candidates: ScoutCandidate[] = [];
    const errors: string[] = [];
    let scanned = 0;

    const read = async (source: ScoutSource, page: number, foundBy: string, origin: 'niche' | 'promo') => {
      const res = await this.products.scoutProducts(userId, source, page);
      if (res.error) errors.push(`${foundBy}: ${res.error}`);
      scanned += res.data.length;
      for (const p of res.data) candidates.push({ ...p, found_by: foundBy, origin });
      await new Promise((r) => setTimeout(r, CALL_GAP_MS));
      return res.data.length;
    };

    // 1. AliExpress's own promotion lists, highest commission first.
    const promos = (await this.products.featuredPromoNames(userId)).slice(0, MAX_SCAN_PROMOS);
    for (const name of promos) {
      const got = await read({ kind: 'promo', name }, 1, name, 'promo');
      if (got >= 50) await read({ kind: 'promo', name }, 2, name, 'promo');
    }

    // 2. The owner's niche: every active campaign's keywords, regular and hot search.
    const active = await this.campaigns.find({ where: { user_id: userId, status: 'active' as any } })
      .catch(() => [] as Campaign[]);
    for (const kw of scanKeywords(active.map((c) => c.keywords || []))) {
      await read({ kind: 'search', keyword: kw }, 1, kw, 'niche');
      await read({ kind: 'hot', keyword: kw }, 1, kw, 'niche');
    }

    const exclude = await this.excluded(userId, candidates.map((c) => c.product_id));
    const { picks, qualified } = selectPicks(candidates, { minRate, exclude, max: picksPerReport() });
    this.logger.log(`commission scout ${userId}: ${scanned} scanned, ${qualified} ≥ ${minRate}%, ${picks.length} picked`);
    return { picks, qualified, scanned, minRate, errors };
  }

  /** Remember the picks the owner was actually shown, so they are not recommended again. */
  async markShown(userId: string, picks: ScoutPick[]): Promise<void> {
    if (!picks.length) return;
    const key = `commission_scout_seen:${userId}`;
    const now = Date.now();
    // Merge, never assign: an empty read must not wipe what is already remembered.
    const seen = { ...((await this.memory.load<Record<string, number>>(key)) || {}) };
    for (const id of Object.keys(seen)) if (now - seen[id] > SEEN_TTL_MS) delete seen[id];
    for (const p of picks) seen[p.product_id] = now;
    await this.memory.save(key, seen, SEEN_TTL_MS);
  }

  /** Recommended in the last 30 days, or posted by the account in the last 30 days (a failed post does not count). */
  private async excluded(userId: string, ids: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    const now = Date.now();
    const seen = (await this.memory.load<Record<string, number>>(`commission_scout_seen:${userId}`)) || {};
    for (const [id, at] of Object.entries(seen)) if (now - at <= SEEN_TTL_MS) out.add(id);
    const unique = [...new Set(ids)].filter(Boolean);
    for (let i = 0; i < unique.length; i += 500) {
      const rows = await this.posts.find({
        select: ['product_id'],
        where: {
          user_id: userId,
          product_id: In(unique.slice(i, i + 500)),
          status: Not('failed' as any),
          created_at: MoreThan(new Date(now - POSTED_WINDOW_MS)),
        },
      }).catch(() => [] as Post[]);
      for (const r of rows) if (r.product_id) out.add(String(r.product_id));
    }
    return out;
  }
}
