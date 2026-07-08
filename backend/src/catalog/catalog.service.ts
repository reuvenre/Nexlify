import {
  Injectable, NotFoundException, ConflictException, BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, FindOptionsWhere } from 'typeorm';
import { CatalogProduct, CatalogStatus } from './catalog-product.entity';
import { ProductsService } from '../products/products.service';
import { PostsService } from '../posts/posts.service';
import { AiService } from '../ai/ai.service';
import { CredentialsService } from '../credentials/credentials.service';
import { SubscriptionService } from '../subscription/subscription.service';

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(CatalogProduct)
    private readonly repo: Repository<CatalogProduct>,
    private readonly productsService: ProductsService,
    private readonly postsService: PostsService,
    private readonly ai: AiService,
    private readonly credentials: CredentialsService,
    private readonly subscription: SubscriptionService,
  ) {}

  // ── List ──────────────────────────────────────────────────────────────────

  async list(
    userId: string,
    page = 1,
    limit = 20,
    status?: string,
    hasPost?: boolean,
    search?: string,
  ) {
    const where: FindOptionsWhere<CatalogProduct> = { user_id: userId };

    if (status && status !== 'all') {
      where.status = status as CatalogStatus;
    }
    if (hasPost !== undefined) {
      where.has_post = hasPost;
    }

    const qb = this.repo.createQueryBuilder('p')
      .where('p.user_id = :userId', { userId });

    if (status && status !== 'all') {
      qb.andWhere('p.status = :status', { status });
    }
    if (hasPost !== undefined) {
      qb.andWhere('p.has_post = :hasPost', { hasPost });
    }
    if (search) {
      qb.andWhere('(p.title ILIKE :s OR p.product_id ILIKE :s OR p.category ILIKE :s)', {
        s: `%${search}%`,
      });
    }

    qb.orderBy('p.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, limit };
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  async stats(userId: string) {
    const [total, approved, pending, rejected, withPost] = await Promise.all([
      this.repo.count({ where: { user_id: userId } }),
      this.repo.count({ where: { user_id: userId, status: 'approved' } }),
      this.repo.count({ where: { user_id: userId, status: 'pending' } }),
      this.repo.count({ where: { user_id: userId, status: 'rejected' } }),
      this.repo.count({ where: { user_id: userId, has_post: true } }),
    ]);

    const categories = await this.repo
      .createQueryBuilder('p')
      .select('COUNT(DISTINCT p.category)', 'cnt')
      .where('p.user_id = :userId', { userId })
      .getRawOne();

    const suppliers = await this.repo
      .createQueryBuilder('p')
      .select('COUNT(DISTINCT p.supplier)', 'cnt')
      .where('p.user_id = :userId', { userId })
      .getRawOne();

    return {
      total,
      approved,
      pending,
      rejected,
      with_post: withPost,
      categories: parseInt(categories?.cnt || '0', 10),
      suppliers: parseInt(suppliers?.cnt || '0', 10),
    };
  }

  // ── Find one ──────────────────────────────────────────────────────────────

  async findOne(userId: string, id: string) {
    const product = await this.repo.findOne({ where: { id, user_id: userId } });
    if (!product) throw new NotFoundException('מוצר לא נמצא');
    return product;
  }

  // ── Import ────────────────────────────────────────────────────────────────

  async importProduct(
    userId: string,
    dto: {
      url?: string;
      productId?: string;
      category?: string;
      prefetched?: {
        title?: string;
        imageUrl?: string;
        salePrice?: number;
        originalPrice?: number;
        currency?: string;
        discountPercent?: number;
        ordersCount?: number;
        rating?: number;
      };
    },
  ) {
    // Extract product_id
    let productId = dto.productId?.trim();
    if (!productId && dto.url) {
      const match = dto.url.match(/\/item\/(\d+)/);
      if (match) {
        productId = match[1];
      } else {
        const numMatch = dto.url.match(/(\d{10,})/);
        if (numMatch) productId = numMatch[1];
      }
    }
    if (!productId) {
      throw new BadRequestException('לא ניתן לחלץ מזהה מוצר מהקלט');
    }

    // Check duplicates
    const existing = await this.repo.findOne({
      where: { user_id: userId, product_id: productId },
    });
    if (existing) throw new ConflictException('המוצר כבר קיים בקטלוג');

    // If the caller supplied pre-fetched product data (e.g. from discover page),
    // use it directly — no need for an unreliable AliExpress keyword re-fetch.
    const pf = dto.prefetched;
    let aliProduct: Awaited<ReturnType<typeof this.productsService.refreshPrice>> | null = null;
    if (!pf?.title) {
      // Only hit AliExpress when we don't already have the data
      aliProduct = await this.productsService.refreshPrice(userId, productId);
    }

    const product = this.repo.create({
      user_id: userId,
      product_id: productId,
      title:            pf?.title            ?? aliProduct?.title            ?? `מוצר ${productId}`,
      original_price:   pf?.originalPrice    ?? aliProduct?.original_price   ?? 0,
      sale_price:       pf?.salePrice        ?? aliProduct?.sale_price       ?? 0,
      currency:         pf?.currency         ?? aliProduct?.currency         ?? 'ILS',
      discount_percent: pf?.discountPercent  ?? aliProduct?.discount_percent ?? 0,
      image_url:        pf?.imageUrl         ?? aliProduct?.image_url        ?? '',
      product_url:      aliProduct?.product_url ?? `https://www.aliexpress.com/item/${productId}.html`,
      category:         dto.category         || aliProduct?.category         || '',
      orders_count:     pf?.ordersCount      ?? aliProduct?.orders_count     ?? 0,
      rating:           pf?.rating           ?? aliProduct?.rating           ?? 0,
      status: 'approved',
      supplier: 'AliExpress',
      synced_at: new Date(),
    });

    return this.repo.save(product);
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async update(userId: string, id: string, dto: Partial<{
    title: string;
    description: string;
    post_text: string;
    original_price: number;
    sale_price: number;
    currency: string;
    discount_percent: number;
    image_url: string;
    affiliate_url: string;
    category: string;
    keyword: string;
    coupon_code: string;
    commission_rate: number;
  }>) {
    const product = await this.findOne(userId, id);

    // Whitelist editable fields only. Never Object.assign the raw dto — that would let
    // a caller inject id / user_id / product_id / status and overwrite another user's
    // row (mass-assignment). Only copy keys the caller is explicitly allowed to set.
    const EDITABLE = [
      'title', 'description', 'post_text', 'original_price', 'sale_price',
      'currency', 'discount_percent', 'image_url', 'affiliate_url',
      'category', 'keyword', 'coupon_code', 'commission_rate',
    ] as const;
    for (const key of EDITABLE) {
      if (dto[key] !== undefined) (product as any)[key] = dto[key];
    }
    return this.repo.save(product);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async remove(userId: string, id: string) {
    const product = await this.findOne(userId, id);
    await this.repo.remove(product);
    return { deleted: true };
  }

  // ── Approve / Reject ──────────────────────────────────────────────────────

  async setStatus(userId: string, id: string, status: CatalogStatus) {
    const product = await this.findOne(userId, id);
    product.status = status;
    return this.repo.save(product);
  }

  // ── Sync ──────────────────────────────────────────────────────────────────

  async sync(userId: string, id: string) {
    const product = await this.findOne(userId, id);
    const aliProduct = await this.productsService.refreshPrice(userId, product.product_id);

    if (aliProduct) {
      product.title = aliProduct.title;
      product.original_price = aliProduct.original_price;
      product.sale_price = aliProduct.sale_price;
      product.currency = aliProduct.currency;
      product.discount_percent = aliProduct.discount_percent;
      product.image_url = aliProduct.image_url;
      product.orders_count = aliProduct.orders_count;
      product.rating = aliProduct.rating;
    }
    product.synced_at = new Date();
    return this.repo.save(product);
  }

  // ── Bulk re-price ───────────────────────────────────────────────────────────

  /**
   * Re-pull authoritative prices from the AliExpress Affiliate API for every
   * catalog product. Fixes items that were saved with the old (broken) discovery
   * price. Processed in small concurrent batches to stay fast without tripping
   * rate limits.
   */
  // A whole-catalog re-price is too long for one HTTP request (the UI timed out
  // and reported "nothing happened" while the sync kept running server-side).
  // It now runs as a BACKGROUND job per user: POST starts it, GET polls progress.
  private resyncJobs = new Map<string, {
    running: boolean; total: number; done: number; updated: number; failed: number;
    started_at: Date; finished_at?: Date;
  }>();

  /** Starts a background re-price of the user's whole catalog (idempotent while running). */
  async startResyncPrices(userId: string) {
    const existing = this.resyncJobs.get(userId);
    if (existing?.running) return { started: false, ...existing };

    const products = await this.repo.find({ where: { user_id: userId } });
    const job = {
      running: true, total: products.length, done: 0, updated: 0, failed: 0,
      started_at: new Date(), finished_at: undefined as Date | undefined,
    };
    this.resyncJobs.set(userId, job);

    // Fire and forget — progress is observable via resyncStatus().
    this.runResync(userId, products, job).catch(() => {
      job.running = false;
      job.finished_at = new Date();
    });

    return { started: true, ...job };
  }

  /** Progress of the user's re-price job (or an idle stub when never started). */
  resyncStatus(userId: string) {
    return this.resyncJobs.get(userId)
      || { running: false, total: 0, done: 0, updated: 0, failed: 0 };
  }

  private async runResync(
    userId: string,
    products: CatalogProduct[],
    job: { running: boolean; total: number; done: number; updated: number; failed: number; finished_at?: Date },
  ) {
    // Batched: one productdetail.get per 20 products (the API accepts a comma-
    // separated id list) — the whole catalog re-prices in seconds instead of the
    // old one-call-per-product loop that fought the rate limit for minutes.
    const CHUNK = 20;
    try {
      for (let i = 0; i < products.length; i += CHUNK) {
        const chunk = products.slice(i, i + CHUNK);
        if (i > 0) await new Promise((r) => setTimeout(r, 900)); // rate-limit pacing
        try {
          const fresh = await this.productsService.refreshPricesBatch(
            userId, chunk.map((p) => p.product_id),
          );
          for (const product of chunk) {
            const ali = fresh.get(String(product.product_id));
            if (ali && ali.sale_price > 0) {
              product.original_price = ali.original_price;
              product.sale_price = ali.sale_price;
              product.currency = ali.currency;
              product.discount_percent = ali.discount_percent;
              product.synced_at = new Date();
              await this.repo.save(product);
              job.updated++;
            } else {
              job.failed++;
            }
            job.done++;
          }
        } catch {
          job.failed += chunk.length;
          job.done += chunk.length;
        }
      }
    } finally {
      job.running = false;
      job.finished_at = new Date();
    }
  }

  // ── AI product description ────────────────────────────────────────────────

  /**
   * Generates a factual Hebrew product description from the REAL data the
   * Affiliate API provides (title, category, price, discount, sales, rating).
   * The API exposes no description field and the product page is a JS shell,
   * so an AI summary grounded in verified facts is the only reliable source.
   * Costs the standard AI-generation credits.
   */
  async generateDescription(userId: string, id: string) {
    const product = await this.findOne(userId, id);
    const creds = await this.credentials.getRaw(userId);
    if (!this.ai.hasAnyKey(creds)) {
      throw new BadRequestException('לא הוגדר מפתח AI — הגדר ספק AI בהגדרות ← שווקים');
    }

    await this.subscription.consumeOrThrow(userId, this.subscription.costs.ai_generate, 'ai_generate_description');

    const facts = [
      `שם המוצר (באנגלית): ${product.title}`,
      product.category ? `קטגוריה: ${product.category}` : null,
      product.sale_price > 0 ? `מחיר נוכחי: ₪${product.sale_price}` : null,
      product.discount_percent > 0 ? `הנחה: ${product.discount_percent}%` : null,
      product.orders_count > 0 ? `הזמנות אחרונות: ${product.orders_count}` : null,
      product.rating > 0 ? `דירוג: ${product.rating}/5` : null,
    ].filter(Boolean).join('\n');

    const result = await this.ai.generate(creds, {
      system: `אתה כותב תיאורי מוצר קצרים ומדויקים בעברית לקטלוג מסחרי.
חוקים:
• 2-4 משפטים בלבד, ענייניים ומכירתיים במידה.
• תאר אך ורק מה שניתן להסיק בביטחון משם המוצר והקטגוריה — אל תמציא מפרט טכני, מידות או חומרים שלא מופיעים בשם.
• אל תכלול מחיר או קישור בתיאור.
• עברית בלבד (שם מותג/דגם מותר להשאיר באנגלית).`,
      prompt: `כתוב תיאור מוצר לפי הנתונים:\n${facts}`,
      maxTokens: 300,
      temperature: 0.6,
    });

    const description = result?.text?.trim();
    if (!description) throw new BadRequestException('יצירת התיאור נכשלה — נסה שוב');

    product.description = description;
    await this.repo.save(product);
    return { description };
  }

  // ── Affiliate link ────────────────────────────────────────────────────────

  async affiliateLink(userId: string, id: string) {
    const product = await this.findOne(userId, id);
    const result = await this.productsService.affiliateLink(userId, product.product_id);

    if (result.url) {
      product.affiliate_url = result.url;
      await this.repo.save(product);
    }
    return result;
  }

  // ── Mark has_post ─────────────────────────────────────────────────────────

  async markHasPost(userId: string, productId: string) {
    await this.repo.update(
      { user_id: userId, product_id: productId },
      { has_post: true },
    );
  }

  // ── Queue product ─────────────────────────────────────────────────────────

  /** Generates post text via OpenAI and adds the product to the send queue */
  async queueProduct(userId: string, id: string) {
    const product = await this.findOne(userId, id);

    // Ensure affiliate link exists
    let affiliateUrl = product.affiliate_url;
    if (!affiliateUrl) {
      try {
        const result = await this.productsService.affiliateLink(userId, product.product_id);
        if (result.url) {
          product.affiliate_url = result.url;
          await this.repo.save(product);
          affiliateUrl = result.url;
        }
      } catch {}
      if (!affiliateUrl) {
        affiliateUrl = product.product_url || `https://www.aliexpress.com/item/${product.product_id}.html`;
      }
    }

    const post = await this.postsService.createQueuedPost(
      userId,
      {
        product_id: product.product_id,
        title: product.title,
        image_url: product.image_url,
        affiliate_url: affiliateUrl,
        sale_price: product.sale_price,
        original_price: product.original_price,
        currency: product.currency,
        discount_percent: product.discount_percent,
        orders_count: product.orders_count,
        rating: product.rating,
      },
      product.id,
    );

    // Mark catalog product as having a post
    product.has_post = true;
    await this.repo.save(product);

    return post;
  }

  /** Queues multiple products at once */
  async queueBatch(userId: string, ids: string[]) {
    const results: { id: string; success: boolean; error?: string }[] = [];

    for (const id of ids) {
      try {
        await this.queueProduct(userId, id);
        results.push({ id, success: true });
      } catch (err: any) {
        results.push({ id, success: false, error: err.message });
      }
    }

    return results;
  }
}
