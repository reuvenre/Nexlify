import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, Not, IsNull } from 'typeorm';
import axios from 'axios';
import { CatalogProduct } from '../catalog/catalog-product.entity';
import { CredentialsService } from '../credentials/credentials.service';
import { RatesService } from '../rates/rates.service';

const APIFY_ACTOR = 'devcake~aliexpress-products-scraper';

const FILTERS = { minRating: 4.5, minOrders: 500, maxResults: 20 };

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
  ) {}

  // ── Hunter ─────────────────────────────────────────────────────────────────

  async hunt(userId: string, keywords: string[]): Promise<HuntResult> {
    const creds = await this.credentials.getRaw(userId);
    if (!creds?.apify_api_token) throw new Error('Apify API token not configured');

    const result: HuntResult = { keyword_count: keywords.length, scraped: 0, saved: 0, skipped_existing: 0 };
    const rate = await this.rates.getRate(creds.currency_pair || 'USD_ILS');

    // Existing product ids for this user (dedupe)
    const existing = new Set(
      (await this.catalog.find({ where: { user_id: userId }, select: ['product_id'] }))
        .map((p) => p.product_id),
    );

    for (const keyword of keywords) {
      try {
        const raw = await this.runApifyScraper(keyword, creds.apify_api_token);
        result.scraped += raw.length;

        const filtered = raw.filter((p) => {
          const rating = parseFloat(p.ratingValue ?? '0');
          const orders = this.parseSoldCount(p);
          return rating >= FILTERS.minRating && orders >= FILTERS.minOrders;
        });

        const fresh = filtered
          .filter((p) => !existing.has(String(p.productId ?? '')))
          .slice(0, FILTERS.maxResults);

        result.skipped_existing += filtered.length - fresh.length;

        for (const p of fresh) {
          const pid = String(p.productId ?? '');
          if (!pid) continue;
          const priceUsd = parseFloat(p.priceCurrentMin ?? p.price ?? '0') || 0;
          const entity = this.catalog.create({
            user_id: userId,
            product_id: pid,
            title: p.title ?? p.name ?? 'Unknown',
            original_price: priceUsd,
            sale_price: +(priceUsd * rate).toFixed(2),
            currency: (creds.currency_pair || 'USD_ILS').split('_')[1] || 'ILS',
            image_url: p.imageUrl ?? p.image ?? '',
            product_url: p.productUrl ?? p.url ?? '',
            affiliate_url: p.productUrl ?? p.url ?? '',
            keyword,
            orders_count: this.parseSoldCount(p),
            rating: parseFloat(p.ratingValue ?? '0') || 0,
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

  private async runApifyScraper(keyword: string, token: string): Promise<any[]> {
    // Start a run
    const runRes = await axios.post(
      `https://api.apify.com/v2/acts/${APIFY_ACTOR}/runs?token=${token}`,
      { searchQueries: [keyword], maxItems: 50 },
      { headers: { 'Content-Type': 'application/json' }, timeout: 20_000 },
    );
    const run = runRes.data?.data;
    if (!run?.id) throw new Error('Apify did not return a run id');

    // Poll until finished (max ~3 minutes)
    for (let i = 0; i < 36; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const statusRes = await axios.get(`https://api.apify.com/v2/actor-runs/${run.id}?token=${token}`, { timeout: 10_000 });
      const status = statusRes.data?.data?.status;
      if (status === 'SUCCEEDED') break;
      if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
        throw new Error(`Apify run ${status}`);
      }
    }

    const dataRes = await axios.get(
      `https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?token=${token}&clean=true`,
      { timeout: 20_000 },
    );
    return Array.isArray(dataRes.data) ? dataRes.data : [];
  }

  private parseSoldCount(p: any): number {
    const desc = p.soldDescription ?? '';
    const match = String(desc).match(/([\d,]+)\+?\s*sold/i);
    if (match) return parseInt(match[1].replace(/,/g, ''), 10);
    return parseInt(p.soldCount ?? '0', 10) || 0;
  }

  // ── Link validator ─────────────────────────────────────────────────────────

  async validateLinks(userId: string): Promise<ValidateResult> {
    const products = await this.catalog.find({
      where: { user_id: userId, affiliate_url: Not(IsNull()) },
      take: 200,
    });

    const result: ValidateResult = { checked: 0, valid: 0, invalid: 0 };
    const updates: { id: string; ok: boolean }[] = [];

    await Promise.all(
      products.map(async (p) => {
        if (!p.affiliate_url) return;
        result.checked++;
        const ok = await this.isLinkAlive(p.affiliate_url);
        ok ? result.valid++ : result.invalid++;
        updates.push({ id: p.id, ok });
      }),
    );

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
