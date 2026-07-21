import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import axios from 'axios';
// CommonJS module (no .default) — import-require avoids the `.default is not a
// constructor` trap under this tsconfig (no esModuleInterop). See collage.service.ts.
import FormData = require('form-data');
import { Post } from './post.entity';
import { Template } from '../templates/template.entity';
import { Campaign } from '../campaigns/campaign.entity';
import { CredentialsService, DecryptedCredentials, GRAPH_VERSION } from '../credentials/credentials.service';
import { RatesService } from '../rates/rates.service';
import { AiService, GenerateImage } from '../ai/ai.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { ChannelsService } from '../channels/channels.service';
import { CouponsService } from '../coupons/coupons.service';
import { CollageService } from '../collage/collage.service';
import { signAliexpress } from '../common/aliexpress-sign';
import { normalizeTelegramChatId } from '../common/crypto';

const ALI_API = 'https://api-sg.aliexpress.com/sync';

const UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/** Telegram's photo/album caption limit, in UTF-16 code units (JS string length). A
 *  plain sendMessage allows 4096; over this we split image + text into two messages. */
const TG_CAPTION_LIMIT = 1024;

/** Outcome of one campaign cycle — reported to the user instead of a blind "queued". */
export interface CampaignRunResult {
  /** Posts added to the auto-send queue (they publish per the schedule, not immediately). */
  queued: number;
  failed: number;
  /** The keyword as the user typed it. */
  keyword: string;
  /** What was actually sent to AliExpress (translated when the keyword wasn't Latin). */
  searched: string;
  errors: string[];
}

/**
 * Hebrew or Arabic in a search keyword. AliExpress indexes its catalog in English and
 * does NOT fail on a Hebrew keyword — it ignores it and returns arbitrary popular items,
 * which is the worst case: the campaign looks like it worked. Measured against the live
 * API: "חגורה טקטית" (tactical belt) returns kitchen scouring pads, while "tactical belt"
 * returns actual belts. Keywords matching this are translated before the query.
 */
const NON_LATIN_RE = /[\u0590-\u05FF\u0600-\u06FF]/;

/**
 * Convert Markdown bold (**x** / __x__) to Telegram HTML (<b>x</b>). Models often
 * emit Markdown even when asked for HTML; Telegram with parse_mode=HTML renders the
 * asterisks literally, so we normalise them to <b> (and strip stray ** that remain).
 */
// Telegram parse_mode=HTML supports only this small set of tags. We escape everything
// first (so a raw product title like "Cable <Type-C & Lightning>" can't break the
// parser) and then RESTORE these specific tags — the ones the AI is instructed to emit
// for formatting. Everything else stays safely escaped.
const TG_TAGS = 'b|strong|i|em|u|ins|s|strike|del|code|pre|blockquote|tg-spoiler';

/** True if every whitelisted opening tag has a matching closing tag, correctly nested. */
function tagsBalanced(html: string): boolean {
  const stack: string[] = [];
  const re = /<(\/?)([a-z-]+)(?:\s[^>]*)?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (closing) {
      if (stack.pop() !== tag) return false;
    } else {
      stack.push(tag);
    }
  }
  return stack.length === 0;
}

function mdBoldToHtml(s: string): string {
  if (!s) return s;
  const escaped = s
    // 1. Escape all HTML-special chars.
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // 2. Convert any Markdown bold the model still emits (inserted un-escaped → clean).
    .replace(/\*\*(.+?)\*\*/gs, '<b>$1</b>')
    .replace(/__(.+?)__/gs, '<b>$1</b>')
    .replace(/\*\*/g, '');
  // 3. Restore the Telegram-allowed formatting tags the model emits on purpose
  //    (they were escaped in step 1 → bring the whitelisted ones back).
  let out = escaped
    .replace(new RegExp(`&lt;(/?(?:${TG_TAGS}))&gt;`, 'gi'), '<$1>')
    .replace(/&lt;a href=(?:&quot;|")(.*?)(?:&quot;|")&gt;/gi, '<a href="$1">');

  // 4. Safety net: a product title containing a literal "<b>" (etc.) would restore
  //    to an UNBALANCED tag → Telegram rejects the whole message with a 400 and the
  //    post fails. If the result isn't valid, strip ALL formatting tags and send the
  //    escaped plain text — the post still goes out, just without bold.
  if (!tagsBalanced(out)) {
    out = escaped.replace(new RegExp(`&lt;/?(?:${TG_TAGS})&gt;`, 'gi'), '')
                 .replace(/&lt;\/?a[^&]*&gt;/gi, '');
  }
  return out.trim();
}

