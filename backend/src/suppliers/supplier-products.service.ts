import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupplierProduct } from './entities/supplier-product.entity';
import { SupplierCatalog } from './entities/supplier-catalog.entity';
import { SupplierCatalogsService } from './supplier-catalogs.service';
import { YupooService } from './yupoo.service';
import { normalizeSku } from './sku-match.util';
import { PostsService } from '../posts/posts.service';
import { AiService } from '../ai/ai.service';
import { CredentialsService } from '../credentials/credentials.service';
import { SubscriptionService } from '../subscription/subscription.service';

const EDITABLE = ['title', 'description', 'image_url', 'price', 'currency', 'flylink_url', 'status'] as const;

@Injectable()
export class SupplierProductsService {
  constructor(
    @InjectRepository(SupplierProduct) private readonly repo: Repository<SupplierProduct>,
    private readonly catalogs: SupplierCatalogsService,
    private readonly yupoo: YupooService,
    private readonly posts: PostsService,
    private readonly ai: AiService,
    private readonly credentials: CredentialsService,
    private readonly subscription: SubscriptionService,
  ) {}

  list(userId: string, catalogId?: string) {
    const where: any = { user_id: userId };
    if (catalogId) where.supplier_catalog_id = catalogId;
    return this.repo.find({ where, order: { created_at: 'DESC' }, take: 300 });
  }

  async get(userId: string, id: string): Promise<SupplierProduct> {
    const p = await this.repo.findOne({ where: { id, user_id: userId } });
    if (!p) throw new NotFoundException('מוצר לא נמצא');
    return p;
  }

  /**
   * Soft, best-effort code guess from a pasted FLYLINK URL. FLYLINK affiliate links
   * are per-product GENERATED tracking links — usually opaque and WITHOUT a readable
   * product code — so this is only a hint, never used to hard-block an import.
   */
  private codeFromUrl(url?: string): string {
    if (!url) return '';
    const m = decodeURIComponent(url).match(/([A-Za-z]{2,5}\d{3,})/);
    return m?.[1] || '';
  }

  /**
   * Link a Yupoo album (real content) to a FLYLINK affiliate link, verifying the
   * shared product code per the catalog's match mode.
   */
  async link(userId: string, dto: { catalogId: string; yupooUrl: string; flylinkUrl: string; code?: string }) {
    if (!dto.yupooUrl?.trim() || !dto.flylinkUrl?.trim()) {
      throw new BadRequestException('חסר קישור Yupoo או FLYLINK');
    }
    const catalog = await this.catalogs.get(userId, dto.catalogId);

    const item = await this.yupoo.fetchAlbum(dto.yupooUrl.trim());
    const mode = catalog.sku_match_mode;
    const cfg = catalog.sku_match_config || {};
    const yupooCanon = normalizeSku(item.code, mode, cfg);

    // Each FLYLINK product has its OWN affiliate link, generated on FLYLINK's site —
    // an opaque per-product tracking link, so we cannot reliably read the code from it.
    // Verification therefore uses the code the user supplies (authoritative → hard-fail
    // on mismatch); if none, a soft URL guess may confirm but NEVER blocks a legit link.
    let sku_verified = false;
    const userCode = dto.code?.trim();
    if (userCode) {
      const flyCanon = normalizeSku(userCode, mode, cfg);
      if (flyCanon !== yupooCanon) {
        throw new BadRequestException(
          `הקודים לא תואמים: Yupoo=${item.code} (${yupooCanon}) מול FLYLINK=${userCode} (${flyCanon})`,
        );
      }
      sku_verified = true;
    } else {
      const guess = this.codeFromUrl(dto.flylinkUrl);
      if (guess && normalizeSku(guess, mode, cfg) === yupooCanon) sku_verified = true;
      // No hard block — the affiliate link is trusted as pasted (per-product generated).
    }

    // Dedup within the user by canonical SKU.
    const existing = await this.repo.findOne({ where: { user_id: userId, sku: yupooCanon } });
    if (existing) throw new ConflictException('מוצר עם קוד זה כבר קיים');

    const product = this.repo.create({
      user_id: userId,
      supplier_catalog_id: catalog.id,
      sku: yupooCanon,
      title: item.title,
      description: item.description || null,
      image_url: item.images[0] || null,
      gallery_json: item.images.length ? JSON.stringify(item.images) : null,
      price: item.price,
      currency: item.currency,
      yupoo_url: item.album_url,
      flylink_url: dto.flylinkUrl.trim(),
      in_stock: true,
      status: 'active',
      synced_at: new Date(),
    });
    const saved = await this.repo.save(product);
    return { ...saved, sku_verified };
  }

