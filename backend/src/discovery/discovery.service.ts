import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, Not, IsNull } from 'typeorm';
import axios from 'axios';
import { CatalogProduct } from '../catalog/catalog-product.entity';
import { CredentialsService } from '../credentials/credentials.service';
import { RatesService } from '../rates/rates.service';
import { ProductsService } from '../products/products.service';

// Quality gate for discovered products. minOrders is matched against the Affiliate
// API's `lastest_volume` (RECENT sales), which is far smaller than the cumulative
// "sold" count shown on product pages — hence a modest threshold.
const FILTERS = { minRating: 4.4, minOrders: 30, maxResults: 20 };

export interface HuntResult {
  keyword_count: number;
  scraped: number;
  saved: number;
  skipped_existing: number;
}

export interface ValidateResult {
  checked: number;
  valid: number;
  invalid: number;
}

/**
 * Product discovery via the Apify AliExpress scraper (ported from NEXUS `hunter.js`)
 * plus an affiliate-link health checker (ported from NEXUS `validator.js`).
 *
 * Discovered products land in the user's catalog with status 'pending' so the
 * existing approve → queue → publish flow can take over.
 */
@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);

  constructor(
    @InjectRepository(CatalogProduct)
    private readonly catalog: Repository<CatalogProduct>,
    private readonly credentials: CredentialsService,
    private readonly rates: RatesService,
    private readonly products: ProductsService,
  ) {}

  // ── Hunter ─────────────────────────────────────────────────────────────────

  async hunt(userId: string, keywords: string[]): Promise<HuntResult> {
    const creds = await this.credentials.getRaw(userId);
    if (!creds?.aliexpress_app_key) throw new Error('AliExpress affiliate credentials not configured');

    const result: HuntResult = { keyword_count: keywords.length, scraped: 0, saved: 0, skipped_existing: 0 };
    const targetCcy = (creds.currency_pair || 'USD_ILS').split('_')[1] || 'ILS';

    // Existing product ids for this user (dedupe)
    const existing = new Set(
      (await this.catalog.find({ where: { user_id: userId }, select: ['product_id'] }))
        .map((p) => p.product_id),
    );

    for (const keyword of keywords) {
      try {
        // Source products straight from the AliExpress Affiliate API (free — no Apify).
        // Every result is affiliate-promotable, already priced in the target currency
        // (₪) with a working affiliate link, sorted best-sellers first.
        // Prefer hotproduct.query (the affiliate "hot products" feed — far more reliable
        // and rarely returns "result is empty"); fall back to product.query if needed.
        // strict: true → a transient API failure throws (caught below) instead of
        // returning mock data that would otherwise be persisted as real products.
        let items: any[] = (await this.products.getPromotional(userId, { keyword, limit: 50, strict: true })).data || [];
        if (items.length === 0) {
          items = (await this.products.search(userId, { keyword, limit: 50, sort: 'LAST_VOLUME_DESC', strict: true })).data || [];
        }
        // Defensive: never persist mock placeholders even if one slips through.
        items = items.filter((p) => !String(p.product_id ?? '').startsWith('mock-'));
        result.scraped += items.length;

        // hotproduct.query is already a curated best-sellers feed and doesn't always
        // populate rating/volume. So only drop items that EXPLICITLY report a rating
        // below the bar; keep everything else (don't lose products to missing fields).
        const filtered = items.filter((p) => !(p.rating > 0) || p.rating >= FILTERS.minRating);

        const fresh = filtered
          .filter((p) => !existing.has(String(p.product_id ?? '')))
          .slice(0, FILTERS.maxResults);

        result.skipped_existing += filtered.length - fresh.length;

        for (const p of fresh) {
          const pid = String(p.product_id ?? '');
          if (!pid) continue;
          const entity = this.catalog.create({
            user_id: userId,
            product_id: pid,
            title: p.title ?? 'Unknown',
            original_price: p.original_price ?? 0,
            sale_price: p.sale_price ?? 0,
            discount_percent: p.discount_percent ?? 0,
            currency: p.currency ?? targetCcy,
            image_url: p.image_url ?? '',
            product_url: p.product_url ?? '',
            affiliate_url: p.affiliate_url ?? p.product_url ?? '',
            keyword,
            orders_count: p.orders_count ?? 0,
            rating: p.rating ?? 0,
            status: 'pending',
            supplier: 'AliExpress',
          });
          await this.catalog.save(entity);
          existing.add(pid);
          result.saved++;
        }
      } catch (err: any) {
        this.logger.error(`[Discovery] keyword "${keyword}" failed: ${err.message}`);
      }
    }

    return result;
  }

  // ── Link validator ─────────────────────────────────────────────────────────

  async validateLinks(userId: string): Promise<ValidateResult> {
    const products = await this.catalog.find({
      where: { user_id: userId, affiliate_url: Not(IsNull()) },
      take: 200,
    });

    const result: ValidateResult = { checked: 0, valid: 0, invalid: 0 };
    const updates: { id: string; ok: boolean }[] = [];

    // Process in small batches instead of firing all ~200 requests at once — a burst of
    // concurrent sockets can exhaust memory on a 512MB host and trip AliExpress rate limits.
    const BATCH = 10;
    const toCheck = products.filter((p) => p.affiliate_url);
    for (let i = 0; i < toCheck.length; i += BATCH) {
      const slice = toCheck.slice(i, i + BATCH);
      await Promise.all(
        slice.map(async (p) => {
          result.checked++;
          const ok = await this.isLinkAlive(p.affiliate_url!);
          ok ? result.valid++ : result.invalid++;
          updates.push({ id: p.id, ok });
        }),
      );
    }

    if (updates.length) {
      const valid = updates.filter((u) => u.ok).map((u) => u.id);
      const invalid = updates.filter((u) => !u.ok).map((u) => u.id);
      if (valid.length) await this.catalog.update({ id: In(valid) }, { link_validated: true });
      if (invalid.length) await this.catalog.update({ id: In(invalid) }, { link_validated: false });
    }

    return result;
  }

  private async isLinkAlive(url: string): Promise<boolean> {
    try {
      const res = await axios.head(url, { timeout: 8000, maxRedirects: 5, validateStatus: () => true });
      // 2xx/3xx = reachable. Many AliExpress links answer 200 even for redirects.
      return res.status < 400;
    } catch {
      // Some hosts reject HEAD — retry with a lightweight GET before giving up.
      try {
        const res = await axios.get(url, { timeout: 8000, maxRedirects: 5, validateStatus: () => true });
        return res.status < 400;
      } catch {
        return false;
      }
    }
  }
}