/** Prepared Telegram media for a post — computed once, reused across all target groups. */
type TgMedia =
  | { kind: 'buffers'; buffers: Buffer[] }   // uploaded album/photo (collage sheets or enhanced bytes)
  | { kind: 'album'; images: string[] }      // URL-based media group (>1 images)
  | { kind: 'single'; image: string };       // single photo by URL

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);
  /** Hebrew keyword → English search phrase. Deterministic, so one lookup per keyword. */
  private readonly keywordCache = new Map<string, string>();

  constructor(
    @InjectRepository(Post)
    private readonly repo: Repository<Post>,
    @InjectRepository(Template)
    private readonly templateRepo: Repository<Template>,
    @InjectRepository(Campaign)
    private readonly campaignRepo: Repository<Campaign>,
    private readonly credentials: CredentialsService,
    private readonly rates: RatesService,
    private readonly ai: AiService,
    private readonly subscription: SubscriptionService,
    private readonly channels: ChannelsService,
    private readonly collage: CollageService,
    private readonly coupons: CouponsService,
  ) {}

  /**
   * Splits a product's price into USD + local (₪) parts, respecting the product's
   * currency: search results now carry site-accurate TARGET-currency prices
   * (currency !== 'USD'), which must NOT be multiplied by the rate again.
   */
  private priceParts(product: any, rate: number): {
    saleUsd: number; origUsd: number; priceIls: number; localOverride?: number;
  } {
    const sale = product?.sale_price || 0;
    const orig = product?.original_price || 0;
    const converted = !!product?.currency && product.currency !== 'USD';
    return {
      saleUsd: converted && rate > 0 ? +(sale / rate).toFixed(2) : +sale.toFixed(2),
      origUsd: converted && rate > 0 ? +(orig / rate).toFixed(2) : +orig.toFixed(2),
      priceIls: converted ? +sale.toFixed(2) : +(sale * rate).toFixed(2),
      localOverride: converted ? sale : undefined,
    };
  }

  /**
   * Build a product object from the price/title the frontend already displayed, so a
   * quick/scheduled post keeps the REAL price + title. Previously, when the frontend
   * supplied an image (to avoid the unreliable keyword re-fetch), the product was left
   * null → the post was saved with an empty title and ₪0 price. We now trust the data
   * the UI already has instead of re-fetching. Returns null if nothing usable was sent.
   */
  private productFromData(d?: {
    title?: string; sale_price?: number; original_price?: number; currency?: string;
    discount_percent?: number; orders_count?: number; rating?: number;
  }): any | null {
    if (!d) return null;
    const sale = Number(d.sale_price) || 0;
    if (!d.title && sale <= 0) return null; // no title and no price → nothing to use
    return {
      title: d.title || '',
      sale_price: sale,
      original_price: Number(d.original_price) || sale,
      currency: d.currency || 'USD',
      discount_percent: Number(d.discount_percent) || 0,
      orders_count: Number(d.orders_count) || 0,
      rating: Number(d.rating) || 0,
    };
  }

  /**
   * Template content by id, scoped to the owner. Ids are only looked up when they are
   * UUID-shaped: `default_body_template_id` may hold the sentinel 'builtin_default',
   * and Postgres throws on a non-uuid literal compared against a uuid column.
   */
  private async templateContent(userId: string, id?: string | null): Promise<string> {
    if (!id || !UUID_RE.test(id)) return '';
    const t = await this.templateRepo.findOne({ where: { id, user_id: userId } });
    return t?.content?.trim() || '';
  }

  /** Resolve the user's default footer template content (appended to every post). */
  private getFooterText(userId: string, creds: DecryptedCredentials): Promise<string> {
    return this.templateContent(userId, creds?.default_footer_template_id);
  }

  /**
   * The BODY template content for a specific group — the copy style that group publishes
   * in (e.g. the "מאמא מותגים" hidden-product wording). Public so the FLYLINK campaign
   * runner can generate on-brand text for whichever group it posts to. Empty string when
   * the group has no body template (→ caller falls back to the built-in voice).
   */
  async resolveBodyTemplate(userId: string, channelId?: string): Promise<string> {
    if (!channelId) return '';
    const id = await this.channels.getBodyTemplateId(userId, channelId).catch(() => null);
    return this.templateContent(userId, id);
  }

  /** Bump a campaign's posts_count by one. Public so the FLYLINK runner (which lives in
   *  SupplierProductsService and has no Campaign repo) can keep the counter accurate. */
  async incrementCampaignPosts(campaignId: string): Promise<void> {
    await this.campaignRepo.increment({ id: campaignId }, 'posts_count', 1);
  }

  /**
   * The user's default BODY template — the writing style their hand-published posts use.
   * The composer sends the template down with each request; a campaign runs headless and
   * has no composer, so without this it silently fell back to the generic built-in voice.
   */
  private getBodyText(userId: string, creds: DecryptedCredentials): Promise<string> {
    return this.templateContent(userId, creds?.default_body_template_id);
  }

  /**
   * Footer for a post: when routed to a specific saved channel that has its OWN footer
   * template (each group has its own join link), use that; otherwise the global default.
   */
  private async resolveFooterText(userId: string, creds: DecryptedCredentials, channelOverride?: string): Promise<string> {
    if (channelOverride) {
      const id = await this.channels.getFooterTemplateId(userId, channelOverride);
      if (id) return this.templateContent(userId, id);
    }
    return this.getFooterText(userId, creds);
  }

  // ── List ──────────────────────────────────────────────────────────────────

  async list(userId: string, page = 1, limit = 20, status?: string, campaignId?: string, source?: string) {
    const qb = this.repo.createQueryBuilder('p')
      .leftJoin('p.campaign', 'c')
      .addSelect(['c.name'])
      .where('p.user_id = :userId', { userId })
      .orderBy('p.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (status) qb.andWhere('p.status = :status', { status });
    if (campaignId) qb.andWhere('p.campaign_id = :campaignId', { campaignId });
    // Product source is inferred from the affiliate link: FLYLINK posts link to
    // flylinking.com, everything else is AliExpress.
    if (source === 'flylink') qb.andWhere("p.affiliate_url ILIKE '%flylink%'");
    else if (source === 'aliexpress') qb.andWhere("(p.affiliate_url IS NULL OR p.affiliate_url NOT ILIKE '%flylink%')");

    const [raw, total] = await qb.getManyAndCount();
    const data = raw.map((p) => ({ ...p, campaign_name: p.campaign?.name ?? null }));
    return { data, total, page, limit };
  }

  // ── Preview ───────────────────────────────────────────────────────────────

  async preview(userId: string, productId: string, language = 'he', customProduct?: any, template?: string, images?: GenerateImage[], hint?: string, forceVision = false) {
    const creds = await this.credentials.getRaw(userId);
    const rate = await this.rates.getRate(creds?.currency_pair || 'USD_ILS');
    const product = customProduct || await this.searchProduct(productId, creds);

    const priceAlreadyConverted = product.currency && product.currency !== 'USD';
    const priceLocal = priceAlreadyConverted
      ? product.sale_price
      : +(product.sale_price * rate).toFixed(2);

    const text = await this.generateText(
      product, language, rate, creds,
      template || undefined,
      priceAlreadyConverted ? product.sale_price : undefined,
      images,
      hint,
      forceVision,
    );

    // The coupon line the send path WOULD append, so the composer shows what actually
    // ships. Returned separately rather than baked into generated_text on purpose: the
    // coupon is re-resolved at send time, so a code that expires while the post waits in
    // the queue is never delivered. Baking it into the text would freeze a stale code.
    // Mirror the send path's AliExpress-only rule: no coupon preview for a FLYLINK/other link.
    const priceUsd = priceAlreadyConverted && rate > 0
      ? +(product.sale_price / rate).toFixed(2)
      : product.sale_price;
    const previewLink = String(product.affiliate_url || product.product_url || '');
    const isFlylinkProduct = /flylink/i.test(previewLink);
    const match = isFlylinkProduct
      ? null
      : await this.coupons.bestFor(userId, priceUsd).catch(() => null);

    return {
      product,
      generated_text: text,
      price_ils: customProduct?.price_ils ?? priceLocal,
      exchange_rate: priceAlreadyConverted ? 1 : rate,
      coupon_line: match ? this.coupons.couponLine(match.coupon, match.qualifies) : null,
    };
  }

  // ── Quick post ────────────────────────────────────────────────────────────

  async quickPost(
    userId: string,
    productId: string,
    textOverride?: string,
    channelOverride?: string,
    productImageOverride?: string,   // image URL already known by frontend — avoids wrong re-fetch
    affiliateUrlOverride?: string,   // affiliate link already fetched by frontend
    productData?: Parameters<PostsService['productFromData']>[0], // price/title from the frontend
    channels?: string[],             // target group(s) — fan out to several at once (1 credit)
  ) {
    const creds = await this.credentials.getRaw(userId);
    const rate = await this.rates.getRate(creds?.currency_pair || 'USD_ILS');

    // Prefer the price/title the frontend already has; otherwise fetch (only when no
    // image was supplied). This keeps the real price instead of a ₪0 / empty-title post.
    const product = this.productFromData(productData)
      || (productImageOverride ? null : await this.searchProduct(productId, creds));

    const affiliateUrl = affiliateUrlOverride
      || await this.getAffiliateLink(productId, creds);

    const parts = this.priceParts(product, rate);
    const text = textOverride || await this.generateText(
      product || { title: productId, sale_price: 0, original_price: 0, discount_percent: 0, orders_count: 0, rating: 0, currency: 'USD' },
      'he', rate, creds, undefined, parts.localOverride,
    );

    const post = this.repo.create({
      user_id: userId,
      product_id: productId,
      product_title: product?.title || '',
      product_image: productImageOverride || product?.image_url || '',
      affiliate_url: affiliateUrl,
      original_price_usd: parts.origUsd,
      sale_price_usd: parts.saleUsd,
      price_ils: product ? parts.priceIls : 0,
      generated_text: text,
      status: 'pending',
    });
    this.applyChannels(post, channels, channelOverride);

    await this.repo.save(post);
    await this.sendToTelegram(post, creds, channelOverride);
    return post;
  }

  // ── Schedule post ─────────────────────────────────────────────────────────

  async schedulePost(
    userId: string,
    productId: string,
    scheduledAt: Date,
    textOverride?: string,
    channelOverride?: string,
    productImageOverride?: string,
    affiliateUrlOverride?: string,
    productData?: Parameters<PostsService['productFromData']>[0],
    channels?: string[],             // target group(s) — fan out to several at once (1 credit)
  ) {
    const creds = await this.credentials.getRaw(userId);
    const rate = await this.rates.getRate(creds?.currency_pair || 'USD_ILS');

    const product = this.productFromData(productData)
      || (productImageOverride ? null : await this.searchProduct(productId, creds));

    const affiliateUrl = affiliateUrlOverride
      || await this.getAffiliateLink(productId, creds);

    const parts = this.priceParts(product, rate);
    const text = textOverride || await this.generateText(
      product || { title: productId, sale_price: 0, original_price: 0, discount_percent: 0, orders_count: 0, rating: 0, currency: 'USD' },
      'he', rate, creds, undefined, parts.localOverride,
    );

    const post = this.repo.create({
      user_id: userId,
      product_id: productId,
      product_title: product?.title || '',
      product_image: productImageOverride || product?.image_url || '',
      affiliate_url: affiliateUrl,
      original_price_usd: parts.origUsd,
      sale_price_usd: parts.saleUsd,
      price_ils: product ? parts.priceIls : 0,
      generated_text: text,
      status: 'scheduled',
      scheduled_at: scheduledAt,
    });
    this.applyChannels(post, channels, channelOverride);

    await this.repo.save(post);
    return post;
  }

  // ── Generic custom publish (used by the suppliers module) ─────────────────
  //
  // A fully-formed post from a non-AliExpress source: caller supplies the final
  // text, image(s), affiliate link and target channel. Reuses the shared queue /
  // scheduler / Telegram pipeline (incl. the media-group album for multiple images).

  private buildCustomPost(userId: string, data: {
    productId: string; title: string; image: string; images?: string[];
    affiliateUrl: string; text: string; priceIls?: number; channelOverride?: string;
    channels?: string[]; // target group(s) — fan out to several at once (1 credit)
    collageCells?: number; // when set, images are composed into collage sheets (allows up to 30 images)
  }): Post {
    // A normal album caps at 10 images; a collage post can carry up to 30 source images
    // (composed into ≤10 sheets at send time).
    const cap = data.collageCells ? 30 : 10;
    const post = this.repo.create({
      user_id: userId,
      product_id: data.productId,
      product_title: data.title,
      product_image: data.image,
      affiliate_url: data.affiliateUrl,
      original_price_usd: 0,
      sale_price_usd: 0,
      price_ils: data.priceIls || 0,
      generated_text: data.text,
      channel_override: data.channelOverride || null,
      gallery_json: data.images && data.images.length > 1 ? JSON.stringify(data.images.slice(0, cap)) : null,
      collage_cells: data.collageCells || null,
    });
    this.applyChannels(post, data.channels, data.channelOverride);
    return post;
  }

  /** Send a custom post immediately. */
  async sendCustomNow(userId: string, data: Parameters<PostsService['buildCustomPost']>[1]): Promise<Post> {
    const creds = await this.credentials.getRaw(userId);
    const post = this.buildCustomPost(userId, data);
    post.status = 'pending';
    await this.repo.save(post);
    // sendToTelegram swallows channel errors and marks the post 'failed' — surface that
    // to the caller so the UI shows the real reason instead of a false "sent".
    await this.sendToTelegram(post, creds, data.channelOverride);
    if ((post.status as string) === 'failed') {
      let msg = post.error_message || 'השליחה נכשלה';
      if (/chat not found/i.test(msg)) {
        msg += ' — ודא שהבוט של הקבוצה הזו הוא אדמין בה, ושמזהה הקבוצה נכון (הגדרות ← קבוצות ← בדיקת חיבור)';
      }
      throw new BadRequestException(msg);
    }
    return post;
  }

  /** Schedule a custom post for a specific time. */
  async scheduleCustom(userId: string, data: Parameters<PostsService['buildCustomPost']>[1], scheduledAt: Date): Promise<Post> {
    const post = this.buildCustomPost(userId, data);
    post.status = 'scheduled';
    post.scheduled_at = scheduledAt;
    return this.repo.save(post);
  }

  // ── Queue post (add to auto-send queue) ──────────────────────────────────

  async createQueuedPost(
    userId: string,
    product: {
      product_id: string;
      title: string;
      image_url: string;
      affiliate_url: string;
      sale_price: number;
      original_price: number;
      currency: string;
      discount_percent: number;
      orders_count: number;
      rating: number;
    },
    catalogProductId?: string,
    textOverride?: string,
    channelOverride?: string,
    images?: string[],
    collageCells?: number,
    channels?: string[],             // target group(s) — fan out to several at once (1 credit)
    /**
     * When `scheduledAt` is set the post is SCHEDULED (published at that time by the
     * scheduled-posts cron) instead of QUEUED (paced by the global queue interval). Used
     * by campaigns, whose own cron is the cadence — see runCampaign / runFlylinkCampaign.
     * `campaignId` links the post back to its campaign.
     */
    opts?: { scheduledAt?: Date; campaignId?: string },
  ): Promise<Post> {
    const creds = await this.credentials.getRaw(userId);

    // Unify queues per chat: if this post has no explicit group AND the user's default
    // channel is itself a saved group, route it into THAT group's bucket. Otherwise the
    // default bucket and the group bucket are two queues for one chat, which double-posts.
    // Same destination either way — only the queue it lives in changes.
    if (!channelOverride && !(channels && channels.length) && creds?.telegram_channel_id) {
      const group = await this.channels.groupIdForChat(userId, creds.telegram_channel_id).catch(() => null);
      if (group) channelOverride = group;
    }

    const currencyPair = creds?.currency_pair || 'USD_ILS';
    const rate = await this.rates.getRate(currencyPair);

    // Products from discovery/catalog carry prices ALREADY in the target currency (₪).
    // A missing currency must NOT default to USD — that would multiply an ILS price by
    // the rate (₪31 → ₪114). Assume the user's target currency when unspecified.
    const targetCcy = currencyPair.split('_')[1] || 'ILS';
    if (!product.currency) product.currency = targetCcy;

    const priceAlreadyConverted = product.currency && product.currency !== 'USD';
    const priceIls = priceAlreadyConverted
      ? product.sale_price
      : +(product.sale_price * rate).toFixed(2);

    // Keep the *_usd columns denominated in USD. When the incoming price is already in the
    // target currency (₪), back-convert to USD instead of storing ₪ in a *_usd field —
    // otherwise every profit/earnings figure derived from these columns is off by ~1/rate.
    const saleUsd = priceAlreadyConverted && rate > 0
      ? +(product.sale_price / rate).toFixed(2)
      : product.sale_price;
    const origUsd = priceAlreadyConverted && rate > 0
      ? +(product.original_price / rate).toFixed(2)
      : product.original_price;

    // When the caller already has final text (e.g. the quick-post review screen),
    // use it as-is — don't spend AI credits generating a second version.
    const text = textOverride?.trim() || await this.generateText(
      product as any,
      'he',
      rate,
      creds,
      undefined,
      priceAlreadyConverted ? product.sale_price : undefined,
    );

    const scheduled = !!opts?.scheduledAt;

    // Next queue_order — only relevant for queued posts (scheduled ones publish by time).
    let nextOrder = 0;
    if (!scheduled) {
      const maxOrderResult = await this.repo
        .createQueryBuilder('p')
        .select('MAX(p.queue_order)', 'maxOrder')
        .where('p.user_id = :userId AND p.status = :status', { userId, status: 'queued' })
        .getRawOne();
      nextOrder = (maxOrderResult?.maxOrder ?? -1) + 1;
    }

    const post = this.repo.create({
      user_id: userId,
      campaign_id: opts?.campaignId,
      product_id: product.product_id,
      product_title: product.title,
      product_image: product.image_url,
      affiliate_url: product.affiliate_url,
      original_price_usd: origUsd,
      sale_price_usd: saleUsd,
      price_ils: priceIls,
      generated_text: text,
      // Scheduled → publishes at scheduled_at (campaign cron cadence). Queued → paced by
      // the global queue interval.
      status: scheduled ? 'scheduled' : 'queued',
      queue_order: scheduled ? undefined : nextOrder,
      scheduled_at: opts?.scheduledAt,
      catalog_product_id: catalogProductId,
      channel_override: channelOverride || null,
      // Extra images (product colors/variants) beyond the main one → sent as a
      // Telegram media group (swipeable album) instead of spamming separate posts.
      // Collage posts carry up to 30 source images (composed into ≤10 sheets at send).
      gallery_json: images && images.length > 1 ? JSON.stringify(images.slice(0, collageCells ? 30 : 10)) : null,
      collage_cells: collageCells || null,
    });
    this.applyChannels(post, channels, channelOverride);

    const saved = await this.repo.save(post);
    // Only queued posts ride the interval clock; scheduled posts publish by their own time.
    if (!scheduled) await this.primeQueueClock(userId, saved, creds);
    return saved;
  }

  /**
   * Stop a just-queued post from firing on the very next scheduler tick. If the send clock
   * for its target(s) is stale, the queue gate would treat it as immediately due — which
   * users experience as "it published instead of queueing". Priming the clock to now makes
   * the first queued post wait one interval; an active drip is left untouched. Best-effort:
   * a failure here must never block the enqueue itself.
   */
  private async primeQueueClock(userId: string, post: Post, creds: DecryptedCredentials | null): Promise<void> {
    const now = new Date();
    const interval = creds?.schedule_interval_minutes ?? 60;
    const targets = this.resolveTargets(post).filter((t): t is string => !!t);
    try {
      if (targets.length) {
        await this.channels.primeScheduleIfStale(userId, targets, now, interval);
      } else {
        // Default bucket (no group) runs off the user's global clock.
        const last = creds?.schedule_last_sent_at ? new Date(creds.schedule_last_sent_at).getTime() : 0;
        if (!last || (now.getTime() - last) / 60_000 >= interval) {
          await this.credentials.updateLastSent(userId, now);
        }
      }
    } catch (err: any) {
      this.logger.warn(`primeQueueClock failed for post ${post.id}: ${err.message}`);
    }
  }

  /**
   * Sends the next queued post for a user. Returns:
   *  • { sent: false } when the queue is empty (nothing consumed)
   *  • { sent: true, ok: true }  on a successful publish
   *  • { sent: true, ok: false, error } when a post was consumed but publishing failed
   * sendToTelegram swallows channel errors and marks the post 'failed', so we surface
   * that outcome here instead of always reporting success.
   */
  async processNextQueuedPost(
    userId: string,
    /**
     * Which queue bucket to pull from — each GROUP has its own queue so one group's
     * backlog can't consume another's send slots:
     *  • a channel_id → only posts routed to that group
     *  • null         → only posts with no group (the default-channel queue)
     *  • undefined    → any post (legacy/global behaviour)
     */
    bucket?: string | null,
    /**
     * Normalized chat ids already sent to in THIS scheduler tick. If the head post would
     * hit any of them it is DEFERRED (left queued) instead of sent, so no single Telegram
     * chat ever receives two posts in one tick — the case where the default channel is
     * ALSO a saved group, or a fan-out post re-hits a group already served this tick.
     */
    excludeChats?: Set<string>,
  ): Promise<{ sent: boolean; ok?: boolean; error?: string; targets?: string[]; chats?: string[]; deferred?: boolean }> {
    const qb = this.repo
      .createQueryBuilder('p')
      .where('p.user_id = :userId AND p.status = :status', { userId, status: 'queued' });
    if (bucket === null) qb.andWhere('p.channel_override IS NULL');
    else if (typeof bucket === 'string') qb.andWhere('p.channel_override = :bucket', { bucket });

    const next = await qb
      .orderBy('p.queue_order', 'ASC')
      .addOrderBy('p.created_at', 'ASC')
      .getOne();

    if (!next) return { sent: false };

    // Every group this post actually reaches — a multi-group post must advance the clock
    // of ALL of them, or the other groups would get it for free and still keep their slot.
    const targets = this.resolveTargets(next).filter((t): t is string => !!t);

    const creds = await this.credentials.getRaw(userId);

    // The ACTUAL Telegram chats this post lands in. A group post → its target channel_ids;
    // a default post (no group) → the user's default channel. Normalized so a bare id and
    // a -100-prefixed id compare equal.
    const chats = (targets.length ? targets : [creds?.telegram_channel_id])
      .map((c) => (c ? normalizeTelegramChatId(c) : ''))
      .filter(Boolean) as string[];

    // Would this send double-post a chat already served this tick? Leave it queued.
    if (excludeChats && chats.some((c) => excludeChats.has(c))) {
      return { sent: false, deferred: true, chats };
    }

    next.status = 'pending';
    await this.repo.save(next);
    // Route to the post's target group if set (supplier products / per-catalog channel).
    await this.sendToTelegram(next, creds, next.channel_override || undefined);
    // sendToTelegram mutates next.status in place ('sent' | 'failed'); TS still sees the
    // 'pending' we assigned above, so compare via a widened string.
    return { sent: true, ok: (next.status as string) === 'sent', error: next.error_message || undefined, targets, chats };
  }

  /**
   * One-click "add to queue" from the review screen: stores the (already generated)
   * post in the auto-send queue — the scheduler picks the send time automatically
   * from the user's window/interval settings. Also reports whether the queue is
   * actually enabled so the UI can warn instead of silently swallowing the post.
   */
  async addToQueue(
    userId: string,
    product: {
      product_id: string; title: string; image_url: string; affiliate_url: string;
      sale_price: number; original_price: number; currency: string;
      discount_percent: number; orders_count: number; rating: number;
    },
    text?: string,
    channels?: string[],
  ) {
    const post = await this.createQueuedPost(userId, product, undefined, text, channels?.[0], undefined, undefined, channels);
    const creds = await this.credentials.getRaw(userId);
    return {
      post,
      queue_active: creds?.schedule_enabled === true,
      interval_minutes: creds?.schedule_interval_minutes ?? 60,
      window_start: creds?.schedule_start_hour ?? 9,
      window_end: creds?.schedule_end_hour ?? 22,
    };
  }

  /** Removes a post from the queue */
  async dequeue(userId: string, postId: string): Promise<Post> {
    const post = await this.repo.findOne({ where: { id: postId, user_id: userId, status: 'queued' } });
    if (!post) throw new NotFoundException('Post not found in queue');
    await this.repo.remove(post);
    return post;
  }

  /** Delete any post (queued / scheduled / sent / failed) — from the posts screen. */
  async deletePost(userId: string, postId: string): Promise<{ deleted: boolean }> {
    const post = await this.repo.findOne({ where: { id: postId, user_id: userId } });
    if (!post) throw new NotFoundException('פוסט לא נמצא');
    await this.repo.remove(post);
    return { deleted: true };
  }

  /** Full post edit: text, title, price, image, affiliate link, and/or scheduled time.
   * (Editing an already-sent post does not change the live Telegram/FB message — the
   * new values apply to a later retry / re-queue.) */
  async updatePost(userId: string, postId: string, dto: {
    text?: string; scheduled_at?: string;
    product_title?: string; price_ils?: number; product_image?: string; affiliate_url?: string;
  }): Promise<Post> {
    const post = await this.repo.findOne({ where: { id: postId, user_id: userId } });
    if (!post) throw new NotFoundException('פוסט לא נמצא');
    if (typeof dto.text === 'string') post.generated_text = dto.text;
    if (typeof dto.product_title === 'string') post.product_title = dto.product_title;
    if (typeof dto.product_image === 'string' && dto.product_image.trim()) post.product_image = dto.product_image.trim();
    if (typeof dto.affiliate_url === 'string') post.affiliate_url = dto.affiliate_url.trim();
    if (dto.price_ils !== undefined && dto.price_ils !== null) {
      const p = Number(dto.price_ils);
      if (Number.isFinite(p) && p >= 0) post.price_ils = p;
    }
    if (dto.scheduled_at) {
      post.scheduled_at = new Date(dto.scheduled_at);
      if (post.status === 'failed') post.status = 'scheduled'; // reschedule a failed post
    }
    return this.repo.save(post);
  }

  /** Lists all queued posts for a user in order */
  async listQueue(userId: string): Promise<Post[]> {
    return this.repo
      .createQueryBuilder('p')
      .where('p.user_id = :userId AND p.status = :status', { userId, status: 'queued' })
      .orderBy('p.queue_order', 'ASC')
      .addOrderBy('p.created_at', 'ASC')
      .getMany();
  }

  // ── Due scheduled posts (called by cron) ──────────────────────────────────

  async findDueScheduledPosts(): Promise<Post[]> {
    const due = await this.repo
      .createQueryBuilder('p')
      .where('p.status = :status', { status: 'scheduled' })
      .andWhere('p.scheduled_at <= :now', { now: new Date() })
      .orderBy('p.scheduled_at', 'ASC')
      .getMany();

    // Drip, don't flood: release at most ONE overdue post per destination group per tick.
    // When the server wakes from sleep (free tier) with a backlog of overdue posts, sending
    // them all at once dumped a burst into a single group at, e.g., 6am. The every-minute
    // cron still drains the backlog quickly — just one post per group per minute, spaced —
    // instead of all at once. A post with no override drips on the 'default' key.
    const seen = new Set<string>();
    const picked: Post[] = [];
    for (const p of due) {
      const key = `${p.user_id}::${p.channel_override || 'default'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(p);
    }
    return picked;
  }

  async sendScheduled(post: Post) {
    const creds = await this.credentials.getRaw(post.user_id);
    post.status = 'pending';
    await this.repo.save(post);
    await this.sendToTelegram(post, creds, post.channel_override || undefined);
    // Share ONE clock per group. Scheduled (campaign) posts and the manual auto-send queue
    // used to run on SEPARATE clocks, so a manually-queued post fired in-between the autopilot
    // posts. Advancing the group's queue clock here — the same one processQueue checks — makes
    // a manual post wait a full interval after this post, so everything to the group interleaves
    // one per interval. null override = the default channel → the account's global clock.
    const now = new Date();
    if (post.channel_override) {
      await this.channels.markSent(post.user_id, [post.channel_override], now).catch(() => {});
    } else {
      await this.credentials.updateLastSent(post.user_id, now).catch(() => {});
    }
  }

  // ── Run campaign ──────────────────────────────────────────────────────────

  /** Current hour (0-23) in the given IANA timezone, DST-aware. */
  private hourInZone(date: Date, tz: string): number {
    try {
      const h = new Intl.DateTimeFormat('en-US', { hour: '2-digit', hour12: false, timeZone: tz }).format(date);
      const n = parseInt(h, 10);
      return n === 24 ? 0 : n;
    } catch { return date.getHours(); }
  }

  /**
   * Publish times for ONE campaign run of `count` posts. The campaign's own cron is the
   * cadence, so the run's posts go out starting NOW — NOT re-paced by the global queue
   * interval, which is what made a "every 3h" campaign publish hourly. Extra posts in a
   * single run are spaced 15 min apart. The first time is clamped into the user's send
   * window so a cron that fires at night still posts in the morning.
   */
  campaignScheduleTimes(
    count: number,
    creds: DecryptedCredentials | null,
    window?: { startHour?: number | null; endHour?: number | null },
  ): Date[] {
    const tz = process.env.SCHEDULER_TZ || 'Asia/Jerusalem';
    // A campaign targeting a specific group publishes in THAT group's window when it has one,
    // falling back to the account's global window, then to 9–22. This is why a group campaign
    // no longer fires at, say, 6am just because the global default did.
    const startHour = window?.startHour ?? creds?.schedule_start_hour ?? 9;
    const endHour = window?.endHour ?? creds?.schedule_end_hour ?? 22;
    const gapMs = 15 * 60_000;

    let first = new Date();
    if (startHour < endHour) {
      // Walk forward hour by hour (DST-safe) until we land inside the window.
      for (let i = 0; i < 24; i++) {
        const h = this.hourInZone(first, tz);
        if (h >= startHour && h < endHour) break;
        first = new Date(first.getTime() + 60 * 60_000);
      }
    }
    const times: Date[] = [];
    for (let i = 0; i < Math.max(1, count); i++) times.push(new Date(first.getTime() + i * gapMs));
    return times;
  }

  /** The distinct product_ids this campaign has already posted (any status) — the explicit
   *  dedup signal the runners use so a campaign cycles through its catalog before repeating. */
  async postedProductIds(campaignId: string): Promise<Set<string>> {
    const rows = await this.repo.createQueryBuilder('p')
      .select('DISTINCT p.product_id', 'product_id')
      .where('p.campaign_id = :cid', { cid: campaignId })
      .getRawMany();
    return new Set(rows.map((r) => String(r.product_id)));
  }

  /**
   * Run one campaign cycle: pick a keyword → find products → write → publish.
   *
   * Throws on every condition that yields no post (no credentials, no keywords, no
   * matching products). The caller decides what to do with that: the scheduler logs it
   * and emails the owner, "run now" shows it. It must never resolve quietly on failure —
   * a campaign that publishes nothing has to say so.
   */
  /**
   * Is NOW inside the campaign's send window (its target group's hours, else the account's,
   * else 9–22)? A SCHEDULED run outside the window must be a no-op: otherwise every overnight
   * hourly run creates a post clamped to the window-open time, and they all pile up and burst
   * the moment the window opens (the "6am flood"). A manual "run now" ignores this.
   */
  async isCampaignWindowOpen(userId: string, campaign: Campaign, creds?: DecryptedCredentials | null): Promise<boolean> {
    // Resolve the window from the SAME source the scheduled_at clamp uses: the target group's
    // hours, else the account's, else 9–22. Fetch creds if the caller didn't pass them.
    const c = creds !== undefined ? creds : await this.credentials.getRaw(userId).catch(() => null);
    const targets = this.parseTargetChannels(campaign.target_channels);
    const window = targets.length
      ? await this.channels.getScheduleWindow(userId, targets[0]).catch(() => null)
      : null;
    const startHour = window?.startHour ?? c?.schedule_start_hour ?? 9;
    const endHour = window?.endHour ?? c?.schedule_end_hour ?? 22;
    if (startHour >= endHour) return true; // 24h / misconfigured window → never block
    const tz = process.env.SCHEDULER_TZ || 'Asia/Jerusalem';
    const h = this.hourInZone(new Date(), tz);
    return h >= startHour && h < endHour;
  }

  /**
   * Place a new post to `groupId` in that group's NEXT FREE slot: spaced by the group's
   * interval from the latest pending (scheduled/queued) post ALREADY targeting the group —
   * from ANY campaign or source. Returns { slot, skip }; skip=true when the group is already
   * booked within the current interval, so two campaigns to one group never post together and
   * the group publishes at most once per its interval (the group's setting is the rate).
   */
  async nextGroupSlot(userId: string, groupId: string, notBefore: Date): Promise<{ slot: Date; skip: boolean }> {
    const intervalMin = (await this.channels.getIntervalMinutes(userId, groupId).catch(() => null)) ?? 60;
    const row = await this.repo.createQueryBuilder('p')
      .select('MAX(p.scheduled_at)', 'max')
      .where('p.user_id = :userId', { userId })
      .andWhere("p.status IN ('scheduled','queued')")
      // A post targets the group via channel_override (single) OR channel_overrides (JSON
      // array of quoted ids) — match both. Quotes make the LIKE exact (no substring bleed).
      .andWhere('(p.channel_override = :g OR p.channel_overrides LIKE :like)', { g: groupId, like: `%"${groupId}"%` })
      .getRawOne();
    const latestMs = row?.max ? new Date(row.max).getTime() : 0;
    if (!latestMs) return { slot: notBefore, skip: false };
    const slotMs = Math.max(latestMs + intervalMin * 60_000, notBefore.getTime());

    // Skip when the group is already booked: either the next slot is more than one interval
    // out, OR it falls outside the group's send window (so a post never lands at night). The
    // group's next in-window run creates it fresh instead.
    const bookedAhead = slotMs > Date.now() + intervalMin * 60_000;
    const win = await this.channels.getScheduleWindow(userId, groupId).catch(() => null);
    const creds = await this.credentials.getRaw(userId).catch(() => null);
    const startHour = win?.startHour ?? creds?.schedule_start_hour ?? 9;
    const endHour = win?.endHour ?? creds?.schedule_end_hour ?? 22;
    const tz = process.env.SCHEDULER_TZ || 'Asia/Jerusalem';
    const slotHour = this.hourInZone(new Date(slotMs), tz);
    const outOfWindow = startHour < endHour && (slotHour < startHour || slotHour >= endHour);

    return { slot: new Date(slotMs), skip: bookedAhead || outOfWindow };
  }

  async runCampaign(campaign: Campaign, userId: string, opts?: { fromScheduler?: boolean }): Promise<CampaignRunResult> {
    const creds = await this.credentials.getRaw(userId);
    if (!creds) throw new BadRequestException('חסרים פרטי חיבור — הגדר אותם במסך ההגדרות');

    // Skip scheduled runs outside the send window so overnight runs don't pile up at open.
    if (opts?.fromScheduler && !(await this.isCampaignWindowOpen(userId, campaign, creds))) {
      return { queued: 0, failed: 0, keyword: '', searched: '', errors: ['מחוץ לחלון הפרסום — דילוג'] };
    }

    const rate = await this.rates.getRate(creds.currency_pair || 'USD_ILS');
    // Round-robin through the keywords so EVERY keyword gets equal airtime and consecutive
    // runs use a different one — random selection over-used some and rarely touched others
    // (the "it ignores my keywords / repeats the same things" complaint). Advance the cursor
    // immediately (before the search) so a dead/empty keyword is skipped next run, not stuck on.
    const kwIndex = (campaign.keyword_cursor ?? 0) % campaign.keywords.length;
    const keyword = campaign.keywords[kwIndex];
    this.campaignRepo.increment({ id: campaign.id }, 'keyword_cursor', 1).catch(() => {});
    if (!keyword?.trim()) throw new BadRequestException('לקמפיין אין מילות מפתח');

    const searched = await this.searchKeyword(keyword, creds);

    // Fetch a wide net (x10) so we have room to skip products this campaign already posted.
    // A rotating page walks DEEPER into the results over time — AliExpress returns the same
    // top-by-volume items on page 1 every run, but has thousands of matches (measured:
    // 2,500–3,700 for these keywords). A random page 1-6 keeps surfacing fresh products for
    // effectively ever; page 1 is the fallback for sparse keywords (few results).
    const pageSize = Math.min(50, Math.max(20, campaign.posts_per_run * 10));
    const page = 1 + Math.floor(Math.random() * 6);
    let found = await this.searchProducts({
      keyword: searched, category_id: campaign.category_id,
      min_price: campaign.min_price, max_price: campaign.max_price,
      min_discount: campaign.min_discount, limit: pageSize, page,
    }, creds);
    // Sparse keyword or an over-deep page came back thin → fall back to the top page.
    if (found.length < campaign.posts_per_run && page !== 1) {
      found = await this.searchProducts({
        keyword: searched, category_id: campaign.category_id,
        min_price: campaign.min_price, max_price: campaign.max_price,
        min_discount: campaign.min_discount, limit: pageSize, page: 1,
      }, creds);
    }

    if (!found.length) {
      const via = searched !== keyword ? ` (חיפוש באנגלית: "${searched}")` : '';
      throw new BadRequestException(
        `לא נמצאו מוצרים עבור "${keyword}"${via}. נסה מילת מפתח אחרת או הרחב את טווח המחירים (${campaign.min_price ?? 0}–${campaign.max_price ?? '∞'}).`,
      );
    }

    // Quality filters enforced HERE, not by the API: product.query has no rating param,
    // and (as discovered) its min_discount param is a no-op — so both are applied to the
    // fetched page. rating comes from each product's evaluate_rate (0–5). If the filter
    // rejects everything, fail loudly with the thresholds rather than posting off-spec
    // products the user explicitly filtered out.
    const minRating = campaign.min_rating ?? 0;
    const minDiscount = campaign.min_discount ?? 0;
    const qualified = found.filter((p) =>
      (minRating <= 0 || (p.rating || 0) >= minRating) &&
      (minDiscount <= 0 || (p.discount_percent || 0) >= minDiscount),
    );
    if (!qualified.length) {
      const bits: string[] = [];
      if (minRating > 0) bits.push(`דירוג ≥ ${minRating}★`);
      if (minDiscount > 0) bits.push(`הנחה ≥ ${minDiscount}%`);
      throw new BadRequestException(
        `נמצאו ${found.length} מוצרים עבור "${keyword}", אבל אף אחד לא עומד בסינון (${bits.join(', ')}). הורד את הסף או נסה מילת מפתח אחרת.`,
      );
    }

    // Skip products this campaign has already posted — the search returns the same
    // top-by-volume items every run, so without this the campaign kept re-posting them.
    // Fall back to the full qualified list only if EVERY candidate was already used
    // (better a repeat than nothing) — but never fall back past the quality filters.
    const postedIds = new Set(
      (await this.repo.createQueryBuilder('p')
        .select('DISTINCT p.product_id', 'product_id')
        .where('p.campaign_id = :cid', { cid: campaign.id })
        .getRawMany()).map((r) => String(r.product_id)),
    );
    const fresh = qualified.filter((p) => !postedIds.has(String(p.product_id)));
    const pool = fresh.length ? fresh : qualified;

    // A campaign runs headless — nothing hands it a template the way the composer does.
    // Fall back to the user's default body template so campaign posts are written in the
    // same voice as the ones they publish by hand, instead of the generic built-in one.
    const template = campaign.post_template?.trim() || await this.getBodyText(userId, creds);

    const toPost = pool.slice(0, campaign.posts_per_run);
    const result: CampaignRunResult = { queued: 0, failed: 0, keyword, searched, errors: [] };

    // Which group(s) this campaign publishes to. An AliExpress campaign can now target
    // specific groups (like FLYLINK) — its posts go ONLY there, isolated from other groups.
    // Empty = the account's default channel (legacy behaviour, unchanged).
    const targets = this.parseTargetChannels(campaign.target_channels);

    // Publish times for THIS run — the campaign's own cron is the cadence, so posts go out
    // now (spaced 15 min for multi-post runs), NOT re-paced by the global queue interval.
    // Scheduled inside the TARGET group's send window when it has one, so a group campaign
    // posts in that group's hours instead of a global default.
    const window = targets.length
      ? await this.channels.getScheduleWindow(userId, targets[0]).catch(() => null)
      : null;
    const times = this.campaignScheduleTimes(toPost.length, creds, window || undefined);

    let skipped = 0;
    for (let i = 0; i < toPost.length; i++) {
      const product = toPost[i];
      try {
        // Per-group pacing: place the post in the group's next free slot (spaced by the
        // group's interval from any pending post to it, any source). On a SCHEDULED run,
        // if the group is already booked this interval, skip — so two campaigns to one
        // group never collide and the group publishes at most 1/interval. Each post is
        // saved before the next iteration, so successive posts chain off each other.
        let scheduledAt = times[i];
        if (targets.length) {
          const { slot, skip } = await this.nextGroupSlot(userId, targets[0], times[i]);
          if (skip && opts?.fromScheduler) { skipped++; continue; }
          scheduledAt = slot;
        }
        // Always resolve a SHORT affiliate link via link.generate (~42 chars, per-product,
        // tracked). The promotion_link that product.query returns is a broken 1065-char
        // link — identical across products AND over Telegram's 1024 caption limit — which
        // is exactly what made these posts fail. Do NOT prefer it.
        const affiliateUrl = await this.getAffiliateLink(product.product_id, creds);
        const parts = this.priceParts(product, rate);
        const text = await this.generateText(product, campaign.language, rate, creds, template || undefined, parts.localOverride);

        // SCHEDULE at the campaign's cadence (not the shared queue) so an "every 3h"
        // campaign publishes every 3h instead of being re-paced to the 60-min queue interval.
        const post = this.repo.create({
          user_id: userId,
          campaign_id: campaign.id,
          product_id: product.product_id,
          product_title: product.title,
          product_image: product.image_url,
          affiliate_url: affiliateUrl,
          original_price_usd: parts.origUsd,
          sale_price_usd: parts.saleUsd,
          price_ils: parts.priceIls,
          generated_text: text,
          status: 'scheduled',
          scheduled_at: scheduledAt,
        });
        // Route to the campaign's target group(s). Without this the post carries no
        // channel_override and the scheduled-send cron delivers it to the DEFAULT channel —
        // which is exactly how an ALI4YOU campaign leaked into טקטי בקליק.
        if (targets.length) this.applyChannels(post, targets);

        await this.repo.save(post);
        result.queued++;
        // posts_count drives the "N פוסטים" figure on the campaign screen. Nothing ever
        // incremented it, so it read 0 forever. Count at enqueue time — the post is now
        // committed to go out.
        await this.campaignRepo.increment({ id: campaign.id }, 'posts_count', 1);
      } catch (err: any) {
        // One product failing (dead link, AI hiccup) must not abort the rest of the run.
        result.failed++;
        result.errors.push(`${product.title?.slice(0, 40) || product.product_id}: ${err.message}`);
        this.logger.warn(`Campaign ${campaign.id} product ${product.product_id} failed: ${err.message}`);
      }
    }

    // Skipping because the group is already booked this interval is a legitimate no-op, not
    // a failure — only throw when nothing was queued AND nothing was intentionally skipped.
    if (!result.queued && !skipped) throw new BadRequestException(result.errors.join(' | ') || 'הרצת הקמפיין לא יצרה פוסטים');
    return result;
  }

  /**
   * The keyword to actually send to AliExpress. Hebrew/Arabic keywords are translated to
   * English first — see NON_LATIN_RE: the API silently returns unrelated products for
   * them rather than erroring. Cached per process; the translation is deterministic and
   * campaigns reuse the same handful of keywords. Falls back to the original keyword
   * whenever AI is unavailable or misbehaves — no worse than today's behaviour.
   */
  private async searchKeyword(keyword: string, creds: DecryptedCredentials): Promise<string> {
    const kw = keyword.trim();
    if (!NON_LATIN_RE.test(kw)) return kw;

    const cached = this.keywordCache.get(kw);
    if (cached) return cached;
    if (!this.ai.hasAnyKey(creds)) return kw;

    try {
      const res = await this.ai.generate(creds, {
        system: 'You convert a shopping keyword into the English search phrase AliExpress would index it under. '
          + 'Reply with ONLY that phrase: 2-4 words, lowercase, no quotes, no punctuation, no explanation.',
        prompt: `Keyword: ${kw}`,
        maxTokens: 24,
        temperature: 0,
      });
      const out = res?.text?.trim().split('\n')[0].replace(/["'.]/g, '').trim().slice(0, 60);
      // A reply that is empty, or still non-Latin, means the model didn't translate —
      // using it would be worse than the original.
      if (!out || NON_LATIN_RE.test(out)) return kw;
      this.keywordCache.set(kw, out);
      this.logger.log(`Campaign keyword translated: "${kw}" → "${out}"`);
      return out;
    } catch (err: any) {
      this.logger.warn(`Keyword translation failed for "${kw}": ${err.message}`);
      return kw;
    }
  }

  // ── Agent post creation (called by OrchestratorAgent) ───────────────────

  async createAgentPost(
    userId: string,
    campaignId: string,
    data: {
      product_id: string;
      title: string;
      image_url: string;
      sale_price: number;
      original_price: number;
      currency: string;
      generated_text: string;
      rate: number;
    },
    creds: DecryptedCredentials,
  ): Promise<Post> {
    const affiliateUrl = await this.getAffiliateLink(data.product_id, creds);
    // Respect the product's currency — agent products may already carry the
    // site-accurate local (₪) price, which must not be multiplied by the rate again.
    const parts = this.priceParts(data, data.rate);

    const post = this.repo.create({
      user_id: userId,
      campaign_id: campaignId,
      product_id: data.product_id,
      product_title: data.title,
      product_image: data.image_url,
      affiliate_url: affiliateUrl,
      original_price_usd: parts.origUsd,
      sale_price_usd: parts.saleUsd,
      price_ils: parts.priceIls,
      generated_text: data.generated_text,
      status: 'pending',
    });

    await this.repo.save(post);
    await this.sendToTelegram(post, creds);
    return post;
  }

  // ── Stuck posts cleanup (called by cron every 15 min) ────────────────────

  async resetStuckPendingPosts(): Promise<void> {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago
    await this.repo.update(
      { status: 'pending', created_at: LessThan(cutoff) },
      { status: 'failed', error_message: 'Timed out — server may have restarted during send' },
    );
  }

  // ── Retry ─────────────────────────────────────────────────────────────────

  async retry(userId: string, postId: string) {
    const post = await this.repo.findOne({ where: { id: postId, user_id: userId } });
    if (!post) throw new NotFoundException('Post not found');
    // Only failed/pending posts may be retried — retrying a 'sent' post would
    // re-publish it to the live channel and re-charge publish credits.
    if (post.status === 'sent') {
      throw new BadRequestException('הפוסט כבר נשלח — אי אפשר לשלוח אותו שוב');
    }
    const creds = await this.credentials.getRaw(userId);
    post.status = 'pending';
    post.error_message = null;
    await this.repo.save(post);
    await this.sendToTelegram(post, creds, post.channel_override || undefined);
    return post;
  }

  /** Composes the final message body: affiliate link + per-channel footer + HTML
   *  normalisation. Shared by the publisher and the failed-channel retry. */
  private async buildPostBody(post: Post, creds: DecryptedCredentials, channelOverride?: string): Promise<string> {
    const linkAlreadyInText = post.affiliate_url && post.generated_text.includes(post.affiliate_url);
    let body = (post.affiliate_url && !linkAlreadyInText)
      ? `${post.generated_text}\n\n🔗 ${post.affiliate_url}`
      : post.generated_text;

    // Coupons are AliExpress-ONLY — the codes redeem at AliExpress checkout, so an AliExpress
    // code on a FLYLINK post is useless and misleading. Attach one only when this post's link
    // is an AliExpress link (source is inferred from the link, same as the posts-list filter).
    // Resolved at SEND time so a queued/scheduled post never ships a code that expired while
    // it waited; priced in USD because the tiers are ($7 OFF $55+).
    const isAliExpressPost = /aliexpress/i.test(post.affiliate_url || '');
    const match = isAliExpressPost
      ? await this.coupons.bestFor(post.user_id, post.sale_price_usd).catch(() => null)
      : null;
    if (match && !body.includes(match.coupon.code)) {
      body = `${body}\n\n${this.coupons.couponLine(match.coupon, match.qualifies)}`;
    }

    const footer = await this.resolveFooterText(post.user_id, creds, channelOverride);
    if (footer && !body.includes(footer)) body = `${body}\n\n${footer}`;
    return mdBoldToHtml(body);
  }

  /**
   * Re-attempt ONLY the platform(s) that failed on a partially-published post (e.g.
   * Telegram already went out but Facebook was rejected). The failed platforms are
   * read from `error_message`; only those are re-sent, and publish credits are NOT
   * charged again (the post was already billed on its original publish).
   */
  async retryFailedChannels(userId: string, postId: string): Promise<Post> {
    const post = await this.repo.findOne({ where: { id: postId, user_id: userId } });
    if (!post) throw new NotFoundException('פוסט לא נמצא');
    const prev = (post.error_message || '').trim();
    if (!prev) throw new BadRequestException('אין פלטפורמה שנכשלה בפוסט הזה');

    const creds = await this.credentials.getRaw(userId);
    if (!creds) throw new BadRequestException('חסרים פרטי חיבור');
    const wantMake = creds.publish_via_make === true && !!creds.make_webhook_url;

    const targets = this.resolveTargets(post);
    const multi = targets.length > 1;
    const errors: string[] = [];
    const tasks: Promise<void>[] = [];
    const failed = (p: string) => new RegExp(`(^|\\|)\\s*${p}:`, 'i').test(prev);

    // For a multi-group post that only PARTIALLY failed, re-send ONLY to the groups whose
    // name/id appears in the error — otherwise we'd re-post to a group that already
    // succeeded (a duplicate). Single-group posts always qualify.
    const names = new Map<string | undefined, string | null>();
    for (const t of targets) names.set(t, t ? await this.channels.getName(userId, t).catch(() => null) : null);
    const isNamed = (t: string | undefined): boolean => {
      const name = names.get(t);
      return (!!name && prev.includes(name)) || (!!t && prev.includes(t));
    };
    // If the error names specific groups, only those failed. If it names NONE (e.g. groups
    // sharing one page, or a legacy error), we can't discriminate → retry all of them.
    const anyGroupNamed = targets.some(isNamed);
    const groupFailed = (t: string | undefined): boolean => !multi || !anyGroupNamed || isNamed(t);

    // Telegram: re-send to each failed target group (media prepared once, sent sequentially).
    if (failed('Telegram')) {
      const media = await this.prepareTelegramMedia(post, creds);
      tasks.push((async () => {
        for (const target of targets) {
          if (!groupFailed(target)) continue;
          const body = await this.buildPostBody(post, creds, target);
          const label = await this.targetLabel(userId, target, multi);
          try { await this.sendToTelegramChannel(post, creds, body, target, media); }
          catch (err: any) { errors.push(`Telegram: ${label}${err?.response?.data?.description || err.message}`); }
        }
      })());
    }
    // Facebook / Make: one send per unique failed page. FB is delivered via Make when enabled.
    if ((failed('Facebook') || failed('Make'))) {
      const pages = await this.resolvePages(userId, targets, creds);
      for (const [pageId, target] of pages) {
        if (!groupFailed(target)) continue;
        const body = await this.buildPostBody(post, creds, target);
        const label = await this.targetLabel(userId, target, multi && pages.size > 1);
        if ((failed('Facebook') && !wantMake)) {
          const token = await this.resolveFacebookPageToken(userId, target, creds);
          tasks.push(this.sendToFacebook(post, creds, body, pageId, token)
            .catch((err: any) => { errors.push(`Facebook: ${label}${err?.response?.data?.error?.message || err.message}`); }));
        }
        if (failed('Make') || (failed('Facebook') && wantMake)) {
          tasks.push(this.sendToMakeWebhook(post, creds, body, pageId)
            .catch((err: any) => { errors.push(`Make: ${label}${err?.response?.data?.message || err.message}`); }));
        }
      }
    }
    if (failed('Instagram')) {
      const body = await this.buildPostBody(post, creds, targets[0]);
      tasks.push(this.sendToInstagram(post, creds, body)
        .catch((err: any) => { errors.push(`Instagram: ${err?.response?.data?.error?.message || err.message}`); }));
    }
    if (!tasks.length) throw new BadRequestException('לא זוהתה פלטפורמה שנכשלה לניסיון חוזר');

    await Promise.all(tasks);
    post.error_message = errors.length ? errors.join(' | ') : null;
    if (!post.error_message) {
      post.status = 'sent';
      if (!post.sent_at) post.sent_at = new Date();
    }
    await this.repo.save(post);
    return post;
  }

  /**
   * Manually PUSH an existing post to specific platform(s) and group(s) — WITHOUT charging
   * credits and WITHOUT touching platforms/groups you didn't select (so no duplicates).
   * Back-fill tool: e.g. push old Telegram-only posts to Facebook, or deliver a
   * FB-only post to a Telegram group it missed. `channels` (channel_ids) overrides the
   * post's own targets; omit to use them.
   */
  async pushToPlatforms(userId: string, postId: string, platforms: string[], channels?: string[]): Promise<Post> {
    const post = await this.repo.findOne({ where: { id: postId, user_id: userId } });
    if (!post) throw new NotFoundException('פוסט לא נמצא');
    const creds = await this.credentials.getRaw(userId);
    if (!creds) throw new BadRequestException('חסרים פרטי חיבור');

    const want = new Set((platforms || []).map((p) => String(p).toLowerCase()));
    if (!want.size) throw new BadRequestException('בחר לפחות פלטפורמה אחת');

    const targetList: (string | undefined)[] = (channels && channels.length)
      ? Array.from(new Set(channels.filter((c) => typeof c === 'string' && c.trim())))
      : this.resolveTargets(post);
    const multi = targetList.length > 1;
    const wantMake = creds.publish_via_make === true && !!creds.make_webhook_url;

    const errors: string[] = [];
    const tasks: Promise<void>[] = [];
    let anySuccess = false;

    if (want.has('telegram')) {
      const media = await this.prepareTelegramMedia(post, creds);
      tasks.push((async () => {
        for (const target of targetList) {
          const body = await this.buildPostBody(post, creds, target);
          const label = await this.targetLabel(userId, target, multi);
          try { await this.sendToTelegramChannel(post, creds, body, target, media); anySuccess = true; }
          catch (err: any) { errors.push(`Telegram: ${label}${err?.response?.data?.description || err.message}`); }
        }
      })());
    }
    if (want.has('facebook')) {
      const pages = await this.resolvePages(userId, targetList, creds);
      tasks.push((async () => {
        for (const [pageId, target] of pages) {
          const body = await this.buildPostBody(post, creds, target);
          const label = await this.targetLabel(userId, target, multi && pages.size > 1);
          try {
            if (wantMake) await this.sendToMakeWebhook(post, creds, body, pageId);
            else await this.sendToFacebook(post, creds, body, pageId, await this.resolveFacebookPageToken(userId, target, creds));
            anySuccess = true;
          } catch (err: any) {
            errors.push(`${wantMake ? 'Make' : 'Facebook'}: ${label}${err?.response?.data?.error?.message || err?.response?.data?.message || err.message}`);
          }
        }
      })());
    }
    if (want.has('instagram')) {
      const body = await this.buildPostBody(post, creds, targetList[0]);
      tasks.push(this.sendToInstagram(post, creds, body)
        .then(() => { anySuccess = true; })
        .catch((err: any) => { errors.push(`Instagram: ${err?.response?.data?.error?.message || err.message}`); }));
    }
    await Promise.all(tasks);

    // Merge into the existing error_message: drop old lines for the platforms we just
    // attempted (they've been re-tried now), keep unrelated ones, add fresh failures.
    const attemptedTokens: string[] = [];
    if (want.has('telegram')) attemptedTokens.push('Telegram');
    if (want.has('facebook')) attemptedTokens.push('Facebook', 'Make');
    if (want.has('instagram')) attemptedTokens.push('Instagram');
    const kept = (post.error_message || '').split('|').map((s) => s.trim()).filter(Boolean)
      .filter((line) => !attemptedTokens.some((tok) => new RegExp(`^${tok}:`, 'i').test(line)));
    const merged = [...kept, ...errors].filter(Boolean);
    post.error_message = merged.length ? merged.join(' | ') : null;
    if (post.status !== 'sent') post.status = 'sent';
    if (!post.sent_at) post.sent_at = new Date();
    await this.repo.save(post);

    // Nothing went out → surface the failure to the caller instead of a false success.
    if (!anySuccess) throw new BadRequestException(errors.join(' | ') || 'השליחה נכשלה');
    return post;
  }

  /**
   * Re-publish an existing post THROUGH THE QUEUE/SCHEDULE rather than immediately.
   * No `scheduled_at` → appended to the auto-send queue (goes out on the next slot);
   * with `scheduled_at` → scheduled for that time. Resets the publish state so it
   * sends fresh. Works identically for AliExpress and FLYLINK posts.
   */
  async requeue(userId: string, postId: string, scheduledAt?: string): Promise<Post> {
    const post = await this.repo.findOne({ where: { id: postId, user_id: userId } });
    if (!post) throw new NotFoundException('פוסט לא נמצא');

    post.error_message = null;
    post.sent_at = null;
    post.telegram_message_id = null;
    post.facebook_post_id = null;
    post.instagram_post_id = null;

    if (scheduledAt) {
      post.status = 'scheduled';
      post.scheduled_at = new Date(scheduledAt);
    } else {
      const maxOrderResult = await this.repo
        .createQueryBuilder('p')
        .select('MAX(p.queue_order)', 'maxOrder')
        .where('p.user_id = :userId AND p.status = :status', { userId, status: 'queued' })
        .getRawOne();
      post.status = 'queued';
      post.queue_order = (maxOrderResult?.maxOrder ?? -1) + 1;
      post.scheduled_at = null;
    }
    return this.repo.save(post);
  }

  // ── Multi-group / multi-channel publisher ────────────────────────────────
  //
  // Fans a post out to every target GROUP (Telegram chat + that group's own
  // Facebook page) and every enabled channel. A post carrying `channel_overrides`
  // publishes to several groups AT ONCE (e.g. מאמא מותגים + טקטי בקליק) — while still
  // costing a SINGLE publish credit. The post is marked 'sent' if AT LEAST ONE
  // delivery succeeds, and 'failed' only when every attempt errored. The method keeps
  // its historic name so all existing call sites stay unchanged.

  /**
   * The list of target groups for a post. `channel_overrides` (JSON array) wins when a
   * post fans out to several groups; otherwise the single `channel_override` (or the
   * explicit param) is used; `[undefined]` means the user's default channel.
   */
  private resolveTargets(post: Post, channelOverride?: string): (string | undefined)[] {
    let list: string[] = [];
    try { list = post.channel_overrides ? JSON.parse(post.channel_overrides) : []; } catch { /* ignore */ }
    list = Array.from(new Set(list.filter((c) => typeof c === 'string' && c.trim())));
    if (list.length) return list;
    if (channelOverride) return [channelOverride];
    if (post.channel_override) return [post.channel_override];
    return [undefined];
  }

  /** A campaign's target_channels column is JSON text — parse it to a clean id array. */
  private parseTargetChannels(raw: string | null | undefined): string[] {
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return Array.from(new Set(arr.filter((c) => typeof c === 'string' && c.trim())));
    } catch {
      return [];
    }
  }

  /** Persist the chosen target group(s) on a post (single or multi). */
  private applyChannels(post: Post, channels?: string[], channelOverride?: string): void {
    const uniq = Array.from(new Set((channels || [])
      .map((c) => (typeof c === 'string' ? c.trim() : ''))
      .filter(Boolean)));
    if (uniq.length) {
      post.channel_override = uniq[0];
      post.channel_overrides = uniq.length > 1 ? JSON.stringify(uniq) : null;
    } else if (channelOverride) {
      post.channel_override = channelOverride;
      post.channel_overrides = null;
    }
  }

  /**
   * Maps each target group to its Facebook page and DEDUPES by page id — so two groups
   * that share the same page (or fall back to the default) publish to it only once,
   * while groups with their own pages each get their post. Returns pageId → a
   * representative target (used to pick that page's footer/body).
   */
  private async resolvePages(userId: string, targets: (string | undefined)[], creds: DecryptedCredentials): Promise<Map<string, string | undefined>> {
    const pages = new Map<string, string | undefined>();
    for (const t of targets) {
      const pid = await this.resolveFacebookPageId(userId, t, creds);
      if (!pages.has(pid)) pages.set(pid, t);
    }
    return pages;
  }

  /** Short "[group name] " prefix for a target, for multi-group error messages. */
  private async targetLabel(userId: string, target: string | undefined, multi: boolean): Promise<string> {
    if (!multi || !target) return '';
    const name = await this.channels.getName(userId, target).catch(() => null);
    return `[${name || target}] `;
  }

  private async sendToTelegram(post: Post, creds: DecryptedCredentials, channelOverride?: string) {
    // Guarantee a SHORT affiliate link before anything is published — old queued posts and
    // any pasted link can carry the broken 1065-char /s/ form, which is ugly and blows the
    // Telegram caption limit. This is the single choke point every platform flows through.
    await this.ensureShortLink(post, creds);

    const errors: string[] = [];
    let anySuccess = false;

    const targets = this.resolveTargets(post, channelOverride);
    const multi = targets.length > 1;

    // Any explicit group target always means Telegram. Otherwise respect the user's
    // per-channel publish toggles (Telegram defaults on, Facebook defaults off).
    // Facebook honours its toggle GLOBALLY — even for group/queue posts — so enabling
    // "publish to Facebook" fans every post out to the page(s), not only default posts.
    const wantTelegram = targets.some((t) => !!t) || creds?.publish_telegram !== false;
    // Make.com is a GLOBAL relay for Facebook: when enabled + a webhook is set, FB is
    // delivered by POSTing to the user's Make scenario. BUT a channel that has its OWN
    // Facebook page token must still publish NATIVELY with that token even when Make is on —
    // otherwise the per-channel token the user configured is silently ignored (exactly why
    // Ali4You wasn't posting). So `wantFacebook` is just the master switch; per-target below
    // we pick native (own token) vs the Make relay.
    const makeRelay = creds?.publish_via_make === true && !!creds?.make_webhook_url;
    const wantFacebook = creds?.publish_facebook === true;
    const wantInstagram = creds?.publish_instagram === true;

    // No channel enabled → fail WITHOUT charging credits (the check used to run
    // after the consume, so users were billed for a post sent nowhere).
    if (!wantTelegram && !wantFacebook && !wantInstagram && !makeRelay) {
      post.status = 'failed';
      post.error_message = 'לא הופעל אף ערוץ פרסום — הפעל טלגרם/פייסבוק בהגדרות';
      await this.repo.save(post);
      return;
    }

    // Plan enforcement: publishing costs ONE credit per action — however many groups
    // or platforms it fans out to. Consumed only once we know a channel is enabled.
    if (post.user_id) {
      const ok = await this.subscription.tryConsume(
        post.user_id, this.subscription.costs.publish, 'publish',
      );
      if (!ok) {
        post.status = 'failed';
        post.error_message = 'נגמרו הקרדיטים בתוכנית שלך — שדרג תוכנית בהגדרות ← מנוי';
        await this.repo.save(post);
        return;
      }
    }

    // Send everything IN PARALLEL. Sequential sends meant a hung/expired token added its
    // full timeout on top of the others. Each group's body uses that group's own footer.
    const tasks: Promise<void>[] = [];

    // Telegram: prepare the album media ONCE, then send to each target group SEQUENTIALLY
    // (reusing the same media) — recomputing collage/enhancement per group in parallel
    // overloaded the instance and timed out the 2nd upload. This whole block still runs
    // concurrently with Facebook/Make below.
    if (wantTelegram) {
      const media = await this.prepareTelegramMedia(post, creds);
      tasks.push((async () => {
        for (const target of targets) {
          const body = await this.buildPostBody(post, creds, target);
          const label = await this.targetLabel(post.user_id, target, multi);
          try {
            await this.sendToTelegramChannel(post, creds, body, target, media);
            anySuccess = true;
          } catch (err: any) {
            errors.push(`Telegram: ${label}${err?.response?.data?.description || err.message}`);
          }
        }
      })());
    }

    // Facebook: one send per UNIQUE page (groups sharing a page post once). A channel with
    // its OWN page token publishes NATIVELY with it — even when Make is the global relay —
    // so the per-channel token is never ignored. Channels without their own token use the
    // global path: the Make relay when enabled, else native with the account's global token.
    if (wantFacebook || makeRelay) {
      // Facebook throttle: FB flags high-frequency posting as spam, so each page publishes at
      // most once per facebook_min_interval_minutes — INDEPENDENT of Telegram, which keeps its
      // full cadence. When a page was posted to too recently we skip FB for THIS post only
      // (Telegram already sent above). 0 = no throttle (every post, the old behaviour).
      const fbIntervalMs = Math.max(0, creds?.facebook_min_interval_minutes ?? 0) * 60_000;
      const pages = await this.resolvePages(post.user_id, targets, creds);
      for (const [pageId, target] of pages) {
        if (fbIntervalMs > 0 && target) {
          const last = await this.channels.getFacebookLastSent(post.user_id, target).catch(() => null);
          if (last && Date.now() - last.getTime() < fbIntervalMs) continue; // throttled — skip FB for this page
        }
        const body = await this.buildPostBody(post, creds, target);
        const label = await this.targetLabel(post.user_id, target, multi && pages.size > 1);
        const ownToken = target ? await this.channels.getFacebookPageToken(post.user_id, target) : null;
        // Advance the page's FB clock only on a successful publish, so the next post's throttle
        // check is accurate. Native and Make both count (Make can't return an id, so we track here).
        const markSent = () => { if (target) this.channels.markFacebookSent(post.user_id, target).catch(() => {}); };

        if (ownToken) {
          tasks.push(
            this.sendToFacebook(post, creds, body, pageId, ownToken)
              .then(() => { anySuccess = true; markSent(); })
              .catch((err: any) => { errors.push(`Facebook: ${label}${err?.response?.data?.error?.message || err.message}`); }),
          );
        } else if (makeRelay) {
          tasks.push(
            this.sendToMakeWebhook(post, creds, body, pageId)
              .then(() => { anySuccess = true; markSent(); })
              .catch((err: any) => { errors.push(`Make: ${label}${err?.response?.data?.message || err.message}`); }),
          );
        } else if (wantFacebook) {
          const token = creds?.facebook_page_token || '';
          tasks.push(
            this.sendToFacebook(post, creds, body, pageId, token)
              .then(() => { anySuccess = true; markSent(); })
              .catch((err: any) => { errors.push(`Facebook: ${label}${err?.response?.data?.error?.message || err.message}`); }),
          );
        }
      }
    }

    // Instagram: a single business account (no per-group fan-out).
    if (wantInstagram) {
      const body = await this.buildPostBody(post, creds, targets[0]);
      tasks.push(
        this.sendToInstagram(post, creds, body)
          .then(() => { anySuccess = true; })
          .catch((err: any) => { errors.push(`Instagram: ${err?.response?.data?.error?.message || err.message}`); }),
      );
    }

    await Promise.all(tasks);

    if (anySuccess) {
      post.status = 'sent';
      post.sent_at = new Date();
      post.error_message = errors.length ? errors.join(' | ') : null;
    } else {
      post.status = 'failed';
      post.error_message = errors.join(' | ') || 'No channel enabled';
    }
    await this.repo.save(post);
  }

  /**
   * The Telegram media to send for a post, computed ONCE (collage compositing and image
   * enhancement are CPU/network heavy). When a post fans out to several groups, the same
   * prepared media is reused for every group instead of recomputed per group — recomputing
   * in parallel on a small instance was overloading it and timing out the second upload.
   */
  private async prepareTelegramMedia(post: Post, creds: DecryptedCredentials): Promise<TgMedia> {
    let gallery: string[] = [];
    try { gallery = post.gallery_json ? JSON.parse(post.gallery_json) : []; } catch { /* ignore */ }

    // Collage mode: compose the (up to 30) source images into grid sheets → one uploaded
    // album (the only way to show >10 images in a single Telegram post).
    if (post.collage_cells && gallery.length > 1) {
      const sheets = await this.collage.compose(gallery, post.collage_cells).catch(() => [] as Buffer[]);
      if (sheets.length) return { kind: 'buffers', buffers: sheets };
    }

    // Auto image enhancement: fetch the photo(s), run the "studio" pass, upload the enhanced
    // bytes. Best-effort — if it yields nothing, fall through to the URL-based send.
    if (creds?.image_enhance_enabled && !post.collage_cells) {
      const src = gallery.length ? gallery.slice(0, 10) : (post.product_image ? [post.product_image] : []);
      if (src.length) {
        const buffers = await this.collage.enhance(src).catch(() => [] as Buffer[]);
        if (buffers.length) return { kind: 'buffers', buffers };
      }
    }

    if (gallery.length > 1) return { kind: 'album', images: gallery.slice(0, 10) };
    return { kind: 'single', image: post.product_image };
  }

  /**
   * Delivers a post's (pre-prepared) media + caption to ONE Telegram chat. `media` is
   * computed once by prepareTelegramMedia and reused across all target groups; when
   * omitted it is computed here (single-target callers).
   */
  private async sendToTelegramChannel(post: Post, creds: DecryptedCredentials, caption: string, channelOverride?: string, media?: TgMedia) {
    let token = creds?.telegram_bot_token;
    let channel = normalizeTelegramChatId(creds?.telegram_channel_id);

    // Routed to a specific saved channel (e.g. a supplier catalog's group). Each saved
    // channel can carry its OWN bot token, so we must send with THAT bot — the default
    // bot is usually not a member of it → Telegram "chat not found". Fall back to the
    // default token only when the channel has no token of its own.
    if (channelOverride) {
      const target = await this.channels.resolveSendTarget(post.user_id, channelOverride);
      if (target) {
        channel = target.chatId;
        if (target.token) token = target.token;
      } else if (normalizeTelegramChatId(channelOverride) === normalizeTelegramChatId(creds?.telegram_channel_id)) {
        // The override IS the account's own default chat (passed explicitly) — allowed,
        // sent with the default bot token.
        channel = normalizeTelegramChatId(channelOverride);
      } else {
        // SECURITY (ownership gate): never post to a chat the user hasn't saved as one of
        // their channels. Without this, an authenticated caller could pass an arbitrary
        // chat_id and post there with their own bot. Fail the send loudly instead.
        throw new Error(`יעד פרסום לא מאושר — הערוץ (${channelOverride}) אינו שמור בחשבון שלך`);
      }
    }
    if (!token || !channel) throw new Error('Missing Telegram credentials');

    const m = media || await this.prepareTelegramMedia(post, creds);

    // Telegram caps a PHOTO caption at 1024 code units (a plain message allows 4096).
    // A post can exceed it — usually a long affiliate URL, but also long copy — and the
    // API then rejects the whole send with "message caption is too long", so the post
    // fails entirely. When that happens, send the image with NO caption and the full text
    // as a follow-up message, so the post still goes out intact instead of not at all.
    const overflow = caption.length > TG_CAPTION_LIMIT;
    const mediaCaption = overflow ? '' : caption;
    const sendOverflow = async () => { if (overflow) await this.sendTelegramText(token, channel, caption); };

    if (m.kind === 'buffers') {
      if (m.buffers.length >= 2) { await this.sendMediaGroupUpload(token, channel, m.buffers, mediaCaption, post); await sendOverflow(); return; }
      if (m.buffers.length === 1) { await this.sendPhotoUpload(token, channel, m.buffers[0], mediaCaption, post); await sendOverflow(); return; }
      // 0 buffers shouldn't reach here (prepare returns album/single instead) — fall through.
    }

    if (m.kind === 'album') {
      await this.sendMediaGroup(token, channel, m.images, mediaCaption, post);
      await sendOverflow();
      return;
    }

    const image = m.kind === 'single' ? m.image : post.product_image;
    // Text-only post (e.g. a custom scheduled announcement with no image): sendPhoto would
    // reject an empty photo, so send the caption as a plain message instead.
    if (!image) {
      await this.sendTelegramText(token, channel, caption);
      return;
    }
    const url = `https://api.telegram.org/bot${token}/sendPhoto`;
    try {
      const res = await axios.post(
        url,
        { chat_id: channel, photo: image, caption: mediaCaption, parse_mode: 'HTML' },
        { timeout: 15000 },
      );
      post.telegram_message_id = res.data?.result?.message_id;
      await sendOverflow();
    } catch (err: any) {
      // Last-resort safety net: if Telegram rejects the HTML (400 "can't parse
      // entities"), resend as PLAIN text so the post still goes out rather than
      // failing entirely. Any other error rethrows.
      const desc: string = err?.response?.data?.description || '';
      if (err?.response?.status === 400 && /parse|entit|tag/i.test(desc)) {
        const plain = mediaCaption.replace(/<[^>]+>/g, '');
        const res = await axios.post(
          url,
          { chat_id: channel, photo: image, caption: plain },
          { timeout: 15000 },
        );
        post.telegram_message_id = res.data?.result?.message_id;
        await sendOverflow();
        return;
      }
      throw err;
    }
  }

  /**
   * Send a plain (image-less) Telegram message — used for the overflow text when a
   * caption exceeds the 1024-cap photo limit. HTML with a plain-text fallback, mirroring
   * the photo path. Link preview is disabled so the follow-up sits tight under the image.
   */
  private async sendTelegramText(token: string, channel: string, text: string) {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    try {
      await axios.post(url, {
        chat_id: channel, text, parse_mode: 'HTML', disable_web_page_preview: true,
      }, { timeout: 15000 });
    } catch (err: any) {
      const desc: string = err?.response?.data?.description || '';
      if (err?.response?.status === 400 && /parse|entit|tag/i.test(desc)) {
        await axios.post(url, {
          chat_id: channel, text: text.replace(/<[^>]+>/g, ''), disable_web_page_preview: true,
        }, { timeout: 15000 });
        return;
      }
      throw err;
    }
  }

  /** Send up to 10 photos as one album; caption + parse_mode on the first item. */
  private async sendMediaGroup(token: string, channel: string, images: string[], caption: string, post: Post) {
    const url = `https://api.telegram.org/bot${token}/sendMediaGroup`;
    const build = (withHtml: boolean) => images.map((img, i) => ({
      type: 'photo',
      media: img,
      ...(i === 0 ? { caption, ...(withHtml ? { parse_mode: 'HTML' } : {}) } : {}),
    }));
    try {
      const res = await axios.post(url, { chat_id: channel, media: build(true) }, { timeout: 20000 });
      post.telegram_message_id = res.data?.result?.[0]?.message_id;
    } catch (err: any) {
      const desc: string = err?.response?.data?.description || '';
      // HTML parse error → retry with plain-text caption.
      if (err?.response?.status === 400 && /parse|entit|tag/i.test(desc)) {
        const plainCaption = caption.replace(/<[^>]+>/g, '');
        const media = images.map((img, i) => ({ type: 'photo', media: img, ...(i === 0 ? { caption: plainCaption } : {}) }));
        const res = await axios.post(url, { chat_id: channel, media }, { timeout: 20000 });
        post.telegram_message_id = res.data?.result?.[0]?.message_id;
        return;
      }
      throw err;
    }
  }

  /**
   * Send up to 10 IMAGE BUFFERS (e.g. generated collage sheets) as one album by
   * UPLOADING them to Telegram (multipart, attach://) — no public hosting needed.
   * Caption + parse_mode on the first item; plain-text retry on an HTML parse error.
   */
  private async sendMediaGroupUpload(token: string, channel: string, buffers: Buffer[], caption: string, post: Post) {
    const url = `https://api.telegram.org/bot${token}/sendMediaGroup`;
    const send = async (withHtml: boolean) => {
      const cap = withHtml ? caption : caption.replace(/<[^>]+>/g, '');
      const sheets = buffers.slice(0, 10);
      const form = new FormData();
      form.append('chat_id', channel);
      const media = sheets.map((_b, i) => ({
        type: 'photo',
        media: `attach://sheet${i}`,
        ...(i === 0 ? { caption: cap, ...(withHtml ? { parse_mode: 'HTML' } : {}) } : {}),
      }));
      form.append('media', JSON.stringify(media));
      sheets.forEach((b, i) => form.append(`sheet${i}`, b, { filename: `sheet${i}.jpg`, contentType: 'image/jpeg' }));
      return axios.post(url, form, { headers: form.getHeaders(), timeout: 40000, maxBodyLength: Infinity, maxContentLength: Infinity });
    };
    try {
      const res = await send(true);
      post.telegram_message_id = res.data?.result?.[0]?.message_id;
    } catch (err: any) {
      const desc: string = err?.response?.data?.description || '';
      if (err?.response?.status === 400 && /parse|entit|tag/i.test(desc)) {
        const res = await send(false);
        post.telegram_message_id = res.data?.result?.[0]?.message_id;
        return;
      }
      throw err;
    }
  }

  /** Uploads a single in-memory photo buffer (e.g. an enhanced image) to Telegram. */
  private async sendPhotoUpload(token: string, channel: string, buffer: Buffer, caption: string, post: Post) {
    const url = `https://api.telegram.org/bot${token}/sendPhoto`;
    const send = async (withHtml: boolean) => {
      const form = new FormData();
      form.append('chat_id', channel);
      form.append('caption', withHtml ? caption : caption.replace(/<[^>]+>/g, ''));
      if (withHtml) form.append('parse_mode', 'HTML');
      form.append('photo', buffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });
      return axios.post(url, form, { headers: form.getHeaders(), timeout: 30000, maxBodyLength: Infinity, maxContentLength: Infinity });
    };
    try {
      const res = await send(true);
      post.telegram_message_id = res.data?.result?.message_id;
    } catch (err: any) {
      const desc: string = err?.response?.data?.description || '';
      if (err?.response?.status === 400 && /parse|entit|tag/i.test(desc)) {
        const res = await send(false);
        post.telegram_message_id = res.data?.result?.message_id;
        return;
      }
      throw err;
    }
  }

  /**
   * The Facebook Page a post publishes to: the target group's OWN page when the post is
   * routed to a saved channel that has one, otherwise the user's global default page.
   * Lets each Telegram group fan out to its own Facebook page (מאמא מותגים → its page,
   * טקטי בקליק → its page).
   */
  private async resolveFacebookPageId(userId: string, channelOverride: string | undefined, creds: DecryptedCredentials): Promise<string> {
    if (channelOverride) {
      const pid = await this.channels.getFacebookPageId(userId, channelOverride);
      if (pid) return pid;
    }
    return creds?.facebook_page_id || '';
  }

  /**
   * The Page Access Token to publish with: the target group's OWN token when it has one
   * (a Page token is page-specific), otherwise the account's global token. This is what lets
   * two groups on DIFFERENT Facebook pages each publish with their own token.
   */
  private async resolveFacebookPageToken(userId: string, channelOverride: string | undefined, creds: DecryptedCredentials): Promise<string> {
    if (channelOverride) {
      const tok = await this.channels.getFacebookPageToken(userId, channelOverride);
      if (tok) return tok;
    }
    return creds?.facebook_page_token || '';
  }

  /** Publishes the post to a specific Facebook Page feed with the given token. Throws on failure. */
  private async sendToFacebook(post: Post, creds: DecryptedCredentials, message: string, pageId: string, token: string) {
    if (!pageId || !token) throw new Error('Missing Facebook credentials');

    // Facebook does not render Telegram-style HTML tags — strip them for the FB body.
    const plain = message.replace(/<\/?[^>]+>/g, '');
    const params = new URLSearchParams({
      message: plain,
      link: post.affiliate_url || '',
      access_token: token,
    });

    const res = await axios.post(
      `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/feed`,
      params.toString(),
      // 8s is plenty for the Graph API — a longer timeout just makes an
      // expired-token failure feel like the whole system is stuck.
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 8000 },
    );
    if (res.data?.error) throw new Error(res.data.error.message);
    post.facebook_post_id = res.data?.id;
  }

  /**
   * Publishes the post to Instagram via the Content Publishing API (two-step:
   * create a media container from the product image + caption, then publish it).
   * Reuses the linked Facebook Page token (needs instagram_content_publish).
   * Instagram requires an image — text-only posts aren't supported — so we use the
   * product's main photo. The image URL must be publicly reachable (AliExpress URLs
   * and our Yupoo image proxy both are).
   */
  private async sendToInstagram(post: Post, creds: DecryptedCredentials, message: string) {
    const igId = creds?.instagram_business_id;
    const token = creds?.facebook_page_token;
    if (!igId || !token) throw new Error('Missing Instagram credentials');

    // First gallery image, else the main product image.
    let image = post.product_image || '';
    try {
      const g = post.gallery_json ? JSON.parse(post.gallery_json) : [];
      if (Array.isArray(g) && g[0]) image = g[0];
    } catch { /* ignore */ }
    if (!image) throw new Error('אין תמונת מוצר לפרסום באינסטגרם');

    const caption = message.replace(/<\/?[^>]+>/g, ''); // IG shows no HTML
    const base = `https://graph.facebook.com/${GRAPH_VERSION}/${igId}`;

    // 1) Create the media container.
    const create = await axios.post(
      `${base}/media`,
      new URLSearchParams({ image_url: image, caption, access_token: token }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 },
    );
    if (create.data?.error) throw new Error(create.data.error.message);
    const creationId = create.data?.id;
    if (!creationId) throw new Error('Instagram container creation failed');

    // 2) Publish the container.
    const publish = await axios.post(
      `${base}/media_publish`,
      new URLSearchParams({ creation_id: creationId, access_token: token }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 },
    );
    if (publish.data?.error) throw new Error(publish.data.error.message);
    post.instagram_post_id = publish.data?.id || null;
  }

  /**
   * Relays the post to a Make.com incoming webhook, which drives the user's own
   * scenario (and its authorized Facebook connection) to publish. This is the bridge
   * to their existing "Google Sheets → Facebook/Telegram" automation: instead of a
   * sheet row, Make receives a clean JSON payload per post. Sends both the plain and
   * HTML text plus every image URL, so the scenario can map whatever it needs.
   */
  private async sendToMakeWebhook(post: Post, creds: DecryptedCredentials, body: string, pageId: string) {
    const url = creds?.make_webhook_url;
    if (!url) throw new Error('Missing Make webhook URL');

    let gallery: string[] = [];
    try { gallery = post.gallery_json ? JSON.parse(post.gallery_json) : []; } catch { /* ignore */ }
    // The exact images the user picked (same set that goes to the Telegram album), capped
    // at Facebook's 10-per-post album limit. Sent both as a plain URL list AND pre-shaped
    // as Facebook "photos" objects so the Make scenario can map the whole album in one field.
    const images = gallery.length ? gallery.slice(0, 10) : (post.product_image ? [post.product_image] : []);
    const photos = images.map((url) => ({ type: 'url', url, caption: '' }));
    const plain = body.replace(/<\/?[^>]+>/g, '');
    // `pageId` is the target group's own Facebook page (resolved by the caller, falling
    // back to the global default). The Make scenario maps this to the FB module's page_id
    // so each group posts to its own page.
    const payload = {
      text: plain,                 // ready-to-post caption (no HTML)
      html: body,                  // HTML variant (Telegram-style), if the scenario wants it
      title: post.product_title,
      image: images[0] || post.product_image || '',
      images,                      // full gallery (plain URLs) for multi-image posts
      photos,                      // same gallery pre-shaped for Facebook's photos array
      link: post.affiliate_url || '',
      price_ils: post.price_ils || 0,
      facebook_page_id: pageId,
      post_id: post.id,
    };

    const res = await axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
      // Make returns 200 "Accepted" on success; surface anything else as an error.
      validateStatus: (s) => s >= 200 && s < 300,
    });
    // Make webhooks echo a short body ("Accepted"); nothing to persist beyond success.
    void res;
  }

  // ── AliExpress helpers ────────────────────────────────────────────────────

  private async searchProduct(productId: string, creds: DecryptedCredentials): Promise<any> {
    // Try to find a matching product via search, fall back to mock data
    try {
      const results = await this.searchProducts({ keyword: productId, limit: 1 }, creds);
      if (results.length > 0) return results[0];
    } catch (err: any) {
      this.logger.warn(`searchProduct(${productId}) failed: ${err?.message}`);
    }
    // No invented fallback: a made-up product would get AI copy written about it and be
    // published to a real channel. Callers treat null as "couldn't resolve".
    return null;
  }

  private async searchProducts(params: {
    keyword?: string;
    category_id?: string;
    min_price?: number;
    max_price?: number;
    min_discount?: number;
    limit?: number;
    page?: number;
  }, creds: DecryptedCredentials): Promise<any[]> {
    if (!creds?.aliexpress_app_key) {
      throw new BadRequestException('AliExpress affiliate credentials not configured');
    }

    try {
      const currencyPair = creds.currency_pair || 'USD_ILS';
      const targetCcy = currencyPair.split('_')[1] || 'ILS';
      const rate = await this.rates.getRate(currencyPair);

      const signed = signAliexpress({
        method: 'aliexpress.affiliate.product.query',
        app_key: creds.aliexpress_app_key,
        keywords: params.keyword,
        category_ids: params.category_id,
        min_sale_price: params.min_price ? Math.round(params.min_price / rate * 100) : undefined,
        max_sale_price: params.max_price ? Math.round(params.max_price / rate * 100) : undefined,
        // Destination pricing + AliExpress's own currency conversion — without these
        // the API returns the SELLER-currency price (often CNY) for a default country,
        // which does not match the site and was parsed here as if it were USD.
        ship_to_country: process.env.SHIP_TO_COUNTRY || ({ ILS: 'IL', GBP: 'GB' } as any)[targetCcy],
        target_currency: targetCcy,
        fields: 'product_id,product_title,original_price,sale_price,sale_price_currency,' +
          'target_original_price,target_sale_price,target_sale_price_currency,promotion_link,' +
          'discount,product_main_image_url,product_detail_url,evaluate_rate,first_level_category_name,lastest_volume',
        page_size: params.limit || 10,
        page_no: params.page && params.page > 0 ? params.page : undefined,
        sort: 'LAST_VOLUME_DESC',
        tracking_id: creds.aliexpress_tracking_id,
      }, creds.aliexpress_app_secret);

      const res = await axios.get(ALI_API, { params: signed, timeout: 10000 });

      const items = res.data?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product || [];
      return items.map((p: any) => {
        const rawEval = String(p.evaluate_rate || '').replace('%', '').trim();
        const evalPct = parseFloat(rawEval) || 0;
        const rating  = evalPct > 5 ? +(evalPct / 20).toFixed(1) : +evalPct.toFixed(1);

        // Prefer the site-accurate target (₪) price; raw sale_price is only usable
        // when it's genuinely USD.
        const targetSale = parseFloat(p.target_sale_price);
        const targetOrig = parseFloat(p.target_original_price);
        const rawIsUsd = (p.sale_price_currency || 'USD') === 'USD';
        const sale = targetSale > 0 ? targetSale : (rawIsUsd ? parseFloat(p.sale_price) || 0 : 0);
        const orig = targetOrig > 0 ? targetOrig : (rawIsUsd ? parseFloat(p.original_price) || 0 : 0);

        return {
          product_id: String(p.product_id),
          title: p.product_title,
          original_price: orig,
          sale_price: sale,
          discount_percent: parseInt(p.discount) || 0,
          image_url: p.product_main_image_url,
          product_url: p.product_detail_url,
          affiliate_url: p.promotion_link || undefined,
          category: p.first_level_category_name,
          orders_count: parseInt(String(p.lastest_volume || '0').replace(/,/g, ''), 10) || 0,
          rating,
          currency: targetSale > 0 ? (p.target_sale_price_currency || targetCcy) : 'USD',
        };
      });
    } catch (err: any) {
      // Campaigns run unattended — inventing products here would publish fabricated
      // deals to the user's real audience. Fail the run instead; the scheduler logs it.
      this.logger.error(`searchProducts failed: ${err?.message}`);
      throw err;
    }
  }

  /**
   * Ensure a post's AliExpress link is the SHORT /e/_ form (~42 chars) before publishing.
   * product.query returns a broken /s/ promotion_link that is ~1065 chars — over Telegram's
   * caption limit and hideous in a post. Legacy posts, and any hand-pasted link, can carry
   * it. Regenerate via link.generate and persist, but ONLY swap when we actually get a
   * genuine short affiliate link back — never trade a tracked long link for the untracked
   * plain-URL fallback. No-ops for FLYLINK links and links that are already short.
   */
  private async ensureShortLink(post: Post, creds: DecryptedCredentials): Promise<void> {
    const u = post.affiliate_url || '';
    if (!/aliexpress/i.test(u) || u.length <= 100) return; // short or non-AliExpress → fine
    if (!/^\d{6,}$/.test(String(post.product_id || ''))) return; // no usable item id
    try {
      const short = await this.getAffiliateLink(post.product_id, creds);
      if (short && short.length < 100 && /s\.click\.aliexpress/i.test(short)) {
        post.affiliate_url = short;
        await this.repo.save(post);
        this.logger.log(`Shortened affiliate link for post ${post.id} (${u.length}→${short.length} chars)`);
      }
    } catch (err: any) {
      // A failure here must not block the send — worst case the post goes out with the
      // long link via the caption safety net, exactly as before this fix.
      this.logger.warn(`ensureShortLink failed for post ${post.id}: ${err.message}`);
    }
  }

  private async getAffiliateLink(productId: string, creds: DecryptedCredentials): Promise<string> {
    if (!creds?.aliexpress_app_key) {
      return `https://www.aliexpress.com/item/${productId}.html`;
    }
    try {
      const signed = signAliexpress({
        method: 'aliexpress.affiliate.link.generate',
        app_key: creds.aliexpress_app_key,
        source_values: `https://www.aliexpress.com/item/${productId}.html`,
        promotion_link_type: '0',
        tracking_id: creds.aliexpress_tracking_id,
      }, creds.aliexpress_app_secret);

      const res = await axios.get(ALI_API, { params: signed, timeout: 10000 });
      const links = res.data?.aliexpress_affiliate_link_generate_response?.resp_result?.result?.promotion_links?.promotion_link;
      return links?.[0]?.promotion_link || `https://www.aliexpress.com/item/${productId}.html`;
    } catch {
      return `https://www.aliexpress.com/item/${productId}.html`;
    }
  }

  // ── OpenAI text generation ────────────────────────────────────────────────

  private async generateText(product: any, language: string, rate: number, creds: DecryptedCredentials, template?: string, priceLocalOverride?: number, images?: GenerateImage[], hint?: string, forceVision = false): Promise<string> {
    // Use direct local price if already converted, otherwise multiply by rate
    const priceLocal = priceLocalOverride !== undefined
      ? priceLocalOverride.toFixed(0)
      : (product.sale_price * rate).toFixed(0);
    // When priceLocalOverride is set the prices are ALREADY in local currency, so
    // the original must NOT be multiplied by the rate again (that double-converted
    // it, e.g. ₪31.49 → ₪94). Only convert from USD when there's no override.
    const originalLocal = priceLocalOverride !== undefined
      ? (product.original_price || 0).toFixed(0)
      : (product.original_price * rate).toFixed(0);
    const currencyPair = creds?.currency_pair || 'USD_ILS';
    const symbol = currencyPair.includes('ILS') ? '₪' : currencyPair.includes('EUR') ? '€' : currencyPair.includes('GBP') ? '£' : '$';
    const discount = product.discount_percent
      || (product.original_price > 0
        ? Math.round((1 - product.sale_price / product.original_price) * 100)
        : 0);

    // No AI provider configured at all → deterministic fallback copy.
    if (!this.ai.hasAnyKey(creds)) {
      return this.defaultText(product, priceLocal, originalLocal, discount, language, symbol);
    }

    // Plan enforcement: AI generation costs credits. Out of credits → block with
    // the standard upgrade message (template fallback text stays free — only the
    // AI call is billed).
    if (creds?.user_id) {
      await this.subscription.consumeOrThrow(
        creds.user_id, this.subscription.costs.ai_generate, 'ai_generate',
      );
    }

    // When the user supplies a custom template it becomes the AUTHORITATIVE
    // instruction: the template is the system prompt and the user message carries
    // only the product facts. Mixing in the default style rules would override the
    // template's exact structure, tone and fixed lines — which is what we want to avoid.
    const hasTemplate = !!template?.trim();
    let systemPrompt = hasTemplate
      ? this.templateSystemPrompt(language, template!.trim())
      : this.defaultSystemPrompt(language);

    // A product-type hint (from the user) is the AUTHORITATIVE ground truth — it fixes the
    // case where vision misreads an ambiguous first photo (e.g. flip-flops → "lighting").
    const h = hint?.trim();
    if (h) {
      systemPrompt += `\n\nסוג/שם המוצר (מקור אמת מוחלט): "${h}". כתוב/כתבי אך ורק על המוצר הזה. אם התמונות נראות כמו משהו אחר — התעלם/י והתבסס/י על סוג המוצר שצוין. אסור בשום אופן לכתוב על קטגוריה אחרת.`;
    }

    // Vision grounds the copy in what's actually in the photo. Normally it's for free-form
    // generation only — with a template the template wording is authoritative. BUT for
    // Yupoo/FLYLINK the product "title" is just a CODE, so the image is the only identity:
    // forceVision keeps vision on under a template (the template gives the voice/structure,
    // vision gives the subject).
    const visionImages = (hasTemplate && !forceVision) ? undefined : images;
    if (visionImages?.length) {
      if (h) {
        systemPrompt += '\n\nמצורפות תמונות המוצר — השתמש/י בהן רק כדי לדייק פרטים ויזואליים (צבע, חומר, סגנון) של המוצר שצוין למעלה. אל תשנה/י את סוג המוצר.';
      } else if (hasTemplate) {
        systemPrompt += '\n\nמצורפות תמונות המוצר, וכותרת הטקסט היא רק קוד — לכן זהה/י מהתמונות מהו המוצר בפועל ופרטיו (צבע/חומר/סגנון) וכתוב/כתבי עליו. שמור/י על מבנה התבנית והשורות הקבועות בדיוק. אל תמציא/י קטגוריה שאינה נראית בבירור בתמונות.';
      } else {
        systemPrompt += '\n\nמצורפות תמונות המוצר. שלב 1: זהה/י מהו המוצר לפי מה שנראה בתמונות (רוב התמונות מציגות את אותו פריט — התעלם/י מתמונות שער/מידות/לוגו). שלב 2: כתוב/כתבי על המוצר שזיהית. אל תמציא/י קטגוריה שאינה נראית בבירור; אם באמת לא ברור מהו המוצר — תאר/י אותו כללית (צבע/סגנון/שימוש) בלי לנחש קטגוריה ספציפית שעלולה להיות שגויה.';
      }
    }

    const userPrompt = hasTemplate
      ? this.buildProductFacts(language, product, symbol, priceLocal, originalLocal, discount)
      : this.buildUserPrompt(language, product, symbol, priceLocal, originalLocal, discount);

    const result = await this.ai.generate(creds, {
      system: systemPrompt,
      prompt: userPrompt,
      images: visionImages,
      // Custom templates often produce longer, structured posts → give more room
      // and lower the temperature so the model adheres to the exact structure.
      maxTokens: hasTemplate ? 900 : 400,
      temperature: hasTemplate ? 0.7 : 0.85,
    });

    const text = result?.text ? mdBoldToHtml(result.text) : '';
    return text || this.defaultText(product, priceLocal, originalLocal, discount, language, symbol);
  }

  private defaultSystemPrompt(language: string): string {
    if (language === 'he') {
      return `אתה קופירייטר מקצועי ומומחה שיווק שותפים לערוצי Telegram בעברית.
תפקידך: לכתוב פוסטים שמוכרים — לא רק מציגים מוצר.

חוקים קריטיים:
• כתוב בעברית בלבד, ללא שום מילה באנגלית (שמות מוצרים מותר להשאיר כפי שהם)
• אל תכלול קישור — הוא יצורף אוטומטית בסוף
• מבנה הפוסט: פתיחה מושכת → תיאור ערך המוצר → מחיר ממוחק + מחיר נוכחי → פרטי ביצועים → קריאה לפעולה
• השתמש ב-HTML tags בלבד לעיצוב: <b>...</b> לכותרות/מחירים חשובים, <i>...</i> לניואנסים
• אורך: 80–130 מילים — מספיק כדי לשכנע, קצר כדי לא לאבד תשומת לב
• סגנון: נרגש אבל אמין, לא spam — כמו חבר שממליץ על דיל אמיתי
• כלול FOMO עדין: מלאי מוגבל / מחיר לא יישאר ככה / בלעדי לחברי הערוץ
• הדגש את ה-ROI: "שלמת פחות, קיבלת יותר"`;
    }
    if (language === 'ar') {
      return `أنت كاتب إعلانات محترف ومتخصص في التسويق بالعمولة لقنوات Telegram باللغة العربية.
مهمتك: كتابة منشورات تبيع — ليس مجرد عرض منتج.

قواعد حرجة:
• اكتب باللغة العربية فقط، بدون أي كلمة إنجليزية (أسماء المنتجات يمكن إبقاؤها)
• لا تضمّن رابطاً — سيُضاف تلقائياً في النهاية
• هيكل المنشور: فتح جذاب → قيمة المنتج → السعر الأصلي مشطوباً + السعر الحالي → الأداء → دعوة للعمل
• استخدم HTML tags فقط للتنسيق: <b>...</b> للعناوين والأسعار المهمة
• الطول: 80–130 كلمة
• الأسلوب: متحمس لكن موثوق، مثل صديق يوصي بصفقة حقيقية`;
    }
    return `You are a professional Telegram affiliate marketing copywriter specializing in high-conversion posts.
Your job: write posts that SELL — not just describe a product.

Critical rules:
• Write in English only (product names can stay as-is)
• Do NOT include a link — it will be appended automatically
• Post structure: Attention-grabbing hook → product value → crossed-out original price + current price → social proof → strong CTA
• Use HTML tags only for formatting: <b>...</b> for key prices/headlines, <i>...</i> for subtle emphasis
• Length: 80–130 words — enough to convince, short enough to hold attention
• Style: excited but credible — like a friend recommending a real deal
• Include subtle FOMO: limited stock / price won't stay this low / exclusive for channel members`;
  }

  /**
   * The user's template is the authoritative instruction. We pass it through as the
   * system prompt and only add a short guardrail (language + "don't append a link")
   * — NOT the default copywriter rules, which would fight the template's structure.
   */
  private templateSystemPrompt(language: string, template: string): string {
    if (language === 'he') {
      return `${template}

———
הוראות מערכת (גוברות רק על פרטים טכניים):
• שכפל/י את נוסח התבנית שלמעלה מילה במילה — כולל השורות הקבועות, האימוג'ים והמבנה. אל תנסח/י מחדש ואל תקצר/י.
• מלא/י אך ורק מצייני מיקום מפורשים בסוגריים (למשל [מחיר], [שם]). כל שאר הטקסט נשאר בדיוק כפי שנכתב.
• אל תחליף/י ביטויים כלליים בערך ספציפי. לדוגמה: אם כתוב "לפי הקוד בתמונות" — השאר/י "בתמונות" כפי שהוא, אל תכניס/י את קוד/שם המוצר במקומו.
• כתוב/כתבי בעברית. אל תוסיף/י קישור — קישור השותפים יצורף אוטומטית. החזר/החזירי רק את הפוסט המוגמר, בלי הסברים.`;
    }
    if (language === 'ar') {
      return `${template}

———
تعليمات النظام: انسخ نص القالب أعلاه حرفياً — بما في ذلك الأسطر الثابتة والرموز والبنية. لا تُعِد الصياغة. املأ فقط العناصر النائبة الصريحة بين قوسين (مثل [السعر]). لا تستبدل العبارات العامة بقيمة محددة (مثلاً اترك "حسب الكود في الصور" كما هي). اكتب بالعربية، لا تضف رابطاً، وأعد المنشور النهائي فقط.`;
    }
    return `${template}

———
System note: reproduce the template text above VERBATIM — including fixed lines, emojis and structure. Do not rephrase. Fill ONLY explicit bracketed placeholders (e.g. [price]); leave everything else exactly as written. Do not replace generic phrases with a specific value (e.g. keep "by the code in the photos" as-is — do NOT substitute the product code/name). Write in English, do not add a link, return only the finished post.`;
  }

  /** Product facts only — fills the placeholder in a user-defined template. */
  private buildProductFacts(language: string, product: any, symbol: string, priceLocal: string, originalLocal: string, discount: number): string {
    const orders = (product.orders_count || 0) >= 1000
      ? `${((product.orders_count || 0) / 1000).toFixed(1)}K+`
      : `${product.orders_count || 0}`;
    const rating = product.rating?.toFixed(1) || 'N/A';
    const title = product.title || '';
    const category = product.category || '';

    if (language === 'he') {
      return `פרטי המוצר לכתיבת הפוסט:
• שם המוצר: ${title}
• מחיר מבצע: ${symbol}${priceLocal}
• מחיר מקורי: ${symbol}${originalLocal}
• הנחה: ${discount}%
• הזמנות: ${orders} לקוחות קנו
• דירוג: ${rating}/5
• קטגוריה: ${category}

השתמש/י בפרטים האלה אך ורק כדי למלא מצייני מיקום בתבנית (כמו מחיר/שם). אל תשנה/י את הטקסט הקבוע של התבנית ואל תוסיף/י פרטים שלא נדרשו בה.`;
    }
    if (language === 'ar') {
      return `تفاصيل المنتج لكتابة المنشور:
• الاسم: ${title}
• سعر العرض: ${symbol}${priceLocal}
• السعر الأصلي: ${symbol}${originalLocal}
• الخصم: ${discount}%
• الطلبات: ${orders}
• التقييم: ${rating}/5
• الفئة: ${category}

اكتب الآن المنشور لهذا المنتج وفق التعليمات والبنية المحددة.`;
    }
    return `Product details for the post:
• Name: ${title}
• Sale price: ${symbol}${priceLocal}
• Original price: ${symbol}${originalLocal}
• Discount: ${discount}%
• Orders: ${orders}
• Rating: ${rating}/5
• Category: ${category}

Now write the post for this product, following the defined instructions and structure. If specific features aren't listed above, infer reasonable ones from the product name.`;
  }

  private buildUserPrompt(language: string, product: any, symbol: string, priceLocal: string, originalLocal: string, discount: number): string {
    const ordersFormatted = (product.orders_count || 0) >= 1000
      ? `${((product.orders_count || 0) / 1000).toFixed(1)}K+`
      : `${product.orders_count || 0}`;
    const stars = Math.round(product.rating || 0);
    const starStr = '⭐'.repeat(Math.min(stars, 5));

    if (language === 'he') {
      return `צור פוסט שיווקי מקצועי לערוץ Telegram עבור המוצר הבא. כתוב בעברית בלבד.

📦 פרטי המוצר:
שם: ${product.title}
מחיר מקורי: ${symbol}${originalLocal}
מחיר מבצע: ${symbol}${priceLocal}
הנחה: ${discount}%
הזמנות: ${ordersFormatted} לקוחות קנו
דירוג: ${product.rating?.toFixed(1) || 'N/A'}/5 ${starStr}
קטגוריה: ${product.category || 'כללי'}

הנחיות:
- התחל עם hook מנצח (שורה אחת שמושכת תשומת לב מיידית)
- הצג את הערך האמיתי של המוצר, לא רק את המחיר
- השתמש ב-<b>${symbol}${priceLocal}</b> למחיר המבצע
- ציין "במקום ${symbol}${originalLocal}" להדגשת החיסכון
- הוסף FOMO עדין (מלאי / זמן מוגבל)
- סיים עם קריאה לפעולה חזקה
- אל תכלול קישור`;
    }
    if (language === 'ar') {
      return `أنشئ منشوراً تسويقياً احترافياً لقناة Telegram للمنتج التالي. اكتب باللغة العربية فقط.

📦 تفاصيل المنتج:
الاسم: ${product.title}
السعر الأصلي: ${symbol}${originalLocal}
سعر العرض: ${symbol}${priceLocal}
الخصم: ${discount}%
الطلبات: ${ordersFormatted} عميل اشترى
التقييم: ${product.rating?.toFixed(1) || 'N/A'}/5 ${starStr}
الفئة: ${product.category || 'عام'}

تعليمات:
- ابدأ بسطر جذاب يلفت الانتباه فوراً
- أبرز قيمة المنتج، ليس فقط السعر
- استخدم <b>${symbol}${priceLocal}</b> لسعر العرض
- اذكر "بدلاً من ${symbol}${originalLocal}" لإبراز التوفير
- أضف FOMO خفيف (مخزون / وقت محدود)
- اختم بدعوة عمل قوية
- لا تضمّن رابطاً`;
    }
    return `Create a professional Telegram marketing post for the product below. Write in English only.

📦 Product details:
Name: ${product.title}
Original price: ${symbol}${originalLocal}
Sale price: ${symbol}${priceLocal}
Discount: ${discount}%
Orders: ${ordersFormatted} customers bought this
Rating: ${product.rating?.toFixed(1) || 'N/A'}/5 ${starStr}
Category: ${product.category || 'General'}

Instructions:
- Start with a powerful hook (one line that grabs attention immediately)
- Highlight the product's real value, not just the price
- Use <b>${symbol}${priceLocal}</b> for the sale price
- Mention "instead of ${symbol}${originalLocal}" to emphasize savings
- Add subtle FOMO (limited stock / time-sensitive price)
- End with a strong call to action
- Do NOT include a link`;
  }

  private defaultText(product: any, priceLocal: string, originalLocal: string, discount: number, language: string, symbol = '₪'): string {
    if (language === 'he') {
      return `🔥 <b>דיל לוהט — אל תפספסו!</b>\n\n${product.title}\n\n💸 <b>רק ${symbol}${priceLocal}</b> במקום ~~${symbol}${originalLocal}~~ (חיסכון של ${discount}%!)\n\n⭐ דירוג: ${product.rating?.toFixed(1) || 'N/A'}/5 | 🛒 ${(product.orders_count || 0).toLocaleString()} לקוחות שמחים\n\n⚡ המחיר הזה לא יישאר ככה — הזדרזו!\n👇 לחצו על הקישור לרכישה`;
    }
    if (language === 'ar') {
      return `🔥 <b>عرض حصري — لا تفوّتوه!</b>\n\n${product.title}\n\n💸 <b>فقط ${symbol}${priceLocal}</b> بدلاً من ~~${symbol}${originalLocal}~~ (توفير ${discount}%!)\n\n⭐ التقييم: ${product.rating?.toFixed(1) || 'N/A'}/5 | 🛒 ${(product.orders_count || 0).toLocaleString()} عميل راضٍ\n\n⚡ هذا السعر لن يبقى — تصرفوا الآن!\n👇 اضغطوا على الرابط للشراء`;
    }
    return `🔥 <b>Hot Deal — Don't Miss Out!</b>\n\n${product.title}\n\n💸 <b>Only ${symbol}${priceLocal}</b> instead of ${symbol}${originalLocal} (save ${discount}%!)\n\n⭐ Rating: ${product.rating?.toFixed(1) || 'N/A'}/5 | 🛒 ${(product.orders_count || 0).toLocaleString()} happy customers\n\n⚡ This price won't last — act now!\n👇 Tap the link to buy`;
  }
}