  async update(userId: string, id: string, dto: any): Promise<SupplierProduct> {
    const p = await this.get(userId, id);
    for (const key of EDITABLE) if (dto[key] !== undefined) (p as any)[key] = dto[key];
    return this.repo.save(p);
  }

  async remove(userId: string, id: string) {
    const p = await this.get(userId, id);
    await this.repo.remove(p);
    return { deleted: true };
  }

  /** AI description from the real Yupoo facts (title/brand/price) — reuses AiService. */
  async generateDescription(userId: string, id: string) {
    const p = await this.get(userId, id);
    const creds = await this.credentials.getRaw(userId);
    if (!this.ai.hasAnyKey(creds)) throw new BadRequestException('לא הוגדר מפתח AI בהגדרות');
    await this.subscription.consumeOrThrow(userId, this.subscription.costs.ai_generate, 'ai_generate_supplier');

    const facts = [
      `שם/מותג: ${p.title}`,
      p.price > 0 ? `מחיר: ${p.currency} ${p.price}` : null,
    ].filter(Boolean).join('\n');
    const result = await this.ai.generate(creds, {
      system: 'אתה כותב תיאורי מוצר קצרים ומדויקים בעברית לקטלוג. 2-4 משפטים, ענייני, בלי מחיר ובלי קישור. עברית בלבד (מותג באנגלית מותר).',
      prompt: `כתוב תיאור לפי:\n${facts}`,
      maxTokens: 300, temperature: 0.6,
    });
    const description = result?.text?.trim();
    if (!description) throw new BadRequestException('יצירת התיאור נכשלה');
    p.description = description;
    await this.repo.save(p);
    return { description };
  }

  /**
   * Publish: push the supplier product into the SHARED post queue, routed to the
   * chosen group (or the catalog's default). Reuses the entire existing pipeline.
   */
  async queue(userId: string, id: string, channelId?: string) {
    const p = await this.get(userId, id);
    if (p.in_stock === false) throw new BadRequestException('המוצר לא זמין (קישור FLYLINK מת)');
    if (!p.flylink_url) throw new BadRequestException('חסר קישור FLYLINK למוצר');

    const catalog = await this.repo.manager.findOne(SupplierCatalog, { where: { id: p.supplier_catalog_id } });
    const targetChannel = channelId?.trim() || catalog?.target_channel_id || undefined;

    // All product photos (colors/variants) → sent as one swipeable Telegram album.
    let gallery: string[] = [];
    try { gallery = p.gallery_json ? JSON.parse(p.gallery_json) : []; } catch { /* ignore */ }
    if (p.image_url && !gallery.includes(p.image_url)) gallery.unshift(p.image_url);

    const post = await this.posts.createQueuedPost(
      userId,
      {
        product_id: p.sku || p.id,
        title: p.title,
        image_url: p.image_url || gallery[0] || '',
        affiliate_url: p.flylink_url,
        sale_price: p.price,
        original_price: p.price,
        currency: p.currency,
        discount_percent: 0,
        orders_count: 0,
        rating: 0,
      },
      undefined,
      p.description || undefined,
      targetChannel,
      gallery,
    );
    p.has_post = true;
    await this.repo.save(p);
    return { queued: true, post_id: post.id, channel: targetChannel || 'default' };
  }

  /** Re-fetch Yupoo for price + check FLYLINK link liveness → in_stock. (Used by cron.) */
  async refreshOne(product: SupplierProduct): Promise<void> {
    try {
      if (product.yupoo_url) {
        const item = await this.yupoo.fetchAlbum(product.yupoo_url);
        if (item.price > 0) product.price = item.price;
      }
    } catch { /* keep old price on fetch failure */ }
    // FLYLINK liveness — the only availability signal we have.
    if (product.flylink_url) {
      product.in_stock = await this.isLinkAlive(product.flylink_url);
    }
    product.synced_at = new Date();
    await this.repo.save(product);
  }

  private async isLinkAlive(url: string): Promise<boolean> {
    const axios = require('axios');
    try {
      const res = await axios.head(url, { timeout: 8000, maxRedirects: 5, validateStatus: () => true });
      return res.status < 400;
    } catch {
      try {
        const res = await axios.get(url, { timeout: 8000, maxRedirects: 5, validateStatus: () => true });
        return res.status < 400;
      } catch { return false; }
    }
  }

  /** Oldest-synced active products for the scheduled sync. */
  dueForSync(limit: number) {
    return this.repo.find({ where: { status: 'active' as any }, order: { synced_at: 'ASC' }, take: limit });
  }
}
