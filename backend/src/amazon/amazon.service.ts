import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { CredentialsService } from '../credentials/credentials.service';
import { PostsService, CampaignRunResult } from '../posts/posts.service';
import { Campaign } from '../campaigns/campaign.entity';
import { signAmazonPaapi, AMAZON_MARKETPLACES } from '../common/amazon-sign';

/** A normalized Amazon product (from PA-API SearchItems). */
export interface AmazonProduct {
  asin: string;
  title: string;
  image: string;
  /** The affiliate link — DetailPageURL already carries the PartnerTag. */
  affiliate_url: string;
  price_usd: number;
  original_usd: number;
}

const DEFAULT_MARKETPLACE = 'www.amazon.com';
const SEARCH_TARGET = 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems';
const SEARCH_PATH = '/paapi5/searchitems';

@Injectable()
export class AmazonService {
  private readonly logger = new Logger(AmazonService.name);

  constructor(
    private readonly credentials: CredentialsService,
    private readonly posts: PostsService,
    @InjectRepository(Campaign) private readonly campaignRepo: Repository<Campaign>,
  ) {}

  private endpoint(marketplace?: string) {
    const mp = marketplace && AMAZON_MARKETPLACES[marketplace] ? marketplace : DEFAULT_MARKETPLACE;
    return { marketplace: mp, ...AMAZON_MARKETPLACES[mp] };
  }

  /**
   * PA-API SearchItems. Returns normalized products (empty when none match). Throws a
   * BadRequestException with the API's message on an auth/permission/throttle error so the
   * caller (test button / campaign) can surface exactly what Amazon rejected.
   */
  async searchItems(
    userId: string,
    keyword: string,
    opts?: { itemCount?: number; minPrice?: number; maxPrice?: number; marketplace?: string },
  ): Promise<AmazonProduct[]> {
    const creds = await this.credentials.getAmazon(userId);
    if (!creds) {
      throw new BadRequestException('חסרים פרטי Amazon (Access Key / Secret / Partner Tag) — הגדר אותם בהגדרות ← אינטגרציות');
    }
    const { marketplace, host, region } = this.endpoint(opts?.marketplace);

    const body: Record<string, any> = {
      Keywords: keyword,
      SearchIndex: 'All',
      ItemCount: Math.max(1, Math.min(10, opts?.itemCount ?? 10)),
      PartnerTag: creds.partnerTag,
      PartnerType: 'Associates',
      Marketplace: marketplace,
      Resources: [
        'Images.Primary.Large',
        'ItemInfo.Title',
        'Offers.Listings.Price',
        'Offers.Listings.SavingBasis',
      ],
    };
    // PA-API price filters are in the marketplace's lowest currency unit (cents).
    if (opts?.minPrice && opts.minPrice > 0) body.MinPrice = Math.round(opts.minPrice * 100);
    if (opts?.maxPrice && opts.maxPrice > 0) body.MaxPrice = Math.round(opts.maxPrice * 100);

    const payload = JSON.stringify(body);
    const headers = signAmazonPaapi({
      accessKey: creds.accessKey, secretKey: creds.secretKey,
      region, host, path: SEARCH_PATH, target: SEARCH_TARGET, payload,
    });

    const res = await axios.post(`https://${host}${SEARCH_PATH}`, payload, {
      headers, timeout: 15000, validateStatus: () => true,
    });

    if (res.data?.Errors?.length) {
      const e = res.data.Errors[0];
      // NoResults is not an error worth throwing — just means the keyword found nothing.
      if (e.Code === 'NoResults') return [];
      throw new BadRequestException(`Amazon: ${e.Message || e.Code}`);
    }
    if (res.status !== 200) {
      throw new BadRequestException(`Amazon: הבקשה נכשלה (HTTP ${res.status})`);
    }

    const items: any[] = res.data?.SearchResult?.Items || [];
    return items.map((it) => {
      const listing = it?.Offers?.Listings?.[0];
      const price = Number(listing?.Price?.Amount) || 0;
      const saving = Number(listing?.SavingBasis?.Amount) || 0;
      return {
        asin: String(it?.ASIN || ''),
        title: it?.ItemInfo?.Title?.DisplayValue || 'Amazon product',
        image: it?.Images?.Primary?.Large?.URL || '',
        affiliate_url: it?.DetailPageURL || '',
        price_usd: price,
        original_usd: saving > price ? saving : price,
      } as AmazonProduct;
    }).filter((p) => p.asin && p.image && p.price_usd > 0);
  }

