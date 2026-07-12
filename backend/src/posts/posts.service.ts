import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import axios from 'axios';
import { Post } from './post.entity';
import { Template } from '../templates/template.entity';
import { Campaign } from '../campaigns/campaign.entity';
import { CredentialsService, DecryptedCredentials } from '../credentials/credentials.service';
import { RatesService } from '../rates/rates.service';
import { AiService, GenerateImage } from '../ai/ai.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { ChannelsService } from '../channels/channels.service';
import { signAliexpress } from '../common/aliexpress-sign';
import { normalizeTelegramChatId } from '../common/crypto';

const ALI_API = 'https://api-sg.aliexpress.com/sync';

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

@Injectable()
export class PostsService {
  constructor(
    @InjectRepository(Post)
    private readonly repo: Repository<Post>,
    @InjectRepository(Template)
    private readonly templateRepo: Repository<Template>,
    private readonly credentials: CredentialsService,
    private readonly rates: RatesService,
    private readonly ai: AiService,
    private readonly subscription: SubscriptionService,
    private readonly channels: ChannelsService,
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

  /** Resolve the user's default footer template content (appended to every post). */
  private async getFooterText(userId: string, creds: DecryptedCredentials): Promise<string> {
    const id = creds?.default_footer_template_id;
    if (!id) return '';
    const t = await this.templateRepo.findOne({ where: { id, user_id: userId } });
    return t?.content?.trim() || '';
  }

  /**
   * Footer for a post: when routed to a specific saved channel that has its OWN footer
   * template (each group has its own join link), use that; otherwise the global default.
   */
  private async resolveFooterText(userId: string, creds: DecryptedCredentials, channelOverride?: string): Promise<string> {
    if (channelOverride) {
      const id = await this.channels.getFooterTemplateId(userId, channelOverride);
      if (id) {
        const t = await this.templateRepo.findOne({ where: { id, user_id: userId } });
        return t?.content?.trim() || '';
      }
    }
    return this.getFooterText(userId, creds);
  }

  // ── List ──────────────────────────────────────────────────────────────────

  async list(userId: string, page = 1, limit = 20, status?: string, campaignId?: string) {
    const qb = this.repo.createQueryBuilder('p')
      .leftJoin('p.campaign', 'c')
      .addSelect(['c.name'])
      .where('p.user_id = :userId', { userId })
      .orderBy('p.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (status) qb.andWhere('p.status = :status', { status });
    if (campaignId) qb.andWhere('p.campaign_id = :campaignId', { campaignId });

    const [raw, total] = await qb.getManyAndCount();
    const data = raw.map((p) => ({ ...p, campaign_name: p.campaign?.name ?? null }));
    return { data, total, page, limit };
  }

  // ── Preview ───────────────────────────────────────────────────────────────

  async preview(userId: string, productId: string, language = 'he', customProduct?: any, template?: string, images?: GenerateImage[]) {
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
    );

    return {
      product,
      generated_text: text,
      price_ils: customProduct?.price_ils ?? priceLocal,
      exchange_rate: priceAlreadyConverted ? 1 : rate,
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
  ) {
    const creds = await this.credentials.getRaw(userId);
    const rate = await this.rates.getRate(creds?.currency_pair || 'USD_ILS');

    // Only fetch the product from AliExpress if we don't already have the image
    const product = productImageOverride
      ? null
      : await this.searchProduct(productId, creds);

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
  ) {
    const creds = await this.credentials.getRaw(userId);
    const rate = await this.rates.getRate(creds?.currency_pair || 'USD_ILS');

    const product = productImageOverride
      ? null
      : await this.searchProduct(productId, creds);

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
  }): Post {
    return this.repo.create({
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
      gallery_json: data.images && data.images.length > 1 ? JSON.stringify(data.images.slice(0, 10)) : null,
    });
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
  ): Promise<Post> {
    const creds = await this.credentials.getRaw(userId);
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

    // Assign next queue_order for this user
    const maxOrderResult = await this.repo
      .createQueryBuilder('p')
      .select('MAX(p.queue_order)', 'maxOrder')
      .where('p.user_id = :userId AND p.status = :status', { userId, status: 'queued' })
      .getRawOne();
    const nextOrder = (maxOrderResult?.maxOrder ?? -1) + 1;

    const post = this.repo.create({
      user_id: userId,
      product_id: product.product_id,
      product_title: product.title,
      product_image: product.image_url,
      affiliate_url: product.affiliate_url,
      original_price_usd: origUsd,
      sale_price_usd: saleUsd,
      price_ils: priceIls,
      generated_text: text,
      status: 'queued',
      queue_order: nextOrder,
      catalog_product_id: catalogProductId,
      channel_override: channelOverride || null,
      // Extra images (product colors/variants) beyond the main one → sent as a
      // Telegram media group (swipeable album) instead of spamming separate posts.
      gallery_json: images && images.length > 1 ? JSON.stringify(images.slice(0, 10)) : null,
    });

    return this.repo.save(post);
  }

  /**
   * Sends the next queued post for a user. Returns:
   *  • { sent: false } when the queue is empty (nothing consumed)
   *  • { sent: true, ok: true }  on a successful publish
   *  • { sent: true, ok: false, error } when a post was consumed but publishing failed
   * sendToTelegram swallows channel errors and marks the post 'failed', so we surface
   * that outcome here instead of always reporting success.
   */
  async processNextQueuedPost(userId: string): Promise<{ sent: boolean; ok?: boolean; error?: string }> {
    const next = await this.repo
      .createQueryBuilder('p')
      .where('p.user_id = :userId AND p.status = :status', { userId, status: 'queued' })
      .orderBy('p.queue_order', 'ASC')
      .addOrderBy('p.created_at', 'ASC')
      .getOne();

    if (!next) return { sent: false };

    const creds = await this.credentials.getRaw(userId);
    next.status = 'pending';
    await this.repo.save(next);
    // Route to the post's target group if set (supplier products / per-catalog channel).
    await this.sendToTelegram(next, creds, next.channel_override || undefined);
    // sendToTelegram mutates next.status in place ('sent' | 'failed'); TS still sees the
    // 'pending' we assigned above, so compare via a widened string.
    return { sent: true, ok: (next.status as string) === 'sent', error: next.error_message || undefined };
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
  ) {
    const post = await this.createQueuedPost(userId, product, undefined, text);
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
    return this.repo
      .createQueryBuilder('p')
      .where('p.status = :status', { status: 'scheduled' })
      .andWhere('p.scheduled_at <= :now', { now: new Date() })
      .getMany();
  }

  async sendScheduled(post: Post) {
    const creds = await this.credentials.getRaw(post.user_id);
    post.status = 'pending';
    await this.repo.save(post);
    await this.sendToTelegram(post, creds, post.channel_override || undefined);
  }

  // ── Run campaign ──────────────────────────────────────────────────────────

  async runCampaign(campaign: Campaign, userId: string) {
    const creds = await this.credentials.getRaw(userId);
    if (!creds) return;

    const rate = await this.rates.getRate(creds.currency_pair || 'USD_ILS');
    const keyword = campaign.keywords[Math.floor(Math.random() * campaign.keywords.length)];

    const products = await this.searchProducts({
      keyword,
      category_id: campaign.category_id,
      min_price: campaign.min_price,
      max_price: campaign.max_price,
      min_discount: campaign.min_discount,
      limit: campaign.posts_per_run * 3,
    }, creds);

    const toPost = products.slice(0, campaign.posts_per_run);

    for (const product of toPost) {
      const affiliateUrl = product.affiliate_url || await this.getAffiliateLink(product.product_id, creds);
      const parts = this.priceParts(product, rate);
      const text = await this.generateText(product, campaign.language, rate, creds, campaign.post_template, parts.localOverride);

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
        status: 'pending',
      });

      await this.repo.save(post);
      await this.sendToTelegram(post, creds);

      // Small delay between posts
      await new Promise((r) => setTimeout(r, 1500));
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

  // ── Multi-channel publisher ─────────────────────────────────────────────
  //
  // Fans a post out to every enabled channel (Telegram + Facebook). The post is
  // marked 'sent' if AT LEAST ONE channel succeeds (matching NEXUS behaviour),
  // and 'failed' only when every attempted channel errored. The method keeps its
  // historic name so all existing call sites stay unchanged.

  private async sendToTelegram(post: Post, creds: DecryptedCredentials, channelOverride?: string) {
    const errors: string[] = [];
    let anySuccess = false;

    // A channelOverride always targets Telegram. Otherwise respect the user's
    // per-channel publish toggles (Telegram defaults on, Facebook defaults off).
    const wantTelegram = !!channelOverride || creds?.publish_telegram !== false;
    const wantFacebook = !channelOverride && creds?.publish_facebook === true;

    // No channel enabled → fail WITHOUT charging credits (the check used to run
    // after the consume, so users were billed for a post sent nowhere).
    if (!wantTelegram && !wantFacebook) {
      post.status = 'failed';
      post.error_message = 'לא הופעל אף ערוץ פרסום — הפעל טלגרם/פייסבוק בהגדרות';
      await this.repo.save(post);
      return;
    }

    // Plan enforcement: publishing a post costs credits (flat per post, however many
    // platforms it fans out to). Consumed only once we know a channel is enabled.
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

    // Only append the affiliate link if it's not already present in the text
    // (the frontend may have already included it in the generated_text)
    const linkAlreadyInText = post.affiliate_url && post.generated_text.includes(post.affiliate_url);
    let body = (post.affiliate_url && !linkAlreadyInText)
      ? `${post.generated_text}\n\n🔗 ${post.affiliate_url}`
      : post.generated_text;

    // Append the footer (channel branding + that group's OWN join link) if set and not
    // already present. Per-channel footer overrides the global default when routed.
    const footer = await this.resolveFooterText(post.user_id, creds, channelOverride);
    if (footer && !body.includes(footer)) {
      body = `${body}\n\n${footer}`;
    }

    // Normalise any Markdown bold the model emitted so Telegram doesn't show ** literally.
    body = mdBoldToHtml(body);

    // Send to all channels IN PARALLEL. Sequential sends meant a hung/expired
    // Facebook token added its full timeout on top of Telegram — the user waited
    // ~15+ extra seconds per post for a channel that was going to fail anyway.
    const tasks: Promise<void>[] = [];
    if (wantTelegram) {
      tasks.push(
        this.sendToTelegramChannel(post, creds, body, channelOverride)
          .then(() => { anySuccess = true; })
          .catch((err: any) => { errors.push(`Telegram: ${err?.response?.data?.description || err.message}`); }),
      );
    }
    if (wantFacebook) {
      tasks.push(
        this.sendToFacebook(post, creds, body)
          .then(() => { anySuccess = true; })
          .catch((err: any) => { errors.push(`Facebook: ${err?.response?.data?.error?.message || err.message}`); }),
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

  /** Sends the post photo(s)+caption to a Telegram channel. Throws on failure. */
  private async sendToTelegramChannel(post: Post, creds: DecryptedCredentials, caption: string, channelOverride?: string) {
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
      } else {
        channel = normalizeTelegramChatId(channelOverride);
      }
    }
    if (!token || !channel) throw new Error('Missing Telegram credentials');

    // Multiple images (product colors/variants) → one swipeable media group
    // instead of separate posts. Telegram caps a group at 10 and puts the caption
    // on the first item only.
    let gallery: string[] = [];
    try { gallery = post.gallery_json ? JSON.parse(post.gallery_json) : []; } catch { /* ignore */ }
    if (gallery.length > 1) {
      await this.sendMediaGroup(token, channel, gallery.slice(0, 10), caption, post);
      return;
    }

    const url = `https://api.telegram.org/bot${token}/sendPhoto`;
    try {
      const res = await axios.post(
        url,
        { chat_id: channel, photo: post.product_image, caption, parse_mode: 'HTML' },
        { timeout: 15000 },
      );
      post.telegram_message_id = res.data?.result?.message_id;
    } catch (err: any) {
      // Last-resort safety net: if Telegram rejects the HTML (400 "can't parse
      // entities"), resend as PLAIN text so the post still goes out rather than
      // failing entirely. Any other error rethrows.
      const desc: string = err?.response?.data?.description || '';
      if (err?.response?.status === 400 && /parse|entit|tag/i.test(desc)) {
        const plain = caption.replace(/<[^>]+>/g, '');
        const res = await axios.post(
          url,
          { chat_id: channel, photo: post.product_image, caption: plain },
          { timeout: 15000 },
        );
        post.telegram_message_id = res.data?.result?.message_id;
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

  /** Publishes the post to the user's Facebook Page feed. Throws on failure. */
  private async sendToFacebook(post: Post, creds: DecryptedCredentials, message: string) {
    const pageId = creds?.facebook_page_id;
    const token = creds?.facebook_page_token;
    if (!pageId || !token) throw new Error('Missing Facebook credentials');

    // Facebook does not render Telegram-style HTML tags — strip them for the FB body.
    const plain = message.replace(/<\/?[^>]+>/g, '');
    const params = new URLSearchParams({
      message: plain,
      link: post.affiliate_url || '',
      access_token: token,
    });

    const res = await axios.post(
      `https://graph.facebook.com/v19.0/${pageId}/feed`,
      params.toString(),
      // 8s is plenty for the Graph API — a longer timeout just makes an
      // expired-token failure feel like the whole system is stuck.
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 8000 },
    );
    if (res.data?.error) throw new Error(res.data.error.message);
    post.facebook_post_id = res.data?.id;
  }

  // ── AliExpress helpers ────────────────────────────────────────────────────

  private async searchProduct(productId: string, creds: DecryptedCredentials): Promise<any> {
    // Try to find a matching product via search, fall back to mock data
    try {
      const results = await this.searchProducts({ keyword: productId, limit: 1 }, creds);
      if (results.length > 0) return results[0];
    } catch {}

    // Mock product for dev / when API not configured
    return this.mockProduct(productId);
  }

  private async searchProducts(params: {
    keyword?: string;
    category_id?: string;
    min_price?: number;
    max_price?: number;
    min_discount?: number;
    limit?: number;
  }, creds: DecryptedCredentials): Promise<any[]> {
    if (!creds?.aliexpress_app_key) {
      return this.mockProducts(params.keyword || 'product', params.limit || 5);
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
    } catch {
      return this.mockProducts(params.keyword || 'product', params.limit || 5);
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

  private async generateText(product: any, language: string, rate: number, creds: DecryptedCredentials, template?: string, priceLocalOverride?: number, images?: GenerateImage[]): Promise<string> {
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

    // Vision: when a product image is attached, ground the copy in what's ACTUALLY
    // visible (color, type, material, details) and forbid inventing facts — this is the
    // whole point for catalogs with no textual description.
    if (images?.length) {
      systemPrompt += '\n\nמצורפת תמונת המוצר. תאר את המוצר אך ורק לפי מה שנראה בתמונה בפועל (סוג הפריט, צבע, חומר, פרטים בולטים) ולפי העובדות שסופקו. אל תמציא מאפיינים, מותג או שימושים שאינם נראים בתמונה או מופיעים בעובדות. אם פרט לא ידוע — פשוט אל תזכיר אותו.';
    }

    const userPrompt = hasTemplate
      ? this.buildProductFacts(language, product, symbol, priceLocal, originalLocal, discount)
      : this.buildUserPrompt(language, product, symbol, priceLocal, originalLocal, discount);

    const result = await this.ai.generate(creds, {
      system: systemPrompt,
      prompt: userPrompt,
      images,
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
הוראות מערכת (גוברות רק על פרטים טכניים): כתוב/כתבי את הפוסט בעברית, ועקוב/עקבי אחר ההוראות, המבנה, האימוג'ים והשורות הקבועות שלמעלה במדויק. אל תוסיף/י קישור משלך — קישור השותפים יצורף אוטומטית. החזר/החזירי רק את הפוסט המוגמר, בלי הסברים.`;
    }
    if (language === 'ar') {
      return `${template}

———
تعليمات النظام: اكتب المنشور بالعربية واتبع التعليمات والبنية والرموز والأسطر الثابتة أعلاه بدقة. لا تضف رابطاً؛ سيُضاف رابط الإحالة تلقائياً. أعد المنشور النهائي فقط دون شرح.`;
    }
    return `${template}

———
System note: write the post in English and follow the instructions, structure, emojis and fixed lines above exactly. Do not add your own link — the affiliate link is appended automatically. Return only the finished post, no explanations.`;
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

כתוב/כתבי כעת את הפוסט עבור המוצר הזה, לפי ההוראות והמבנה שהוגדרו. אם נדרשות תכונות/יתרונות שאינם מופיעים למעלה — הסק/הסיקי אותם בצורה סבירה משם המוצר.`;
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

  // ── Mock data for dev ─────────────────────────────────────────────────────

  private mockProduct(productId: string) {
    return {
      product_id: productId,
      title: `Demo Product ${productId}`,
      original_price: 29.99,
      sale_price: 14.99,
      discount_percent: 50,
      image_url: 'https://ae01.alicdn.com/kf/placeholder.jpg',
      product_url: `https://www.aliexpress.com/item/${productId}.html`,
      category: 'Electronics',
      orders_count: 1200,
      rating: 4.7,
      currency: 'USD',
    };
  }

  private mockProducts(keyword: string, limit: number) {
    return Array.from({ length: limit }, (_, i) => ({
      product_id: `mock-${Date.now()}-${i}`,
      title: `${keyword} Product ${i + 1}`,
      original_price: 19.99 + i * 5,
      sale_price: 9.99 + i * 3,
      discount_percent: 45,
      image_url: 'https://ae01.alicdn.com/kf/placeholder.jpg',
      product_url: `https://www.aliexpress.com/item/mock${i}.html`,
      category: 'General',
      orders_count: 500 + i * 100,
      rating: 4.5,
      currency: 'USD',
    }));
  }
}
