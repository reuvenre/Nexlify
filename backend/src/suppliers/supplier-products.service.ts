import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupplierProduct } from './entities/supplier-product.entity';
import { SupplierCatalog } from './entities/supplier-catalog.entity';
import { SupplierCatalogsService } from './supplier-catalogs.service';
import { YupooService } from './yupoo.service';
import { normalizeSku } from './sku-match.util';
import { PostsService } from '../posts/posts.service';
import { AiService, GenerateImage } from '../ai/ai.service';
import { CredentialsService } from '../credentials/credentials.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { RatesService } from '../rates/rates.service';

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
    private readonly rates: RatesService,
  ) {}

  /** The user's USD→target rate + target currency code (Yupoo prices are USD). */
  private async rateFor(userId: string): Promise<{ rate: number; currency: string }> {
    const creds = await this.credentials.getRaw(userId);
    const pair = creds?.currency_pair || 'USD_ILS';
    return { rate: (await this.rates.getRate(pair)) || 1, currency: pair.split('_')[1] || 'ILS' };
  }

  /**
   * Convert a supplier price (Yupoo = USD) to the user's target currency, exactly like
   * the AliExpress flow. Returns the converted price + target currency code so the whole
   * post pipeline treats it as ALREADY converted (no double conversion downstream).
   */
  private async pricing(userId: string, sourcePrice: number): Promise<{ price: number; currency: string }> {
    const { rate, currency } = await this.rateFor(userId);
    return { price: +((sourcePrice || 0) * rate).toFixed(2), currency };
  }

  async list(userId: string, catalogId?: string) {
    const where: any = { user_id: userId };
    if (catalogId) where.supplier_catalog_id = catalogId;
    const products = await this.repo.find({ where, order: { created_at: 'DESC' }, take: 300 });
    // Attach the converted price (USD→user currency) so the dashboard shows ₪ like AliExpress.
    const { rate, currency } = await this.rateFor(userId);

    // Derive each product's PUBLISH status from its posts (matched by product_id, which
    // supplier posts set to `sku || id`): in queue / scheduled / pending → 'pending'
    // (ממתין), published → 'sent' (נשלח). Pending wins so a re-queued product shows as
    // awaiting send again — same lifecycle as the AliExpress catalog.
    const keys = products.map((p) => p.sku || p.id).filter(Boolean);
    const publishMap = new Map<string, 'pending' | 'sent'>();
    if (keys.length) {
      const rows: Array<{ pid: string; has_pending: boolean; has_sent: boolean }> = await this.repo.manager.query(
        `SELECT product_id AS pid,
                bool_or(status IN ('queued','scheduled','pending')) AS has_pending,
                bool_or(status = 'sent') AS has_sent
         FROM posts
         WHERE user_id = $1 AND product_id = ANY($2)
         GROUP BY product_id`,
        [userId, keys],
      );
      for (const r of rows) {
        if (r.has_pending) publishMap.set(r.pid, 'pending');
        else if (r.has_sent) publishMap.set(r.pid, 'sent');
      }
    }

    return products.map((p) => ({
      ...p,
      price_ils: +((p.price || 0) * rate).toFixed(2),
      display_currency: currency,
      publish_status: publishMap.get(p.sku || p.id) ?? null,
    }));
  }

  async get(userId: string, id: string): Promise<SupplierProduct> {
    const p = await this.repo.findOne({ where: { id, user_id: userId } });
    if (!p) throw new NotFoundException('מוצר לא נמצא');
    return p;
  }

  /** Wrap a Yupoo image URL in our public proxy (adds the hotlink Referer). */
  private proxyImage(url?: string): string {
    if (!url) return '';
    if (!/yupoo\.com/i.test(url)) return url; // non-yupoo image → leave as-is
    const base = (process.env.BACKEND_URL || '').replace(/\/$/, '');
    return `${base}/suppliers/image?url=${encodeURIComponent(url)}`;
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
  async link(userId: string, dto: {
    catalogId: string; yupooUrl: string; flylinkUrl: string; code?: string;
    album?: { code?: string; price?: number; currency?: string; description?: string; title?: string; images?: string[]; album_url?: string };
  }) {
    if (!dto.yupooUrl?.trim() || !dto.flylinkUrl?.trim()) {
      throw new BadRequestException('חסר קישור Yupoo או FLYLINK');
    }
    const catalog = await this.catalogs.get(userId, dto.catalogId);

    // Reuse the album already fetched by previewAlbum (the Browse flow) so we don't hit
    // Yupoo a SECOND time — that redundant request is what was timing out (ECONNABORTED).
    // Fall back to fetching only when no album was passed (the manual "link" flow).
    const item = (dto.album && dto.album.images?.length)
      ? {
          code: dto.album.code || '',
          price: dto.album.price || 0,
          currency: dto.album.currency || 'USD',
          description: dto.album.description || '',
          title: dto.album.title || dto.album.code || '',
          images: dto.album.images,
          album_url: dto.album.album_url || dto.yupooUrl.trim(),
        }
      : await this.yupoo.fetchAlbum(dto.yupooUrl.trim());
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

    // Dedup by canonical SKU WITHIN THE SAME CATALOG — the same code in a different store
    // is a different product (e.g. numeric mode maps LUN1463 and WT1463 both to "1463";
    // scoping per-user wrongly flagged them as duplicates). If it already exists here,
    // reuse it (refresh the FLYLINK link) instead of erroring — so "create post" always works.
    const existing = await this.repo.findOne({
      where: { user_id: userId, supplier_catalog_id: catalog.id, sku: yupooCanon },
    });
    if (existing) {
      const newLink = dto.flylinkUrl.trim();
      if (newLink && newLink !== existing.flylink_url) {
        existing.flylink_url = newLink;
        await this.repo.save(existing);
      }
      return { ...existing, sku_verified };
    }

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

  /** All product photos (colors/variants), proxied → one swipeable Telegram album. */
  private proxiedGallery(p: SupplierProduct): string[] {
    let gallery: string[] = [];
    try { gallery = p.gallery_json ? JSON.parse(p.gallery_json) : []; } catch { /* ignore */ }
    if (p.image_url && !gallery.includes(p.image_url)) gallery.unshift(p.image_url);
    // Yupoo hotlink-protects images → Telegram can't fetch them directly. Route each
    // through our public proxy (adds the required Referer) so the photo actually sends.
    return gallery.map((u) => this.proxyImage(u));
  }

  /** Resolve the publish target: explicit channel → catalog default → user default. */
  private async targetChannel(p: SupplierProduct, channelId?: string): Promise<string | undefined> {
    if (channelId?.trim()) return channelId.trim();
    const catalog = await this.repo.manager.findOne(SupplierCatalog, { where: { id: p.supplier_catalog_id } });
    return catalog?.target_channel_id || undefined;
  }

  /** Map a supplier product to the AliProduct-ish shape the post pipeline expects.
   * `price`/`currency` are ALREADY converted to the user's currency (via pricing()), and
   * currency !== 'USD' signals the pipeline not to convert again. */
  private toPostProduct(p: SupplierProduct, image: string, price: number, currency: string) {
    return {
      product_id: p.sku || p.id,
      title: p.title,
      image_url: image,
      affiliate_url: p.flylink_url,
      sale_price: price,
      original_price: price,
      currency,
      discount_percent: 0,
      orders_count: 0,
      rating: 0,
      price_ils: price,
    };
  }

  /**
   * AI-generate (or re-generate) the post text WITHOUT saving a post — IDENTICAL to
   * the AliExpress quick-post flow: same PostsService.preview → generateText → Gemini
   * (per the user's ai_provider), same body-template system prompt, same language.
   * Credit for ai_generate is consumed inside generateText, exactly like AliExpress
   * (no extra supplier-level charge).
   */
  async preview(userId: string, id: string, opts?: { language?: string; template?: string; vision?: boolean; hint?: string }) {
    const p = await this.get(userId, id);
    const gallery = this.proxiedGallery(p);
    const image = this.proxyImage(p.image_url) || gallery[0] || '';

    // Vision: fetch SEVERAL of the real product photos so the AI can identify the item
    // reliably — a single first image is often a cover/size-chart/logo and makes the model
    // write about the wrong thing (flip-flops → "lighting"). Skipped when a template is
    // active (template wording is authoritative). A user hint overrides the model entirely.
    let images: GenerateImage[] | undefined;
    let visionUsed = false;
    if (opts?.vision && !opts?.template?.trim()) {
      images = await this.fetchImagesBase64(this.rawGallery(p), 3);
      visionUsed = images.length > 0;
    }

    const { price, currency } = await this.pricing(userId, p.price);
    const product = this.toPostProduct(p, image, price, currency);
    // A hint is the meaningful product name — use it in the facts so the copy is on-topic.
    if (opts?.hint?.trim()) product.title = opts.hint.trim();

    const result = await this.posts.preview(
      userId, p.sku || p.id, opts?.language || 'he', product, opts?.template, images, opts?.hint,
    );
    return { ...result, gallery, vision_used: visionUsed };
  }

  /** Raw (un-proxied) product image URLs — main image first, then the gallery. */
  private rawGallery(p: SupplierProduct): string[] {
    let g: string[] = [];
    try { g = p.gallery_json ? JSON.parse(p.gallery_json) : []; } catch { /* ignore */ }
    if (p.image_url && !g.includes(p.image_url)) g.unshift(p.image_url);
    return g;
  }

  /** Fetch up to `max` images → base64 for vision (sequential, tolerant of failures). */
  private async fetchImagesBase64(urls: string[], max = 3): Promise<GenerateImage[]> {
    const out: GenerateImage[] = [];
    for (const u of urls.slice(0, max)) {
      const img = await this.fetchImageBase64(u);
      if (img) out.push(img);
    }
    return out;
  }

  /** Fetch a Yupoo image → base64 for vision (Yupoo hotlink-protects → needs the Referer). */
  private async fetchImageBase64(url: string): Promise<GenerateImage | null> {
    const axios = require('axios');
    try {
      const res = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          Referer: 'https://x.yupoo.com/',
        },
        timeout: 12000, maxContentLength: 6 * 1024 * 1024, validateStatus: () => true,
      });
      if (res.status !== 200) return null;
      const mime = (res.headers['content-type'] || 'image/jpeg').split(';')[0];
      return { mime, data: Buffer.from(res.data).toString('base64') };
    } catch {
      return null;
    }
  }

  /**
   * The images to publish as the album: the user's manual selection (validated against
   * the product's own gallery, order preserved, ≤10) — or the full gallery when nothing
   * was picked. Telegram caps a media group at 10.
   */
  private selectGallery(p: SupplierProduct, selected?: string[], max = 10): string[] {
    const full = this.proxiedGallery(p);
    if (selected?.length) {
      const set = new Set(full);
      const chosen = selected.filter((u) => set.has(u)).slice(0, max);
      if (chosen.length) return chosen;
    }
    return full.slice(0, max);
  }

  /** Send now. */
  async send(userId: string, id: string, text?: string, channelId?: string, images?: string[], collageCells?: number) {
    const p = await this.get(userId, id);
    if (p.in_stock === false) throw new BadRequestException('המוצר לא זמין (קישור FLYLINK מת)');
    if (!p.flylink_url) throw new BadRequestException('חסר קישור FLYLINK למוצר');

    const gallery = this.selectGallery(p, images, collageCells ? 30 : 10);
    const image = gallery[0] || this.proxyImage(p.image_url) || '';
    const finalText = text?.trim() || (await this.preview(userId, id)).generated_text;
    const channel = await this.targetChannel(p, channelId);
    const { price } = await this.pricing(userId, p.price);

    const post = await this.posts.sendCustomNow(userId, {
      productId: p.sku || p.id, title: p.title, image, images: gallery,
      affiliateUrl: p.flylink_url, text: finalText, priceIls: price, channelOverride: channel, collageCells,
    });
    p.has_post = true;
    await this.repo.save(p);
    return { sent: true, post_id: post.id, channel: channel || 'default' };
  }

  /** Schedule for a specific time. */
  async schedule(userId: string, id: string, scheduledAt: Date, text?: string, channelId?: string, images?: string[], collageCells?: number) {
    const p = await this.get(userId, id);
    if (p.in_stock === false) throw new BadRequestException('המוצר לא זמין (קישור FLYLINK מת)');
    if (!p.flylink_url) throw new BadRequestException('חסר קישור FLYLINK למוצר');

    const gallery = this.selectGallery(p, images, collageCells ? 30 : 10);
    const image = gallery[0] || this.proxyImage(p.image_url) || '';
    const finalText = text?.trim() || (await this.preview(userId, id)).generated_text;
    const channel = await this.targetChannel(p, channelId);
    const { price } = await this.pricing(userId, p.price);

    const post = await this.posts.scheduleCustom(userId, {
      productId: p.sku || p.id, title: p.title, image, images: gallery,
      affiliateUrl: p.flylink_url, text: finalText, priceIls: price, channelOverride: channel, collageCells,
    }, scheduledAt);
    p.has_post = true;
    await this.repo.save(p);
    return { scheduled: true, post_id: post.id, at: scheduledAt, channel: channel || 'default' };
  }

  /**
   * Publish: push the supplier product into the SHARED post queue, routed to the
   * chosen group (or the catalog's default). Reuses the entire existing pipeline.
   */
  async queue(userId: string, id: string, text?: string, channelId?: string, images?: string[], collageCells?: number) {
    const p = await this.get(userId, id);
    if (p.in_stock === false) throw new BadRequestException('המוצר לא זמין (קישור FLYLINK מת)');
    if (!p.flylink_url) throw new BadRequestException('חסר קישור FLYLINK למוצר');

    const gallery = this.selectGallery(p, images, collageCells ? 30 : 10);
    const image = gallery[0] || this.proxyImage(p.image_url) || '';
    const channel = await this.targetChannel(p, channelId);
    const { price, currency } = await this.pricing(userId, p.price);

    const post = await this.posts.createQueuedPost(
      userId,
      this.toPostProduct(p, image, price, currency),
      undefined,
      text?.trim() || p.description || undefined,
      channel,
      gallery,
      collageCells,
    );
    p.has_post = true;
    await this.repo.save(p);
    const creds = await this.credentials.getRaw(userId);
    return {
      queued: true, post_id: post.id, channel: channel || 'default',
      queue_active: creds?.schedule_enabled === true,
      interval_minutes: creds?.schedule_interval_minutes ?? 60,
    };
  }

  /** Fetch a Yupoo album's FULL content (all color images) for the post modal — no save. */
  async previewAlbum(userId: string, catalogId: string, url: string) {
    await this.catalogs.get(userId, catalogId); // authorize catalog ownership
    if (!url?.trim()) throw new BadRequestException('חסר קישור Yupoo');
    const item = await this.yupoo.fetchAlbum(url.trim());
    const { rate, currency } = await this.rateFor(userId);
    return {
      code: item.code,
      price: +((item.price || 0) * rate).toFixed(2), // converted to the user's currency
      currency,
      source_price: item.price,
      source_currency: item.currency,
      description: item.description,
      title: item.title,
      images: item.images.map((u) => this.proxyImage(u)),
      raw_images: item.images,
      album_url: item.album_url,
    };
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