  /** Minimal live call so the user can verify their PA-API creds are approved and working. */
  async testConnection(userId: string): Promise<{ ok: boolean; error?: string; sample?: string; count?: number }> {
    const creds = await this.credentials.getAmazon(userId);
    if (!creds) {
      return { ok: false, error: 'חסרים פרטי Amazon (Access Key / Secret / Partner Tag) בהגדרות ← אינטגרציות.' };
    }
    try {
      const items = await this.searchItems(userId, 'gadget', { itemCount: 1 });
      return { ok: true, count: items.length, sample: items[0]?.title };
    } catch (err: any) {
      const msg = err?.response?.data?.Errors?.[0]?.Message || err?.message || 'הבדיקה נכשלה.';
      // The most common real-world failure: PA-API access isn't unlocked yet.
      const hint = /not been applied|not eligible|AssociateValidationError|TooManyRequests|throttl/i.test(msg)
        ? `${msg} — ודא שחשבון ה-Amazon Associates שלך מאושר לגישת PA-API (נדרשות מכירות מזכות ראשונות) ושה-Partner Tag נכון.`
        : msg;
      return { ok: false, error: hint };
    }
  }

  /**
   * Autopilot run for an Amazon campaign: rotate a keyword → SearchItems → schedule the
   * results into the target group's slots (same cadence machinery as the AliExpress/FLYLINK
   * runners). A target group is required (like FLYLINK) so Amazon posts stay isolated.
   */
  async runAmazonCampaign(campaign: Campaign, userId: string, opts?: { fromScheduler?: boolean }): Promise<CampaignRunResult> {
    if (opts?.fromScheduler && !(await this.posts.isCampaignWindowOpen(userId, campaign))) {
      return { queued: 0, failed: 0, keyword: '', searched: '', errors: ['מחוץ לחלון הפרסום — דילוג'] };
    }

    let targets: string[] = [];
    try { targets = JSON.parse(campaign.target_channels || '[]'); } catch { targets = []; }
    targets = Array.from(new Set(targets.filter((t) => typeof t === 'string' && t.trim())));
    if (!targets.length) throw new BadRequestException('לקמפיין אמזון לא הוגדרה קבוצת יעד — ערוך את הקמפיין ובחר קבוצה');

    if (!campaign.keywords?.length) throw new BadRequestException('לקמפיין אמזון אין מילות מפתח');

    // Round-robin keyword (same rule as AliExpress) so every keyword gets equal airtime.
    const kwIndex = (campaign.keyword_cursor ?? 0) % campaign.keywords.length;
    const keyword = campaign.keywords[kwIndex];
    this.campaignRepo.increment({ id: campaign.id }, 'keyword_cursor', 1).catch(() => {});
    if (!keyword?.trim()) throw new BadRequestException('לקמפיין אמזון אין מילות מפתח');

    const limit = Math.max(1, Math.min(10, campaign.posts_per_run || 1));
    const found = await this.searchItems(userId, keyword, {
      itemCount: Math.max(limit * 2, 5),
      minPrice: campaign.min_price ?? undefined,
      maxPrice: campaign.max_price ?? undefined,
    });
    if (!found.length) {
      throw new BadRequestException(`לא נמצאו מוצרי אמזון עבור "${keyword}". נסה מילת מפתח אחרת או הרחב את טווח המחירים.`);
    }

    // Skip products this campaign already posted (dedup by ASIN), same as the other runners.
    const postedIds = await this.posts.postedProductIds(campaign.id).catch(() => new Set<string>());
    const fresh = found.filter((p) => !postedIds.has(p.asin));
    const products = (fresh.length ? fresh : found).slice(0, limit);

    const template = await this.posts.resolveBodyTemplate(userId, targets[0]);
    const creds = await this.credentials.getRaw(userId);
    const times = this.posts.campaignScheduleTimes(products.length, creds);
    const result: CampaignRunResult = { queued: 0, failed: 0, keyword, searched: `Amazon: ${keyword}`, errors: [] };

    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      try {
        const { slot, skip } = await this.posts.nextGroupSlot(userId, targets[0], times[i]);
        if (skip && opts?.fromScheduler) continue;

        // Prices come from Amazon in USD → pass currency 'USD' so createQueuedPost converts
        // to the user's display currency (passing an already-₪ price would double-convert).
        const product = {
          product_id: p.asin,
          title: p.title,
          image_url: p.image,
          affiliate_url: p.affiliate_url,
          sale_price: p.price_usd,
          original_price: p.original_usd,
          currency: 'USD',
          discount_percent: p.original_usd > p.price_usd ? Math.round((1 - p.price_usd / p.original_usd) * 100) : 0,
          orders_count: 0,
          rating: 0,
        };
        await this.posts.createQueuedPost(
          userId, product, undefined, template || undefined, targets[0], [p.image], undefined, targets,
          { scheduledAt: slot, campaignId: campaign.id },
        );
        result.queued++;
        await this.posts.incrementCampaignPosts(campaign.id).catch(() => {});
      } catch (err: any) {
        result.failed++;
        result.errors.push(err?.message || 'queue failed');
      }
    }

    return result;
  }
}
