import { Injectable, NotFoundException, BadRequestException, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { Repository, LessThan, MoreThan, In, Brackets } from 'typeorm';
import axios from 'axios';
// CommonJS module (no .default) — import-require avoids the `.default is not a
// constructor` trap under this tsconfig (no esModuleInterop). See collage.service.ts.
import FormData = require('form-data');
import { Post } from './post.entity';
import { PostedProduct } from './posted-product.entity';
import { copyDefect } from './copy-guard';
import { WORD_POLICY_BRIEF, applyWordPolicy, violatesWordPolicy } from './word-policy';
import { COPY_JUDGE_SYSTEM, COPY_JUDGE_PINTEREST_NOTE, parseJudgeAnswer, trimForJudge } from './copy-judge';
import { mentionsPrice, priceProofBlock } from './price-block';
import { KeywordPerformance, weightedRotation } from './keyword-rotation';
import { cursorGiveBack } from './keyword-cursor';
import { isTelegramConnectionError, telegramErrorText } from './telegram-retry';
import { tagShortLinks } from '../links/click-source';
import { stripInlineLink } from './strip-inline-link';
import { toWhatsAppText } from './whatsapp-format';
import { AUTO_RETRY_MARK, NET_SAFE_TAG, isRetryableNetworkPartial } from './network-partial';
import { soloCampaignSlot } from './solo-campaign-slot';
import { manualQueueTurn } from './queue-fairness';
import { publishTimeoutVerdict } from './ig-container-status';
import { bonusCopyHint } from './bonus-copy';
import { flylinkTrustBlock, hasFlylinkTrustBlock, isFlylinkPost, PostPlatform } from './flylink-trust';
import { BRAND_PLUS_MARK, brandPlusLine } from './brand-plus';
import { mergeDeliveredChannels } from './delivered-channels';
import { cronTypicalIntervalMin } from '../watchdog/cron-interval';
import { pruneRunLog, recordFailedRun } from '../campaigns/run-failure-log';
import { waDelayMs } from './whatsapp-pacing';
import { snapToHotHour } from './smart-timing';
import { occupiesCurrentInterval, pacingIntervalMinutes } from './group-pacing';
import { platformFilterSql } from './platform-filter';
import { ImportRowInput, composeImportText, extractAliProductId, extractAliProductIdFromHtml, validImportRow } from './import-rows';
import { PRODUCT_FIT_SYSTEM, ProductFitContext, ProductFitItem, ProductFitVerdict, buildProductFitPrompt, parseProductFitVerdicts } from './product-relevance';
import { hotHours } from '../optimizer/hot-hours';
import { PriceBand, preferInBand, soldPriceBand } from '../optimizer/sold-price-band';
import { VariantStat, pickVariant, variantHint } from './copy-variants';
import {
  igFetchHeaders, igMediaRejectedMessage, isIgFittableHost, isOwnUploadedUrl, unwrapOwnProxy,
} from './instagram-image';
import { composePinFrame } from './pin-frame-compose';
import {
  buildSmartIntakePrompt, fallbackKeyword, parseIntakeVerdict,
  IntakeCampaignProfile, IntakeVerdict, SMART_INTAKE_SYSTEM,
} from './smart-intake';
import { tidyRtlBody } from './rtl';
import { Template } from '../templates/template.entity';
import { Campaign } from '../campaigns/campaign.entity';
import { nextRunAt } from '../campaigns/next-run';
import { CredentialsService, DecryptedCredentials, GRAPH_VERSION } from '../credentials/credentials.service';
import { RatesService } from '../rates/rates.service';
import { AiService, GenerateImage } from '../ai/ai.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { ChannelsService } from '../channels/channels.service';
import { CouponsService, currencySymbol } from '../coupons/coupons.service';
import { LinksService } from '../links/links.service';
import { ProductsService } from '../products/products.service';
import { PinterestService } from '../pinterest/pinterest.service';
import { IncentiveService } from '../incentive/incentive.service';
import { StorefrontService } from '../storefront/storefront.service';
import { hasStoreLine, storeLine } from '../storefront/store-line';
import { UploadedImage } from './uploaded-image.entity';
import {
  describeMissingScopes, isTierBlockError, parseGrantedScopes, PUBLISH_SCOPE,
  TIER_BLOCK_MESSAGE, tierBlockActive,
} from '../pinterest/pinterest-scopes';
import { CollageService } from '../collage/collage.service';
import { signAliexpress } from '../common/aliexpress-sign';
import { seasonalKeywords, seasonalCopyHints, activeSeasonalEvents } from '../common/seasonal';
import { SeasonalStatus, seasonalRunNote } from './seasonal-status';
import { seasonalPostsPerRun } from './seasonal-boost';
import { normalizeTelegramChatId } from '../common/crypto';
import { assertSafeOutboundUrl } from '../common/ssrf';
import {
  facebookErrorText, isTransientFacebookError, isMetaConnectionError, isMetaTimeoutError,
  metaGraphError, type TokenSource,
} from '../common/facebook-errors';

const ALI_API = 'https://api-sg.aliexpress.com/sync';

const UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/** Telegram's photo/album caption limit, in UTF-16 code units (JS string length). A
 *  plain sendMessage allows 4096; over this we split image + text into two messages. */
const TG_CAPTION_LIMIT = 1024;

/**
 * What a campaign searches on ONE run, and how many posts that run gets.
 *
 * Both runners — the plain one and the agents one — read this, so the seasonal calendar and
 * the bonus pools reach a campaign the same way whichever path it takes.
 */
export interface CampaignKeywordPlan {
  /** Own keywords plus the seasonal and bonus terms in force, before pauses. */
  kwList: string[];
  /** The same list minus keywords the manager paused for 24h. */
  kwEffective: string[];
  /** kwEffective repeated by weight and spread across the cycle. */
  rotationList: string[];
  /** Where in the rotation this run starts. */
  baseCursor: number;
  /** Posts this run — the owner's number, plus the seasonal window's extra one. */
  perPost: number;
  /** One keyword per post slot. */
  slotKeywords: string[];
  distinctKeywords: string[];
  /**
   * Occasion context for the copywriter (connect the product to the holiday) — for the
   * posts whose product a SEASONAL keyword found, and only those. Applied to every post it
   * told a tactical channel to tie army fatigues to the holiday table.
   */
  occasionHint: string | null;
  /** Sale-season context (11.11 / Black Friday) — true of every product in the feed. */
  saleSeasonHint: string | null;
  /** Lowercased seasonal keywords in this run — decides who gets the occasion hint. */
  seasonalKeywordSet: Set<string>;
  /** Lowercased bonus-pool keywords — the per-post copy angle keys off this. */
  bonusKeywordSet: Set<string>;
  /** How far the seasonal calendar got on this run — reported in the run note so an open
   *  window producing nothing is visible instead of silent (see seasonal-status.ts). */
  seasonalStatus: SeasonalStatus;
}

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
/** A product may repeat in a campaign, but not within this many days (cooldown). */
const PRODUCT_REPEAT_COOLDOWN_DAYS = 14;
/** How many extra keywords a run may try when its own slot keyword(s) return nothing.
 *  Bounded so one dead run can't turn into a long chain of affiliate-API calls. */
const KEYWORD_FALLBACK_ATTEMPTS = 5;
/** Window the weighted rotation scores keywords over — matches the optimizer's. */
const KEYWORD_SCORE_WINDOW_DAYS = 14;

/**
 * Which keywords a run may fall back to, in order, when every keyword the rotation gave it
 * came back dry. Continues the rotation from where this run's slots ended, so the campaign
 * keeps walking the whole keyword list instead of always retrying the same neighbour, and
 * never re-tries a keyword this run already searched. Bounded by `max`.
 */
export function fallbackKeywords(
  kwList: string[], startIndex: number, exclude: Set<string>, max: number,
): string[] {
  const out: string[] = [];
  const seen = new Set(exclude);
  for (let i = 0; i < kwList.length && out.length < max; i++) {
    const kw = kwList[(startIndex + i) % kwList.length];
    if (seen.has(kw)) continue;
    seen.add(kw);
    out.push(kw);
  }
  return out;
}

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
    .replace(/&lt;a href=(?:&quot;|")(.*?)(?:&quot;|")&gt;/gi, '<a href="$1">')
    // The closing </a> must be restored too — 'a' isn't in TG_TAGS, and an opening
    // anchor without its closing trips tagsBalanced → the whole message loses formatting.
    .replace(/&lt;\/a&gt;/gi, '</a>');

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

  /** Product ids a clip lookup came back empty for — see the send-time backfill. */
  private readonly noVideoProducts = new Set<string>();
  /** Hebrew keyword → English search phrase. Deterministic, so one lookup per keyword. */
  private readonly keywordCache = new Map<string, string>();

  constructor(
    @InjectRepository(Post)
    private readonly repo: Repository<Post>,
    @InjectRepository(Template)
    private readonly templateRepo: Repository<Template>,
    @InjectRepository(Campaign)
    private readonly campaignRepo: Repository<Campaign>,
    @InjectRepository(PostedProduct)
    private readonly postedRepo: Repository<PostedProduct>,
    @InjectRepository(UploadedImage)
    private readonly uploadedImages: Repository<UploadedImage>,
    private readonly credentials: CredentialsService,
    private readonly rates: RatesService,
    private readonly ai: AiService,
    private readonly subscription: SubscriptionService,
    private readonly channels: ChannelsService,
    private readonly collage: CollageService,
    private readonly coupons: CouponsService,
    private readonly links: LinksService,
    private readonly products: ProductsService,
    private readonly pinterest: PinterestService,
    private readonly incentive: IncentiveService,
    // Optional so the existing unit specs — which construct this service positionally —
    // keep working, and so a post still publishes if the storefront is ever unwired.
    @Optional() private readonly storefront?: StorefrontService,
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
    video_url?: string; brand_plus?: boolean;
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
      video_url: d.video_url || undefined,
      brand_plus: !!d.brand_plus,
    };
  }

  /**
   * The product's clip + Brand+ flag for a post that is about to be created.
   *
   * Campaign posts get these from the search result they were built from, but a post
   * published by hand (quick post / scheduled post / an agent run) is built from what the
   * UI already had on screen — which carries neither. Those posts were therefore saved
   * with product_video NULL, so "prefer the product video" had nothing to send and the
   * image went out instead, and a Brand+ item never got its badge.
   *
   * productdetail.get is the authoritative source for both fields. Only AliExpress ids
   * (numeric) are looked up — a supplier/FLYLINK sku has no entry there. Never throws:
   * a clip is a nice-to-have, and a lookup failure must not block a publish.
   */
  /**
   * Fill in a post's clip at send time when the row doesn't have one yet.
   *
   * Every post created before the video feature existed — and every post already sitting
   * in the queue when the toggle was switched on — carries product_video NULL, so the
   * preference had nothing to send and the image went out. Resolving it here (once, then
   * persisted on the row) makes the toggle apply to the standing queue too.
   */
  private async ensureProductVideo(post: Post, creds: DecryptedCredentials | null): Promise<void> {
    if (!creds?.prefer_product_video || post.product_video || !post.id) return;
    const key = String(post.product_id || '');
    if (!key || this.noVideoProducts.has(key)) return;

    const late = await this.productMediaFor(post.product_id, creds);
    if (late.video) {
      post.product_video = late.video;
      await this.repo.update({ id: post.id }, { product_video: late.video }).catch(() => undefined);
      return;
    }
    // Most products simply have no clip. Remember that, so a fan-out to five groups (or
    // the next post about the same item) doesn't spend five more lookups rediscovering
    // it — AliExpress throttles, and a throttled lookup costs seconds on the send path.
    if (this.noVideoProducts.size > 2000) this.noVideoProducts.clear();
    this.noVideoProducts.add(key);
  }

  private async productMediaFor(
    productId: string,
    creds: DecryptedCredentials,
    known?: { video_url?: string; brand_plus?: boolean } | null,
  ): Promise<{ video: string | null; brandPlus: boolean }> {
    if (known?.video_url) return { video: known.video_url, brandPlus: !!known.brand_plus };
    if (!/^\d{5,}$/.test(String(productId || ''))) {
      return { video: null, brandPlus: !!known?.brand_plus };
    }
    try {
      const detail = await this.productDetailById(String(productId), creds);
      return {
        video: detail?.video_url || null,
        brandPlus: detail ? !!detail.brand_plus : !!known?.brand_plus,
      };
    } catch (err: any) {
      this.logger.warn(`productMediaFor(${productId}) failed: ${err?.message}`);
      return { video: null, brandPlus: !!known?.brand_plus };
    }
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
   * The FIRST published post for a product (matched by product_id) — lets a REPOST reuse the
   * original copy + images verbatim instead of regenerating them. Null if never posted.
   * Used by the FLYLINK runner so re-posts stay identical to the first publish.
   */
  async findOriginalPost(userId: string, productId: string): Promise<Post | null> {
    if (!productId) return null;
    const key = String(productId);
    // A post the user explicitly pinned as the source wins over the default (earliest sent).
    const pinned = await this.repo.findOne({
      where: { user_id: userId, product_id: key, is_repost_source: true },
    });
    if (pinned) return pinned;
    return this.repo.findOne({
      where: { user_id: userId, product_id: key, status: 'sent' },
      order: { created_at: 'ASC' },
    });
  }

  /**
   * Pin ONE post as the template FLYLINK re-posts clone for its product (same copy + images).
   * Clears the flag on any other post of the same product so there's exactly one source.
   */
  async setRepostSource(userId: string, postId: string): Promise<Post> {
    const post = await this.repo.findOne({ where: { id: postId, user_id: userId } });
    if (!post) throw new NotFoundException('פוסט לא נמצא');
    if (!post.product_id) throw new BadRequestException('לפוסט אין מזהה מוצר — לא ניתן לקבוע אותו כמקור');
    // Exactly one source per product: clear the others first.
    await this.repo.update(
      { user_id: userId, product_id: post.product_id },
      { is_repost_source: false },
    );
    post.is_repost_source = true;
    await this.repo.save(post);
    return post;
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
   * The body template a post to THIS group should be written with: the group's own template
   * when it has one, otherwise the account default. Same precedence the footer already uses.
   *
   * Publishing by hand used to pass no template at all, so a manual post to a group came out
   * in the generic built-in voice while the autopilot's posts to the same group used the
   * owner's template — the same product looked like two different channels depending on
   * whether a cron fired it or a human clicked the button.
   */
  private async bodyTemplateFor(
    userId: string, creds: DecryptedCredentials, channelId?: string,
  ): Promise<string> {
    const own = await this.resolveBodyTemplate(userId, channelId).catch(() => '');
    return own || await this.getBodyText(userId, creds).catch(() => '');
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

  async list(userId: string, page = 1, limit = 20, status?: string, campaignId?: string, source?: string, platform?: string) {
    const qb = this.repo.createQueryBuilder('p')
      .leftJoin('p.campaign', 'c')
      // currency_pair comes along so each row can be LABELLED in the money it is actually
      // priced in. A campaign may override the account's currency (a USD Pinterest campaign
      // is the reason the field exists), and price_ils then holds that currency's amount —
      // the column name is historical. The screen used to stamp ₪ on every row regardless,
      // so a $6.40 pin read as ₪6.40: right number, wrong money.
      .addSelect(['c.name', 'c.currency_pair'])
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
    // Platform: what already went out there (the per-platform message id) OR what is still
    // headed there (the campaign's declared platforms) — see platform-filter.ts.
    const pf = platformFilterSql(platform);
    if (pf) qb.andWhere(pf.sql, pf.params);

    const [raw, total] = await qb.getManyAndCount();

    // Per-PLATFORM click breakdown for the listed posts, one grouped query. Sources come
    // from the ?s= tag each send path stamps on its link (click-source.ts); clicks from
    // links published before tagging existed have source NULL and report as 'other'.
    const ids = raw.map((p) => p.id);
    const clicksBySource = new Map<string, Record<string, number>>();
    if (ids.length) {
      const rows: Array<{ post_id: string; source: string | null; n: number }> = await this.repo.manager
        .query(
          `SELECT post_id, source, COUNT(*)::int AS n
           FROM link_clicks WHERE post_id = ANY($1)
           GROUP BY post_id, source`,
          [ids],
        )
        .catch(() => []);
      for (const r of rows) {
        const m = clicksBySource.get(r.post_id) || {};
        m[r.source || 'other'] = Number(r.n) || 0;
        clicksBySource.set(r.post_id, m);
      }
    }

    // The click LOG is the truth; posts.clicks_count is only a cache of it. The two are
    // written by separate statements (insert row, then increment counter), so a hiccup or
    // a deploy landing between them loses the increment — the screen then showed
    // "11 קליקים · פייסבוק 8 · טלגרם 6". Report the log's own total, and heal the stale
    // counter in the background so every OTHER reader of clicks_count (digest, optimizer,
    // watchdog, winner recycling) converges on the same number.
    // The account default, for posts with no campaign of their own to speak for them.
    const accountPair = (await this.credentials.getRaw(userId).catch(() => null))?.currency_pair;

    const data = raw.map((p) => {
      const bySource = clicksBySource.get(p.id) ?? null;
      const logged = bySource ? Object.values(bySource).reduce((s, n) => s + n, 0) : 0;
      if (bySource && logged !== (p.clicks_count ?? 0)) {
        void this.repo.update({ id: p.id }, { clicks_count: logged }).catch(() => {});
      }
      return {
        ...p,
        currency_symbol: currencySymbol(p.campaign?.currency_pair || accountPair),
        clicks_count: bySource ? logged : p.clicks_count,
        campaign_name: p.campaign?.name ?? null,
        clicks_by_source: bySource,
      };
    });
    return { data, total, page, limit };
  }

  // ── Preview ───────────────────────────────────────────────────────────────

  async preview(userId: string, productId: string, language = 'he', customProduct?: any, template?: string, images?: GenerateImage[], hint?: string, forceVision = false, promo?: { discount?: number | null; ends_at?: string | null }, copyHint?: string) {
    const creds = await this.credentials.getRaw(userId);
    const rate = await this.rates.getRate(creds?.currency_pair || 'USD_ILS');
    const product = customProduct || await this.searchProduct(productId, creds);

    const priceAlreadyConverted = product.currency && product.currency !== 'USD';
    const priceLocal = priceAlreadyConverted
      ? product.sale_price
      : +(product.sale_price * rate).toFixed(2);

    // Limited-time promo copy: pass the deal % and a human deadline label so the AI writes
    // urgency copy with the exact end time the auto-removal cron will act on.
    const promoOpt = promo
      ? { promo: { discount: promo.discount ?? null, endsLabel: this.promoEndsLabel(promo.ends_at) } }
      : undefined;
    // A copy-angle nudge (the bandit's pick) rides the same opts channel the promo does.
    const genOpts = copyHint ? { ...(promoOpt || {}), copyHint } : promoOpt;

    const text = await this.generateText(
      product, language, rate, creds,
      template || undefined,
      priceAlreadyConverted ? product.sale_price : undefined,
      images,
      hint,
      forceVision,
      genOpts,
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
      // Same currency as the preview's own price, and the same line the send path will
      // ship — the preview must never show the owner something different from what goes out.
      // The coupon tiers are stored in USD whatever the product price did, so this always
      // needs the full USD→local rate — never the identity rate a pre-converted price uses.
      coupon_line: match
        ? this.coupons.couponLine(match.coupon, match.qualifies, {
          rate, symbol: currencySymbol(creds?.currency_pair),
        })
        : null,
    };
  }

  /**
   * "צור מחדש עם AI" from the post editor: regenerate the copy from the CURRENT edited
   * fields. The plain preview path wrote from the title alone — so with an unchanged (or
   * thin) title the model happily rewrote the OLD product, and a freshly uploaded photo
   * changed nothing. Here the post's actual photo(s) go to the model as vision — the
   * edited main image FIRST — and the edited title rides as the authoritative hint.
   */
  async regenerateForPost(userId: string, postId: string, dto: {
    title?: string; price_ils?: number; image_url?: string; language?: string;
  }) {
    const post = await this.repo.findOne({ where: { id: postId, user_id: userId } });
    if (!post) throw new NotFoundException('פוסט לא נמצא');

    const title = String(dto.title || '').trim() || post.product_title || '';
    const mainImage = String(dto.image_url || '').trim() || post.product_image || '';
    const price = Number.isFinite(Number(dto.price_ils)) && Number(dto.price_ils) >= 0
      ? Number(dto.price_ils)
      : Number(post.price_ils) || 0;

    let gallery: string[] = [];
    try { gallery = post.gallery_json ? JSON.parse(post.gallery_json) : []; } catch { /* ignore */ }
    const urls = [mainImage, ...gallery.filter((u) => typeof u === 'string' && u && u !== mainImage)];
    const images = await this.fetchVisionImages(urls, 3);

    const product = {
      product_id: post.product_id,
      title,
      image_url: mainImage,
      product_url: post.affiliate_url || '',
      affiliate_url: post.affiliate_url || '',
      // Price is already in the account's local currency — flag it so preview doesn't
      // re-multiply by the exchange rate (same contract the old editor call used).
      sale_price: price, original_price: price, currency: 'ILS', price_ils: price,
      discount_percent: 0, orders_count: 0, rating: 0, category: '',
    };
    return this.preview(
      userId, post.product_id, dto.language || 'he', product,
      undefined, images, title || undefined, images.length > 0,
    );
  }

  /**
   * Fetch post photos → base64 for vision. SSRF-contained exactly like the public fit
   * endpoints: our own uploaded images are read straight from the DB, everything else
   * must pass the product-CDN allowlist. Failures are tolerated per-photo — vision
   * degrades, generation continues.
   */
  private async fetchVisionImages(urls: string[], max = 3): Promise<GenerateImage[]> {
    const out: GenerateImage[] = [];
    for (const raw of urls) {
      if (out.length >= max) break;
      const url = String(raw || '').trim();
      if (!url) continue;
      if (isOwnUploadedUrl(url)) {
        const img = await this.getUploadedImage(url.split('/').pop() || '').catch(() => null);
        if (img) out.push({ mime: img.mime || 'image/jpeg', data: img.data.toString('base64') });
        continue;
      }
      const target = unwrapOwnProxy(url);
      let host = '';
      try { host = new URL(target).hostname; } catch { continue; }
      if (!isIgFittableHost(host)) continue;
      try {
        const res = await axios.get(target, {
          responseType: 'arraybuffer', maxRedirects: 0,
          headers: igFetchHeaders(host),
          timeout: 12000, maxContentLength: 6 * 1024 * 1024, validateStatus: () => true,
        });
        if (res.status !== 200) continue;
        const mime = String(res.headers['content-type'] || 'image/jpeg').split(';')[0];
        out.push({ mime, data: Buffer.from(res.data).toString('base64') });
      } catch { /* one bad photo must not kill the regenerate */ }
    }
    return out;
  }

  // ── Limited-time promotions ───────────────────────────────────────────────

  /** Human, timezone-aware deadline label for promo copy — e.g. "26/07 בשעה 23:59". */
  private promoEndsLabel(endsAt?: string | null): string | null {
    if (!endsAt) return null;
    const d = new Date(endsAt);
    if (isNaN(d.getTime())) return null;
    const tz = process.env.SCHEDULER_TZ || 'Asia/Jerusalem';
    try {
      const date = new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', timeZone: tz }).format(d);
      const time = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(d);
      return `${date} בשעה ${time}`;
    } catch {
      return d.toISOString();
    }
  }

  /** Normalize the incoming promo fields into a persistable shape. Returns null when the
   *  post isn't a promo (or has no valid end time — a promo with no deadline is rejected). */
  private normalizePromo(promo?: { is_promo?: boolean; ends_at?: string | null; discount?: number | null }):
    { ends_at: Date; discount: number | null } | null {
    if (!promo?.is_promo) return null;
    const ends = promo.ends_at ? new Date(promo.ends_at) : null;
    if (!ends || isNaN(ends.getTime())) {
      throw new BadRequestException('מבצע לזמן מוגבל חייב מועד סיום תקין');
    }
    if (ends.getTime() <= Date.now()) {
      throw new BadRequestException('מועד סיום המבצע חייב להיות בעתיד');
    }
    const discount = promo.discount != null && Number.isFinite(Number(promo.discount))
      ? Math.round(Number(promo.discount)) : null;
    return { ends_at: ends, discount };
  }

  /** Resolve the bot token + chat id a promo post was published to — mirrors the send path
   *  (a saved group carries its own token; otherwise the account default). */
  private async resolvePromoTarget(post: Post): Promise<{ token?: string; chat?: string }> {
    const creds = await this.credentials.getRaw(post.user_id).catch(() => null);
    let token = creds?.telegram_bot_token;
    let chat = normalizeTelegramChatId(creds?.telegram_channel_id);
    const override = post.channel_override || this.resolveTargets(post).find((t): t is string => !!t);
    if (override) {
      const target = await this.channels.resolveSendTarget(post.user_id, override).catch(() => null);
      if (target) { chat = target.chatId; if (target.token) token = target.token; }
    }
    return { token, chat };
  }

  /** Remove one expired promo from Telegram: delete the message (works ≤48h after send);
   *  past that window Telegram blocks deletion, so edit it to an "ended" notice instead. */
  private async removePromoMessage(post: Post): Promise<void> {
    const { token, chat } = await this.resolvePromoTarget(post);
    if (!token || !chat || !post.telegram_message_id) return;
    try {
      await axios.post(
        `https://api.telegram.org/bot${token}/deleteMessage`,
        { chat_id: chat, message_id: post.telegram_message_id },
        { timeout: 12000 },
      );
    } catch {
      // Past the 48h delete window (or already gone) → mark the message as ended instead.
      // Promo posts carry a product photo, so the caption edit is the right call; fall back
      // to a text edit for the rare text-only promo.
      const ended = '🔚 <b>המבצע הסתיים</b>';
      await axios.post(
        `https://api.telegram.org/bot${token}/editMessageCaption`,
        { chat_id: chat, message_id: post.telegram_message_id, caption: ended, parse_mode: 'HTML' },
        { timeout: 12000 },
      ).catch(async () => {
        await axios.post(
          `https://api.telegram.org/bot${token}/editMessageText`,
          { chat_id: chat, message_id: post.telegram_message_id, text: ended, parse_mode: 'HTML' },
          { timeout: 12000 },
        ).catch(() => {});
      });
    }
  }

  /**
   * Auto-removal sweep (called every minute by the scheduler): find SENT promo posts whose
   * deadline has passed and take them down, then flag them so they're never reprocessed.
   * Returns how many were handled.
   */
  async expireDuePromos(): Promise<number> {
    const now = new Date();
    const due = await this.repo.createQueryBuilder('p')
      .where('p.is_promo = true')
      .andWhere('p.promo_expired = false')
      .andWhere("p.status = 'sent'")
      .andWhere('p.promo_ends_at IS NOT NULL')
      .andWhere('p.promo_ends_at <= :now', { now })
      .andWhere('p.telegram_message_id IS NOT NULL')
      .orderBy('p.promo_ends_at', 'ASC')
      .take(50)
      .getMany();

    let handled = 0;
    for (const post of due) {
      try {
        await this.removePromoMessage(post);
      } catch (err: any) {
        this.logger.warn(`promo removal failed for post ${post.id}: ${err?.message}`);
      }
      // Flag regardless: a promo whose window closed must not keep retrying forever, and the
      // message is either gone or marked "ended". A genuinely transient Telegram blip is an
      // acceptable rare miss versus an every-minute retry loop.
      post.promo_expired = true;
      await this.repo.save(post).catch(() => {});
      handled++;
    }
    return handled;
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
    promo?: { is_promo?: boolean; ends_at?: string | null; discount?: number | null },
  ) {
    const creds = await this.credentials.getRaw(userId);
    const rate = await this.rates.getRate(creds?.currency_pair || 'USD_ILS');
    const promoNorm = this.normalizePromo(promo);

    // Prefer the price/title the frontend already has; otherwise fetch (only when no
    // image was supplied). This keeps the real price instead of a ₪0 / empty-title post.
    const product = this.productFromData(productData)
      || (productImageOverride ? null : await this.searchProduct(productId, creds));

    const affiliateUrl = affiliateUrlOverride
      || await this.getAffiliateLink(productId, creds);

    const parts = this.priceParts(product, rate);
    // Write in the voice of the group this is going to, exactly as a campaign post would.
    const template = textOverride ? '' : await this.bodyTemplateFor(userId, creds, channels?.[0] || channelOverride);
    const text = textOverride || await this.generateText(
      product || { title: productId, sale_price: 0, original_price: 0, discount_percent: 0, orders_count: 0, rating: 0, currency: 'USD' },
      'he', rate, creds, template || undefined, parts.localOverride, undefined, undefined, false,
      promoNorm ? { promo: { discount: promoNorm.discount, endsLabel: this.promoEndsLabel(promo?.ends_at) } } : undefined,
    );

    // A hand-published product deserves the same clip and Brand+ badge a campaign post
    // gets — the UI it was launched from doesn't carry either, so resolve them here.
    const media = await this.productMediaFor(productId, creds, product);

    const post = this.repo.create({
      user_id: userId,
      product_id: productId,
      product_title: product?.title || '',
      product_image: productImageOverride || product?.image_url || '',
      product_video: media.video,
      is_brand_plus: media.brandPlus,
      affiliate_url: affiliateUrl,
      original_price_usd: parts.origUsd,
      sale_price_usd: parts.saleUsd,
      price_ils: product ? parts.priceIls : 0,
      generated_text: text,
      status: 'pending',
      pending_at: new Date(),
      is_promo: !!promoNorm,
      promo_ends_at: promoNorm?.ends_at,
      promo_discount: promoNorm?.discount ?? null,
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
    promo?: { is_promo?: boolean; ends_at?: string | null; discount?: number | null },
    images?: string[],               // gallery: >1 image → sent as a Telegram album
  ) {
    const creds = await this.credentials.getRaw(userId);
    const rate = await this.rates.getRate(creds?.currency_pair || 'USD_ILS');
    const promoNorm = this.normalizePromo(promo);
    // A scheduled promo whose deadline is at/before its publish time would auto-remove the
    // instant it goes out — reject it up front so the user picks a sane window.
    if (promoNorm && promoNorm.ends_at.getTime() <= scheduledAt.getTime()) {
      throw new BadRequestException('מועד סיום המבצע חייב להיות אחרי מועד הפרסום המתוזמן');
    }

    const gallery = (images || []).map((s) => (s || '').trim()).filter(Boolean);

    const product = this.productFromData(productData)
      || (productImageOverride ? null : await this.searchProduct(productId, creds));

    const affiliateUrl = affiliateUrlOverride
      || await this.getAffiliateLink(productId, creds);

    const parts = this.priceParts(product, rate);
    // Same group voice as an immediate publish — a scheduled post must not read differently.
    const template = textOverride ? '' : await this.bodyTemplateFor(userId, creds, channels?.[0] || channelOverride);
    const text = textOverride || await this.generateText(
      product || { title: productId, sale_price: 0, original_price: 0, discount_percent: 0, orders_count: 0, rating: 0, currency: 'USD' },
      'he', rate, creds, template || undefined, parts.localOverride, undefined, undefined, false,
      promoNorm ? { promo: { discount: promoNorm.discount, endsLabel: this.promoEndsLabel(promo?.ends_at) } } : undefined,
    );

    // Same enrichment as an immediate publish — a scheduled post must not go out poorer.
    const media = await this.productMediaFor(productId, creds, product);

    const post = this.repo.create({
      user_id: userId,
      product_id: productId,
      product_title: product?.title || '',
      product_image: productImageOverride || gallery[0] || product?.image_url || '',
      product_video: media.video,
      is_brand_plus: media.brandPlus,
      affiliate_url: affiliateUrl,
      original_price_usd: parts.origUsd,
      sale_price_usd: parts.saleUsd,
      price_ils: product ? parts.priceIls : 0,
      generated_text: text,
      status: 'scheduled',
      scheduled_at: scheduledAt,
      // >1 image → a Telegram media-group album (variants/colors). Capped at 10 (TG limit).
      gallery_json: gallery.length > 1 ? JSON.stringify(gallery.slice(0, 10)) : null,
      is_promo: !!promoNorm,
      promo_ends_at: promoNorm?.ends_at,
      promo_discount: promoNorm?.discount ?? null,
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
    post.pending_at = new Date();
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
      /** The product's own promo video (AliExpress product_video_url), when it has one. */
      video_url?: string;
      /** AliExpress Brand+ ("Certified Original") official brand-store listing. */
      brand_plus?: boolean;
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
    opts?: { scheduledAt?: Date; campaignId?: string; keyword?: string; copyVariant?: string },
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
      keyword: opts?.keyword || null,
      // The angle the copy was written in (FLYLINK runner) — clicks per angle are how the
      // bandit learns; without recording it here those posts were invisible to it.
      copy_variant: opts?.copyVariant || null,
      product_id: product.product_id,
      product_title: product.title,
      product_image: product.image_url,
      product_video: product.video_url || null,
      is_brand_plus: !!product.brand_plus,
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

    // Atomically CLAIM the post: flip queued → pending in one statement. If another
    // worker (or a re-entrant tick) already took it, affected = 0 → skip, so the same
    // post can't be published and charged twice.
    const claim = await this.repo.createQueryBuilder()
      .update(Post).set({ status: 'pending', pending_at: () => 'NOW()' })
      .where('id = :id AND status = :queued', { id: next.id, queued: 'queued' })
      .execute();
    if (!claim.affected) return { sent: false };
    next.status = 'pending';
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
    gallery?: string[]; channels?: string[];
  }): Promise<Post> {
    const post = await this.repo.findOne({ where: { id: postId, user_id: userId } });
    if (!post) throw new NotFoundException('פוסט לא נמצא');

    // Re-targeting from the editor: the group(s) this post publishes to. An explicit EMPTY
    // list means "back to the default channel". Every id is verified against the owner's
    // own saved channels — the field decides where a real message is delivered, so an
    // unknown or someone else's id must never reach the send path.
    if (dto.channels !== undefined) {
      const uniq = Array.from(new Set((dto.channels || [])
        .map((c) => (typeof c === 'string' ? c.trim() : '')).filter(Boolean)));
      for (const id of uniq) {
        const known = await this.channels.getName(userId, id).catch(() => null);
        if (!known) throw new BadRequestException(`הקבוצה שנבחרה (${id}) אינה שמורה בחשבון שלך`);
      }
      post.channel_override = uniq[0] || null;
      post.channel_overrides = uniq.length > 1 ? JSON.stringify(uniq) : null;
    }
    if (typeof dto.text === 'string') post.generated_text = dto.text;
    if (typeof dto.product_title === 'string') post.product_title = dto.product_title;
    if (typeof dto.product_image === 'string' && dto.product_image.trim()) {
      const nextImage = dto.product_image.trim();
      // A post with an album publishes the ALBUM — product_image is only the fallback
      // (see prepareTelegramMedia). Changing the main image without touching the album
      // therefore changed nothing visible ("העליתי תמונה ולא רואה שהתחלפה"): the new
      // image must LEAD the album too. The old main is dropped from it — this is a
      // replacement, not an addition. Skipped when the editor sent an explicit gallery
      // selection (the FLYLINK editor) — there the selection is the whole truth.
      if (nextImage !== post.product_image && !Array.isArray(dto.gallery) && post.gallery_json) {
        try {
          const g: unknown = JSON.parse(post.gallery_json);
          if (Array.isArray(g)) {
            const rest = g.filter((u) => typeof u === 'string' && u !== nextImage && u !== post.product_image);
            post.gallery_json = JSON.stringify([nextImage, ...rest].slice(0, 30));
          }
        } catch { /* unreadable album — the main image alone still applies */ }
      }
      post.product_image = nextImage;
    }
    if (typeof dto.affiliate_url === 'string') post.affiliate_url = dto.affiliate_url.trim();
    // Full gallery re-selection (the posts-screen editor): the ORDERED list the owner
    // picked becomes the album, and its first image becomes the main one — same "first
    // pick is the cover" rule as the supplier composer. This is what a REPUBLISH (and a
    // campaign repost that mirrors this post) will carry from now on.
    if (Array.isArray(dto.gallery)) {
      const clean = dto.gallery
        .filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u.trim()))
        .map((u) => u.trim())
        .slice(0, 30);
      if (clean.length) {
        post.gallery_json = JSON.stringify(clean);
        post.product_image = clean[0];
      }
    }
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

  /** The latest future-booked time on a group across ALL campaigns and manual posts —
   *  what a deliberate queue addition (smart intake) must chain behind. */
  private async furthestGroupBooking(userId: string, groupId: string): Promise<Date | null> {
    const row = await this.repo.createQueryBuilder('p')
      .select('MAX(COALESCE(p.scheduled_at, p.pending_at))', 'max')
      .where('p.user_id = :userId', { userId })
      .andWhere("p.status IN ('scheduled','queued','pending')")
      .andWhere('(p.channel_override = :g OR p.channel_overrides LIKE :like)', { g: groupId, like: `%"${groupId}"%` })
      .getRawOne()
      .catch(() => null);
    return row?.max ? new Date(row.max) : null;
  }

  /** Where an intake post starts looking for a slot: one interval after the group's
   *  furthest FUTURE booking, or now when the calendar ahead is clear. Pure for tests. */
  static intakeNotBefore(furthest: Date | null, intervalMin: number, nowMs: number): Date {
    return furthest && furthest.getTime() > nowMs
      ? new Date(furthest.getTime() + intervalMin * 60_000)
      : new Date(nowMs);
  }

  /**
   * Follow an AliExpress short link (s.click.aliexpress.com/e/…) server-side until a
   * product id appears in the URL. Redirects are followed manually, at most 6 hops, and
   * ONLY while the host stays on aliexpress — the link comes from the owner's own file,
   * but an open follower would still be an SSRF surface. Null when nothing resolves.
   */
  private async resolveAliShortLink(url: string): Promise<string | null> {
    let current = String(url || '').trim();
    for (let hop = 0; hop < 6; hop++) {
      let host = '';
      try { host = new URL(current).hostname; } catch { return null; }
      if (!/aliexpress\.(com|us|ru)$|aliexpress\./i.test(host)) return null;
      const found = extractAliProductId(current);
      if (found) return found;
      // One retry per hop — a single connection blip on a 211-row import otherwise
      // permanently leaves that row text-only.
      let res: any = null;
      for (let attempt = 0; attempt < 2 && !res; attempt++) {
        res = await axios.get(current, {
          maxRedirects: 0, timeout: 8000, validateStatus: () => true,
          maxContentLength: 512 * 1024,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        }).catch(() => null);
        if (!res && attempt === 0) await new Promise((r) => setTimeout(r, 700));
      }
      const loc = res?.headers?.location;
      if (!loc) {
        // No redirect header — often a page that redirects via JavaScript; the item
        // URL is still in the markup (raw or percent-encoded).
        return extractAliProductId(current)
          || extractAliProductIdFromHtml(typeof res?.data === 'string' ? res.data : '');
      }
      try { current = new URL(loc, current).toString(); } catch { return null; }
    }
    return extractAliProductId(current);
  }

  /**
   * Import rows from the owner's product FILE (name + hand-written benefits + short
   * affiliate link) into the auto-send queue. Per row: skip links already imported
   * (re-uploading the file is safe — and heals still-queued rows that imported without
   * an image), resolve the short link to a product id and enrich
   * image/price from the affiliate API (best-effort — a row that doesn't resolve still
   * imports, text-only, price line omitted), compose the post FROM THE FILE'S OWN COPY
   * (no AI credits), and queue it — the drip paces it like any other queued post.
   * Batched by the caller (the resolution round-trips are slow); capped per call.
   */
  /**
   * Smart link intake: an AliExpress product URL → the product, a search keyword, the
   * best-fitting campaign — and a post scheduled through that campaign's own routing.
   *
   * One model call answers both questions (which campaign by AUDIENCE, what keyword);
   * the keyword joins the campaign's rotation so future runs find more like this product.
   * No fitting campaign — or no AI key, or an unreadable verdict — HANDS THE CHOICE TO
   * THE OWNER: a wrong audience assignment posts to a real group of real people, so the
   * judge fails closed (see smart-intake.ts) and the modal shows the campaign list
   * instead of silently dropping into the default queue. The follow-up call carries the
   * owner's pick in `campaignId` (or `toQueue` for an explicit default-queue choice).
   */
  async smartIntake(userId: string, url: string, opts?: { campaignId?: string; campaignIds?: string[]; toQueue?: boolean }): Promise<
    | {
      needs_choice: true; product_title: string; keyword: string;
      campaigns: Array<{ id: string; name: string; status: string }>;
    }
    | {
      post_id: string; keyword: string; campaign_name: string | null;
      keyword_added: boolean; scheduled_at: Date | null; note: string;
      posts?: Array<{ post_id: string; campaign_name: string | null; scheduled_at: Date | null }>;
    }
  > {
    const creds = await this.credentials.getRaw(userId);
    if (!creds) throw new BadRequestException('חסרים פרטי חיבור — הגדר אותם במסך ההגדרות');
    const link = String(url || '').trim();
    if (!link) throw new BadRequestException('הדבק קישור למוצר');

    // Product id: straight off a full URL, else through the short-link resolver the
    // importer uses (redirect chasing + HTML scan).
    const direct = link.match(/\/item\/(\d{6,})/);
    const productId = direct?.[1] || await this.resolveAliShortLink(link);
    if (!productId) throw new BadRequestException('לא זוהה מוצר בקישור — ודא שזה קישור מוצר של AliExpress');
    let product = await this.productDetailById(productId, creds).catch(() => null);
    if (!product) {
      const found = await this.searchProducts({ keyword: productId, limit: 5 }, creds).catch(() => []);
      product = found.find((p: any) => String(p.product_id) === productId) || null;
    }
    if (!product) {
      throw new BadRequestException(`מוצר ${productId} לא הוחזר מה-API — ייתכן שאינו זמין בתוכנית השותפים`);
    }

    // The judge sees every AliExpress campaign, paused included — a paused campaign's
    // audience is still ITS audience, and the post publishes via the scheduled-send cron
    // regardless of the campaign's own cron being paused.
    const campaigns = (await this.campaignRepo.find({ where: { user_id: userId } }))
      .filter((c) => (c.source || 'aliexpress') === 'aliexpress' && ['active', 'paused'].includes(c.status));
    let verdict: IntakeVerdict | null = null;
    if (campaigns.length && this.ai.hasAnyKey(creds)) {
      const profiles: IntakeCampaignProfile[] = await Promise.all(campaigns.map(async (c) => ({
        name: c.name,
        keywords: (c.keywords || []).slice(0, 12),
        channels: (await Promise.all(this.parseTargetChannels(c.target_channels)
          .map((t) => this.channels.getName(userId, t).catch(() => null))))
          .filter((n): n is string => !!n),
      })));
      try {
        const res = await this.ai.generate(creds, {
          system: SMART_INTAKE_SYSTEM,
          prompt: buildSmartIntakePrompt(
            { title: String(product.title || ''), category: product.category },
            profiles,
          ),
          maxTokens: 160,
          temperature: 0,
        });
        verdict = res?.text ? parseIntakeVerdict(res.text, campaigns.length) : null;
      } catch { verdict = null; }
    }

    const keyword = verdict?.keyword || fallbackKeyword(String(product.title || '')) || 'product';
    const campaign = verdict && verdict.campaign >= 0 ? campaigns[verdict.campaign] : null;

    // The OWNER's explicit pick(s) outrank the judge (the follow-up call after
    // needs_choice, or a deliberate override) — validated against their own campaign
    // list. More than one pick publishes the product through EACH chosen campaign's own
    // routing (groups, platforms, language, currency); same-group posts chain on the
    // group's pacing so they never stack onto one minute.
    const pickedIds = Array.from(new Set(
      opts?.campaignIds?.length ? opts.campaignIds : (opts?.campaignId ? [opts.campaignId] : []),
    ));
    let chosen: Campaign[] = [];
    if (pickedIds.length) {
      chosen = pickedIds.map((id) => {
        const c = campaigns.find((x) => x.id === id);
        if (!c) throw new BadRequestException('הקמפיין שנבחר לא נמצא');
        return c;
      });
    } else if (campaign) {
      chosen = [campaign];
    }

    // Judge came up empty and the owner has campaigns to choose from → return the list
    // instead of creating anything. Explicit toQueue (the owner confirmed "default
    // queue") or an account with no campaigns at all proceeds as before.
    if (!chosen.length && !opts?.toQueue && campaigns.length) {
      return {
        needs_choice: true as const,
        product_title: String(product.title || ''),
        keyword,
        campaigns: campaigns.map((c) => ({ id: c.id, name: c.name, status: c.status })),
      };
    }

    // One post per chosen campaign, SEQUENTIALLY: the group-slot query must see the
    // previous iteration's save to chain same-group bookings, and serial AI calls avoid
    // a provider burst. `null` = the no-campaign default-queue path.
    const createFor = async (target: Campaign | null) => {
      const currencyPair = target?.currency_pair?.trim() || creds.currency_pair || 'USD_ILS';
      const rate = await this.rates.getRate(currencyPair);
      const parts = this.priceParts(product, rate);
      const affiliateUrl = await this.getAffiliateLink(product.product_id, creds);

      const platforms = this.parseTargetPlatforms(target?.target_platforms);
      const pinterestOnly = !!platforms && platforms.size === 1 && platforms.has('pinterest');
      const template = target?.post_template?.trim()
        || (pinterestOnly ? '' : await this.getBodyText(userId, creds));
      const text = await this.generateText(
        product, target?.language || 'he', rate, creds, template || undefined, parts.localOverride,
        undefined, undefined, false,
        { currencyPair, style: pinterestOnly ? 'pinterest' : undefined },
      );

      const targets = target ? this.parseTargetChannels(target.target_channels) : [];
      // Slot the post into the target group's pacing (manual intake takes the next free
      // slot — never dropped); no campaign → the standard queue drip on the default channel.
      let scheduledAt: Date | null = null;
      if (target && targets.length && (!platforms || platforms.has('telegram'))) {
        // Chain behind the group's FURTHEST existing booking. The pacing horizon (rightly)
        // ignores bookings beyond one interval — but the slot query also sees only the MAX
        // pending per campaign, so once intake #2 booked an hour out, intake #1's nearer slot
        // was shadowed, the group looked free, and every further pasted product stacked onto
        // the same minute (observed: eight links, one 15:04). Intake posts are deliberate
        // queue additions — each starts looking one interval after the last one booked.
        const intervalMin = (await this.channels.getIntervalMinutes(userId, targets[0]).catch(() => null)) ?? 60;
        const furthest = await this.furthestGroupBooking(userId, targets[0]);
        const notBefore = PostsService.intakeNotBefore(furthest, intervalMin, Date.now());
        const { slot } = await this.nextGroupSlot(userId, targets[0], notBefore, target.id, null);
        scheduledAt = slot;
      } else if (target) {
        scheduledAt = new Date();
      }

      const post = this.repo.create({
        user_id: userId,
        campaign_id: target?.id || null,
        product_id: product.product_id,
        product_title: product.title,
        product_image: product.image_url,
        product_video: product.video_url || null,
        is_brand_plus: !!product.brand_plus,
        affiliate_url: affiliateUrl,
        original_price_usd: parts.origUsd,
        sale_price_usd: parts.saleUsd,
        price_ils: parts.priceIls,
        generated_text: text,
        keyword,
        status: scheduledAt ? 'scheduled' : 'queued',
        scheduled_at: scheduledAt,
      } as Partial<Post>);
      if (targets.length) this.applyChannels(post as Post, targets);
      if (!scheduledAt) {
        const maxOrder = await this.repo.createQueryBuilder('p')
          .select('MAX(p.queue_order)', 'maxOrder')
          .where('p.user_id = :userId AND p.status = :status', { userId, status: 'queued' })
          .getRawOne();
        (post as Post).queue_order = (maxOrder?.maxOrder ?? -1) + 1;
      }
      const saved = await this.repo.save(post);

      // File the keyword into the campaign's rotation — manual intent also un-retires it.
      let keywordAdded = false;
      if (target && !(target.keywords || []).includes(keyword)) {
        target.keywords = [...(target.keywords || []), keyword];
        target.retired_keywords = (target.retired_keywords || []).filter((k) => k !== keyword);
        await this.campaignRepo.save(target).catch(() => {});
        keywordAdded = true;
      }
      if (target) {
        await this.postedRepo.query(
          `INSERT INTO campaign_posted_products (campaign_id, product_id, keyword, created_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (campaign_id, product_id) DO UPDATE SET created_at = now(), keyword = EXCLUDED.keyword`,
          [target.id, String(product.product_id), keyword],
        ).catch(() => {});
      }
      return {
        post_id: (saved as Post).id,
        campaign_name: target?.name || null,
        scheduled_at: scheduledAt,
        keyword_added: keywordAdded,
      };
    };

    const made: Array<{ post_id: string; campaign_name: string | null; scheduled_at: Date | null; keyword_added: boolean }> = [];
    for (const c of chosen.length ? chosen : [null]) made.push(await createFor(c));

    const names = made.map((m) => m.campaign_name).filter((n): n is string => !!n);
    return {
      post_id: made[0].post_id,
      keyword,
      campaign_name: names.join(' + ') || null,
      keyword_added: made.some((m) => m.keyword_added),
      scheduled_at: made[0].scheduled_at,
      // Present only on a multi-campaign intake — one entry per created post.
      posts: made.length > 1
        ? made.map((m) => ({ post_id: m.post_id, campaign_name: m.campaign_name, scheduled_at: m.scheduled_at }))
        : undefined,
      note: names.length
        ? (pickedIds.length
          ? (names.length > 1 ? `שויך ל-${names.length} טייסים לפי בחירתך` : 'שויך לטייס לפי בחירתך')
          : (verdict?.reason || 'שויך לפי התאמת קהל'))
        : (opts?.toQueue
          ? 'נכנס לתור ערוץ ברירת המחדל לפי בחירתך'
          : 'אין טייסים בחשבון — הפוסט נכנס לתור של ערוץ ברירת המחדל'),
    };
  }

  async importCustomPosts(
    userId: string,
    rows: ImportRowInput[],
    channels?: string[],
  ): Promise<{ queued: number; duplicates: number; enriched: number; failed: number; results: Array<{ title: string; status: string; reason?: string }> }> {
    const creds = await this.credentials.getRaw(userId);
    const list = (rows || []).slice(0, 10);
    const rate = await this.rates.getRate(creds?.currency_pair || 'USD_ILS').catch(() => 0);
    const targets = Array.from(new Set((channels || []).filter((c) => typeof c === 'string' && c.trim())));
    const results: Array<{ title: string; status: string; reason?: string }> = [];

    for (const raw of list) {
      if (!validImportRow(raw)) {
        results.push({ title: String((raw as any)?.title || '(ללא שם)').slice(0, 60), status: 'failed', reason: 'חסר שם מוצר או קישור' });
        continue;
      }
      const link = raw.link.trim();
      const dup = await this.repo.findOne({ where: { user_id: userId, affiliate_url: link } });
      // Re-uploading the file is the repair path: a row that imported text-only or
      // price-less (the short link / API didn't deliver at the time) gets another
      // enrichment chance while it is still queued. Anything already sent is left alone.
      const healable = dup && dup.status === 'queued' && (!dup.product_image || !(Number(dup.price_ils) > 0));
      if (dup && !healable) { results.push({ title: raw.title.slice(0, 60), status: 'duplicate' }); continue; }

      let details: any = null;
      let enrichMiss: string | undefined;
      try {
        const productId = await this.resolveAliShortLink(link);
        if (!productId) {
          enrichMiss = 'הקישור המקוצר לא נפתח לעמוד מוצר';
        } else if (creds) {
          details = await this.productDetailById(productId, creds).catch(() => null);
          if (!details) {
            // Exact match ONLY — a keyword search for a numeric id can return unrelated
            // products, and a wrong image on the owner's product is worse than none.
            const found = await this.searchProducts({ keyword: productId, limit: 5 }, creds).catch(() => []);
            details = found.find((p: any) => String(p.product_id) === productId) || null;
          }
          if (details) details.__resolved_id = productId;
          else enrichMiss = `מוצר ${productId} לא הוחזר מה-API`;
        }
      } catch { details = null; enrichMiss = enrichMiss || 'שגיאה זמנית בהעשרה'; }
      if (enrichMiss) this.logger.warn(`importCustomPosts: ${enrichMiss} — ${link}`);

      // productdetail.get returns the price already in the target currency (₪) — only a
      // genuinely-USD price is multiplied by the exchange rate.
      const sale = Number(details?.sale_price) || 0;
      const saleIsUsd = (details?.currency || 'USD') === 'USD';
      const priceIls = sale ? (saleIsUsd ? (rate ? Math.round(sale * rate) : null) : Math.round(sale)) : null;
      const text = composeImportText(raw, priceIls);

      if (healable) {
        // Still couldn't enrich — report WHY so the user sees which rows stayed bare.
        if (!details) { results.push({ title: raw.title.slice(0, 60), status: 'duplicate', reason: enrichMiss }); continue; }
        dup.product_id = details.__resolved_id;
        dup.product_image = details.image_url || dup.product_image;
        if (priceIls) {
          const orig = Number(details?.original_price) || sale;
          dup.price_ils = priceIls;
          dup.sale_price_usd = saleIsUsd ? sale : (rate ? +(sale / rate).toFixed(2) : dup.sale_price_usd);
          dup.original_price_usd = saleIsUsd ? orig : (rate ? +(orig / rate).toFixed(2) : dup.original_price_usd);
          dup.generated_text = text;
        }
        await this.repo.save(dup);
        results.push({ title: raw.title.slice(0, 60), status: 'enriched' });
        continue;
      }

      const product = {
        product_id: details?.__resolved_id || `file_${Buffer.from(link).toString('base64url').slice(0, 16)}`,
        title: raw.title.trim(),
        image_url: details?.image_url || '',
        affiliate_url: link,
        sale_price: sale,
        original_price: Number(details?.original_price) || sale,
        // Priced rows keep the API's currency; an unresolved row must not be
        // multiplied by the exchange rate.
        currency: sale ? (details?.currency || 'USD') : 'ILS',
        discount_percent: Number(details?.discount_percent) || 0,
        orders_count: Number(details?.orders_count) || 0,
        rating: Number(details?.rating) || 0,
      };
      try {
        await this.createQueuedPost(
          userId, product, undefined, text, targets[0], undefined, undefined, targets,
          { keyword: raw.keyword?.trim() || undefined },
        );
        results.push({ title: raw.title.slice(0, 60), status: 'queued', reason: enrichMiss });
      } catch (e: any) {
        results.push({ title: raw.title.slice(0, 60), status: 'failed', reason: String(e?.message || '').slice(0, 120) });
      }

      // Gentle pacing between rows — the affiliate API throttles bursty callers, and a
      // throttled call is exactly how a live product ends up imported without an image.
      await new Promise((r) => setTimeout(r, 250));
    }

    return {
      queued: results.filter((r) => r.status === 'queued').length,
      duplicates: results.filter((r) => r.status === 'duplicate').length,
      enriched: results.filter((r) => r.status === 'enriched').length,
      failed: results.filter((r) => r.status === 'failed').length,
      results,
    };
  }

  /**
   * The post's original main image — the enhanced-frame endpoint's fallback when the
   * in-memory frame died (deploy/restart) before Instagram/Facebook fetched it. Public,
   * id-keyed on purpose: platform fetchers can't authenticate, and post ids are
   * unguessable UUIDs (same stance as the frame endpoint itself).
   */
  async postImageForFrame(postId: string): Promise<string | null> {
    const post = await this.repo.findOne({ where: { id: postId } });
    if (!post) return null;
    if (post.product_image) return post.product_image;
    try {
      const g = post.gallery_json ? JSON.parse(post.gallery_json) : [];
      return (Array.isArray(g) && g[0]) || null;
    } catch { return null; }
  }

  /** An owned post or 404 — for cross-module readers (e.g. the suppliers gallery editor). */
  async getOwnedPost(userId: string, postId: string): Promise<Post> {
    const post = await this.repo.findOne({ where: { id: postId, user_id: userId } });
    if (!post) throw new NotFoundException('פוסט לא נמצא');
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

  /**
   * Is the send window for this destination currently open? Group window overrides the
   * account's; default (no group) uses the account window; 9–22 when unset. Same rule
   * the campaign runner uses (isCampaignWindowOpen) so creation and release agree.
   */
  private async isSendWindowOpen(userId: string, groupId: string | null): Promise<boolean> {
    const win = groupId ? await this.channels.getScheduleWindow(userId, groupId).catch(() => null) : null;
    const creds = await this.credentials.getRaw(userId).catch(() => null);
    const startHour = win?.startHour ?? creds?.schedule_start_hour ?? 9;
    const endHour = win?.endHour ?? creds?.schedule_end_hour ?? 22;
    const tz = process.env.SCHEDULER_TZ || 'Asia/Jerusalem';
    return this.isWithinWindow(new Date(), tz, startHour, endHour);
  }

  async findDueScheduledPosts(): Promise<Post[]> {
    const now = new Date();
    const DUE_CAP = 1000; // memory backstop — a per-minute cron must never load unbounded rows
    const due = await this.repo
      .createQueryBuilder('p')
      .where('p.status = :status', { status: 'scheduled' })
      .andWhere('p.scheduled_at <= :now', { now })
      .orderBy('p.scheduled_at', 'ASC')
      .take(DUE_CAP)
      .getMany();
    if (due.length === DUE_CAP) {
      this.logger.warn(`findDueScheduledPosts hit the ${DUE_CAP}-row cap — a backlog is draining; oldest are processed first`);
    }

    // Release the OLDEST due post per group this tick, and RE-SPACE that group's remaining
    // overdue posts into future slots (now + N·interval). This uses scheduled_at — an
    // IMMUTABLE pacing source nothing external can freeze — to fix three symptoms at once:
    //  • stuck backlog: drains one per interval instead of freezing on a shared clock;
    //  • 06:00/06:01 double: the 2nd overdue post is pushed to the next interval;
    //  • runaway pile-up: the future scheduled_at makes nextGroupSlot report booked-ahead,
    //    so an over-subscribed group (2 campaigns, 1/hour interval) can't accumulate.
    //
    // AND the send window is enforced HERE: a group whose window is currently CLOSED
    // releases NOTHING (posts wait for the window to reopen) — the scheduled-send path
    // had no window check, so an overdue backlog fired at 00:24 even with a 23:00 cutoff.
    const picked: Post[] = [];
    const headTaken = new Set<string>();
    const backlog = new Map<string, Post[]>();
    const windowOpen = new Map<string, boolean>();
    const tgCache = new Map<string, boolean>(); // campaign_id → publishes to Telegram
    const queueTurn = new Map<string, boolean>(); // group key → this slot belongs to the manual queue

    // Does this post actually publish to the group's Telegram channel? A campaign
    // filtered to Instagram/Pinterest carries channel_override only for targeting —
    // it must NOT compete for the group's one-per-interval Telegram slot.
    const publishesTelegram = async (p: Post): Promise<boolean> => {
      // A post-level override outranks the campaign — and must dodge the campaign cache,
      // or one overridden post would stamp its answer onto every sibling.
      const own = this.parseTargetPlatforms(p.target_platforms);
      if (own) return own.has('telegram');
      if (!p.campaign_id) return true;
      if (!tgCache.has(p.campaign_id)) {
        const only = await this.postPlatformFilter(p).catch(() => null);
        tgCache.set(p.campaign_id, !only || only.has('telegram'));
      }
      return tgCache.get(p.campaign_id)!;
    };

    for (const p of due) {
      // Non-Telegram posts (e.g. Instagram-only) send straight through — they don't
      // share the Telegram group's pacing, so they can't steal a Telegram slot or be
      // re-spaced by it. This is what made a group publish at 06:00 & 08:00 instead of
      // every hour: an Instagram post grabbed the 07:00 head and pushed the Telegram
      // post to 08:00.
      if (!(await publishesTelegram(p))) { picked.push(p); continue; }

      const key = `${p.user_id}::${p.channel_override || 'default'}`;
      if (!windowOpen.has(key)) {
        windowOpen.set(key, await this.isSendWindowOpen(p.user_id, p.channel_override || null).catch(() => true));
      }
      if (!windowOpen.get(key)) continue; // window closed → hold everything for this group
      if (!headTaken.has(key)) {
        // FAIRNESS vs the manual queue: queued posts are time-less, so they occupy nothing
        // in the group's calendar — campaigns booked EVERY interval and seven queued posts
        // slid "~14:00 → ~15:00" forever. While the queue has posts waiting, the group's
        // slots alternate: a slot after a campaign send is the queue's — the campaign head
        // yields it (re-spaced +interval below) and processQueue's drip takes it instead.
        if (!queueTurn.has(key)) {
          queueTurn.set(key, await this.manualQueueOwnsSlot(p.user_id, p.channel_override || null).catch(() => false));
        }
        if (queueTurn.get(key)) {
          headTaken.add(key); // consume the head marker without picking — the queue sends this slot
          const arr = backlog.get(key) || [];
          arr.push(p);
          backlog.set(key, arr);
          continue;
        }
        headTaken.add(key);
        picked.push(p);
      } else {
        const arr = backlog.get(key) || [];
        arr.push(p);
        backlog.set(key, arr);
      }
    }

    for (const [key, posts] of backlog) {
      const groupId = key.slice(key.indexOf('::') + 2);
      const interval = groupId === 'default'
        ? 60
        : ((await this.channels.getIntervalMinutes(posts[0].user_id, groupId).catch(() => null)) ?? 60);
      posts.forEach((p, i) => { p.scheduled_at = new Date(now.getTime() + (i + 1) * interval * 60_000); });
      await this.repo.save(posts).catch((err: any) =>
        this.logger.warn(`backlog re-space failed for ${key}: ${err?.message}`));
    }

    return picked;
  }

  /**
   * Does the manual queue own this group's current slot? True only when posts are actually
   * waiting in the group's bucket, the drip that would send them is enabled (user + group
   * toggles), and the group's last sent post was a CAMPAIGN's — see queue-fairness.ts.
   */
  private async manualQueueOwnsSlot(userId: string, groupId: string | null): Promise<boolean> {
    const waitQb = this.repo.createQueryBuilder('p')
      .where('p.user_id = :u', { u: userId })
      .andWhere("p.status = 'queued'");
    if (groupId) waitQb.andWhere('p.channel_override = :g', { g: groupId });
    else waitQb.andWhere('p.channel_override IS NULL');
    const waiting = await waitQb.getCount();
    if (!waiting) return false;

    // The drip must actually be able to take the yielded slot — a paused queue must not
    // silence the group's campaigns.
    const creds = await this.credentials.getRaw(userId).catch(() => null);
    if (creds?.schedule_enabled !== true) return false;
    let dripEnabled = true;
    if (groupId) {
      const chs: any[] = await this.channels.listForSchedule(userId).catch(() => []);
      const ch = chs.find((c) => c.channel_id === groupId);
      dripEnabled = (ch?.schedule_enabled ?? true) !== false;
    }

    const lastQb = this.repo.createQueryBuilder('p')
      .where('p.user_id = :u', { u: userId })
      .andWhere("p.status = 'sent'")
      .orderBy('p.sent_at', 'DESC');
    if (groupId) lastQb.andWhere('(p.channel_override = :g OR p.channel_overrides LIKE :like)', { g: groupId, like: `%"${groupId}"%` });
    else lastQb.andWhere('p.channel_override IS NULL');
    const last = await lastQb.getOne();

    return manualQueueTurn({
      waiting, dripEnabled,
      lastSentCampaignId: last?.campaign_id, hasSentAny: !!last,
    });
  }

  async sendScheduled(post: Post) {
    const creds = await this.credentials.getRaw(post.user_id);
    // Atomically claim the scheduled post (scheduled → pending). If another instance's
    // cron already picked the same due head this tick, affected = 0 → skip.
    const claim = await this.repo.createQueryBuilder()
      .update(Post).set({ status: 'pending', pending_at: () => 'NOW()' })
      .where('id = :id AND status = :scheduled', { id: post.id, scheduled: 'scheduled' })
      .execute();
    if (!claim.affected) return;
    post.status = 'pending';
    await this.sendToTelegram(post, creds, post.channel_override || undefined);
    // Share ONE clock per group. Scheduled (campaign) posts and the manual auto-send queue
    // used to run on SEPARATE clocks, so a manually-queued post fired in-between the autopilot
    // posts. Advancing the group's queue clock here — the same one processQueue checks — makes
    // a manual post wait a full interval after this post, so everything to the group interleaves
    // one per interval. null override = the default channel → the account's global clock.
    //
    // ONLY for posts that actually publish to Telegram: an Instagram-only campaign's posts
    // carry the group override for targeting, and stamping the Telegram clock for them made
    // the backlog drip see the group as "just sent" every hour — real Telegram posts sat on
    // 'מתוזמן' forever.
    const only = await this.postPlatformFilter(post);
    if (only && !only.has('telegram')) return;
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

  /** Current minute (0-59) in the given IANA timezone. */
  private minuteInZone(date: Date, tz: string): number {
    try {
      const m = new Intl.DateTimeFormat('en-US', { minute: '2-digit', timeZone: tz }).format(date);
      return parseInt(m, 10) || 0;
    } catch { return date.getMinutes(); }
  }

  /**
   * Is `date` inside the send window [startHour:00 .. endHour:00]? The end is INCLUSIVE of
   * the TOP of endHour only: a window of 06:00–23:00 allows a post at exactly 23:00 (the
   * user's configured last slot) but nothing at 23:01+. The old check used an exclusive end
   * (h < endHour), which silently dropped the entire 23:00 hour — so the last daily post was
   * never created, clamped, or released. This keeps the "no posts at 00:24" guarantee (an
   * overdue backlog reaching the release path at 23:07 is still blocked).
   */
  private isWithinWindow(date: Date, tz: string, startHour: number, endHour: number): boolean {
    if (startHour >= endHour) return true; // 24h / misconfigured → never block
    const h = this.hourInZone(date, tz);
    if (h < startHour) return false;
    if (h < endHour) return true;
    return h === endHour && this.minuteInZone(date, tz) === 0;
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
    window?: { startHour?: number | null; endHour?: number | null; tz?: string | null },
  ): Date[] {
    // The window's hours are read in ITS timezone — a campaign-level window can say
    // "17–22 America/New_York" (US-audience Pinterest) while everything else stays on
    // the scheduler default (Israel).
    const tz = window?.tz || process.env.SCHEDULER_TZ || 'Asia/Jerusalem';
    // A campaign targeting a specific group publishes in THAT group's window when it has one,
    // falling back to the account's global window, then to 9–22. This is why a group campaign
    // no longer fires at, say, 6am just because the global default did.
    const startHour = window?.startHour ?? creds?.schedule_start_hour ?? 9;
    const endHour = window?.endHour ?? creds?.schedule_end_hour ?? 22;
    const gapMs = 15 * 60_000;

    let first = new Date();
    if (startHour < endHour) {
      // Walk forward hour by hour (DST-safe) until we land inside the window. The window
      // includes the top of endHour (23:00 sharp) so a campaign firing at 23:00 still posts.
      for (let i = 0; i < 24; i++) {
        if (this.isWithinWindow(first, tz, startHour, endHour)) break;
        first = new Date(first.getTime() + 60 * 60_000);
      }
    }
    const times: Date[] = [];
    for (let i = 0; i < Math.max(1, count); i++) times.push(new Date(first.getTime() + i * gapMs));
    return times;
  }

  /** The furthest-out post this campaign still has waiting, in ms — the thing a self-paced
   *  campaign spaces its next post off. Null when it has nothing queued. */
  private async furthestCampaignBooking(campaignId: string): Promise<number | null> {
    const row = await this.repo.query(
      `SELECT MAX(COALESCE(scheduled_at, pending_at)) AS max FROM posts
       WHERE campaign_id = $1 AND status IN ('scheduled', 'pending', 'queued')`,
      [campaignId],
    ).catch(() => null);
    const max = row?.[0]?.max;
    return max ? new Date(max).getTime() : null;
  }

  /** Walk a moment forward, hour by hour (DST-safe), until it lands inside the send window. */
  private alignToWindow(
    ms: number,
    creds: DecryptedCredentials | null,
    window?: { startHour?: number | null; endHour?: number | null; tz?: string | null },
  ): Date {
    const tz = window?.tz || process.env.SCHEDULER_TZ || 'Asia/Jerusalem';
    const startHour = window?.startHour ?? creds?.schedule_start_hour ?? 9;
    const endHour = window?.endHour ?? creds?.schedule_end_hour ?? 22;
    let at = new Date(ms);
    // An inverted window (e.g. 22→6) is already "always open" for this purpose.
    if (startHour >= endHour) return at;
    for (let i = 0; i < 24 && !this.isWithinWindow(at, tz, startHour, endHour); i++) {
      at = new Date(at.getTime() + 60 * 60_000);
    }
    return at;
  }

  /**
   * product_ids already posted (ANY status, ANY campaign) to ANY of these channels since
   * `since`. This is the cross-campaign, per-GROUP dedup: two campaigns that share a target
   * group can't post the same product to it — the "same item shows up twice in the group"
   * complaint. Includes queued/scheduled/pending too, so when campaigns run back-to-back in
   * one tick the second sees what the first just queued.
   */
  async postedProductIdsToChannels(channelIds: string[], since: Date): Promise<Set<string>> {
    const ids = (channelIds || []).filter((c) => typeof c === 'string' && c.trim());
    if (!ids.length) return new Set();
    const rows = await this.repo.createQueryBuilder('p')
      .select('DISTINCT p.product_id', 'product_id')
      // An OPEN post (queued/scheduled/pending) blocks its product no matter how long ago it
      // was created — a post still waiting to publish is a duplicate-in-the-making even if it
      // was queued before the cooldown window opened. Sent history is time-bounded as before.
      .where(new Brackets((w) => {
        w.where('p.created_at > :since', { since })
          .orWhere(`p.status IN ('queued','scheduled','pending')`);
      }))
      .andWhere(new Brackets((w) => {
        ids.forEach((c, i) => {
          w.orWhere(`p.channel_override = :cc${i}`, { [`cc${i}`]: c });
          w.orWhere(`p.channel_overrides LIKE :ll${i}`, { [`ll${i}`]: `%${c}%` });
        });
      }))
      .getRawMany()
      .catch(() => [] as { product_id: string }[]);
    return new Set(rows.map((r) => String(r.product_id)));
  }

  /**
   * The group(s) the owner sent each product to BY HAND — one entry per manual post.
   *
   * "By hand" is `campaign_id IS NULL`: nothing but a deliberate send/queue/schedule from
   * the product screens creates such a row, so its channel targets are the owner's own
   * choice of audience for that product. The FLYLINK runner reads this to leave a product
   * hand-aimed at one group alone (see hand-picked-lock.ts).
   */
  async handPickedChannels(userId: string): Promise<Array<{ productKey: string; channels: string[] }>> {
    const rows: Array<{ product_id: string; channel_override: string | null; channel_overrides: string | null }> =
      await this.repo.createQueryBuilder('p')
        .select(['p.product_id AS product_id', 'p.channel_override AS channel_override', 'p.channel_overrides AS channel_overrides'])
        .where('p.user_id = :userId', { userId })
        .andWhere('p.campaign_id IS NULL')
        .andWhere('(p.channel_override IS NOT NULL OR p.channel_overrides IS NOT NULL)')
        .getRawMany()
        .catch(() => []);

    return rows.map((r) => {
      let channels: string[] = [];
      try {
        const parsed = r.channel_overrides ? JSON.parse(r.channel_overrides) : [];
        if (Array.isArray(parsed)) channels = parsed.filter((c) => typeof c === 'string' && c.trim());
      } catch { /* unreadable list — the single override below still counts */ }
      if (!channels.length && r.channel_override) channels = [r.channel_override];
      return { productKey: String(r.product_id), channels };
    });
  }

  /**
   * OPEN posts (queued/scheduled/pending — created but not yet published) for a product,
   * any origin. The FLYLINK manual queue/schedule paths call this before creating a post:
   * a product already waiting to go out to the same group must not be queued a second time
   * (the "one sent + one scheduled again" duplication). Sent posts are deliberately NOT
   * returned — re-pushing an already-published product is the repost feature, not a bug.
   */
  async openPostsForProduct(userId: string, productId: string): Promise<Post[]> {
    if (!productId) return [];
    return this.repo.find({
      where: {
        user_id: userId,
        product_id: String(productId),
        status: In(['queued', 'scheduled', 'pending']),
      },
    });
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
  /** The campaign's own send-window override, or null when it doesn't declare one. */
  private campaignWindow(campaign: Campaign): { startHour: number | null; endHour: number | null; tz: string | null } | null {
    if (campaign.window_start_hour == null && campaign.window_end_hour == null && !campaign.window_tz) return null;
    return {
      startHour: campaign.window_start_hour ?? null,
      endHour: campaign.window_end_hour ?? null,
      tz: campaign.window_tz || null,
    };
  }

  async isCampaignWindowOpen(userId: string, campaign: Campaign, creds?: DecryptedCredentials | null): Promise<boolean> {
    // Resolve the window from the SAME source the scheduled_at clamp uses: the campaign's
    // own window (with its own timezone), else the target group's hours, else the
    // account's, else 9–22. Fetch creds if the caller didn't pass them.
    const c = creds !== undefined ? creds : await this.credentials.getRaw(userId).catch(() => null);
    const own = this.campaignWindow(campaign);
    const targets = this.parseTargetChannels(campaign.target_channels);
    const window = own ?? (targets.length
      ? await this.channels.getScheduleWindow(userId, targets[0]).catch(() => null)
      : null);
    const startHour = window?.startHour ?? c?.schedule_start_hour ?? 9;
    const endHour = window?.endHour ?? c?.schedule_end_hour ?? 22;
    const tz = (own?.tz) || process.env.SCHEDULER_TZ || 'Asia/Jerusalem';
    return this.isWithinWindow(new Date(), tz, startHour, endHour);
  }

  /**
   * The account's proven price band (USD, from 90 days of real orders) — the sales-profile
   * signal product selection prefers. Null when the account hasn't enough orders to claim
   * one. Cached 6h per user: selection runs on every campaign tick.
   */
  private readonly priceBandCache = new Map<string, { at: number; band: PriceBand | null }>();

  async soldPriceBandFor(userId: string): Promise<PriceBand | null> {
    const cached = this.priceBandCache.get(userId);
    if (cached && Date.now() - cached.at < 6 * 3600_000) return cached.band;
    let band: PriceBand | null = null;
    try {
      const rows: Array<{ amt: number }> = await this.repo.manager.query(
        `SELECT order_amount_usd AS amt FROM earnings
         WHERE user_id = $1 AND order_amount_usd > 0
           AND order_date > now() - interval '90 days'
         LIMIT 3000`,
        [userId],
      );
      band = soldPriceBand(rows.map((r) => r.amt));
    } catch { band = null; }
    this.priceBandCache.set(userId, { at: Date.now(), band });
    return band;
  }

  /**
   * The group's golden hours for slot-snapping — or null when smart timing is off, the
   * data is too thin for a verdict, or every golden hour falls outside the group's own
   * send window (clicks arrive after hours too; a snap must never escape the window).
   * Cached 30 minutes per group: this runs on every slot booking.
   */
  private readonly smartTimingCache = new Map<string, { at: number; hours: number[] | null }>();

  private async smartTimingHours(userId: string, groupId: string): Promise<number[] | null> {
    const cached = this.smartTimingCache.get(groupId);
    if (cached && Date.now() - cached.at < 30 * 60_000) return cached.hours;

    let hours: number[] | null = null;
    try {
      const [ch] = await this.repo.manager.query(
        `SELECT smart_timing, schedule_start_hour, schedule_end_hour
         FROM channels WHERE id = $1 AND user_id = $2`,
        [groupId, userId],
      );
      if (ch?.smart_timing === true) {
        const rows: Array<{ hour: number; clicks: number }> = await this.repo.manager.query(
          `SELECT extract(hour from (lc.clicked_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jerusalem')::int AS hour,
                  count(*)::int AS clicks
           FROM link_clicks lc
           JOIN posts p ON p.id = lc.post_id
           WHERE lc.user_id = $1
             AND lc.clicked_at > now() - interval '30 days'
             AND (p.channel_override = $2 OR p.channel_overrides LIKE $3)
           GROUP BY 1`,
          [userId, groupId, `%"${groupId}"%`],
        );
        const verdict = hotHours(rows.map((r) => ({ hour: Number(r.hour), clicks: Number(r.clicks) })));
        if (verdict) {
          // Clicks land outside posting hours too (people open the channel late) — a
          // golden hour outside the group's send window must never pull a post out of it.
          const s = ch.schedule_start_hour;
          const e0 = ch.schedule_end_hour;
          let inWindow = verdict.hours;
          if (s != null && e0 != null) {
            const e = e0 === 0 ? 24 : e0;
            inWindow = s < e
              ? verdict.hours.filter((h) => h >= s && h < e)
              : verdict.hours.filter((h) => h >= s || h < e0);
          }
          hours = inWindow.length ? inWindow : null;
        }
      }
    } catch { hours = null; }

    this.smartTimingCache.set(groupId, { at: Date.now(), hours });
    return hours;
  }

  /**
   * Place a new post to `groupId` in that group's NEXT FREE slot: spaced by the group's
   * interval from the latest pending (scheduled/queued) OR just-sent post targeting the group —
   * from any campaign or source THAT PUBLISHES TO TELEGRAM (a platform-filtered campaign,
   * e.g. Instagram-only, never reaches the group's Telegram channel and is not counted).
   * Returns { slot, skip }; skip=true when the group is already
   * booked within the current interval, so two campaigns to one group never post together and
   * the group publishes at most once per its interval (the group's setting is the rate).
   *
   * `stackUntil` is the caller's CYCLE END (its next cron fire). Within it a campaign may
   * queue more than one post on the group — that is what makes "2 posts per run" mean two
   * posts — while each still lands a full group interval after the last, so the group's own
   * rate is untouched. Past that point the booking belongs to the next run, which is what
   * keeps the queue from growing without bound.
   */
  async nextGroupSlot(
    userId: string, groupId: string, notBefore: Date, campaignId?: string,
    stackUntil?: Date | null,
  ): Promise<{ slot: Date; skip: boolean }> {
    const res = await this.nextGroupSlotRaw(userId, groupId, notBefore, campaignId, stackUntil);
    if (res.skip) return res;
    // OPT-IN smart timing: nudge the free slot into the group's learned golden hours.
    // The nudge is bounded (≤3h, never earlier — see smart-timing.ts) and runs only for
    // groups whose owner flipped the toggle; everyone else gets the slot untouched. The
    // caller stores the snapped time as scheduled_at, so the interval chain anchors on it
    // and the group's one-post-per-interval rate is preserved by construction.
    const golden = await this.smartTimingHours(userId, groupId);
    if (!golden) return res;
    let snapped = snapToHotHour(res.slot, golden);
    // Never snap past this run's own CYCLE END: a booking beyond it blocks the campaign's
    // next run(s) (myBookingBlocks sees a pending post it can't stack behind) and starves
    // the timeline — observed as ~122-minute gaps on an hourly campaign. The run whose
    // natural slot lands near the golden hour does the snapping instead, so concentration
    // still happens without any run being jumped over.
    if (stackUntil && snapped.getTime() > stackUntil.getTime()) snapped = res.slot;
    if (snapped.getTime() === res.slot.getTime()) return res;
    // A snapped slot lands HOURS ahead — beyond the pacing horizon that (correctly) lets
    // near-term bookings ignore far-future posts. So the chain cannot see an EARLIER post
    // that already snapped into the same golden hour, and two posts stack there and publish
    // together (observed: two posts at the same hour the day smart timing first woke up).
    // Before accepting the snap, check the group's calendar around the snapped time — if a
    // pending post already sits within one interval of it, keep the natural slot instead:
    // the golden hour is taken, and natural pacing beats a double-post.
    const snapIntervalMin = (await this.channels.getIntervalMinutes(userId, groupId).catch(() => null)) ?? 60;
    const snapIntervalMs = snapIntervalMin * 60_000;
    const clash = await this.repo.createQueryBuilder('p')
      .where('p.user_id = :userId', { userId })
      .andWhere("p.status IN ('scheduled','queued','pending')")
      .andWhere('(p.channel_override = :g OR p.channel_overrides LIKE :like)', { g: groupId, like: `%"${groupId}"%` })
      .andWhere('COALESCE(p.scheduled_at, p.pending_at) > :lo', { lo: new Date(snapped.getTime() - snapIntervalMs) })
      .andWhere('COALESCE(p.scheduled_at, p.pending_at) < :hi', { hi: new Date(snapped.getTime() + snapIntervalMs) })
      .getCount();
    if (clash > 0) return res;
    return { slot: snapped, skip: false };
  }

  private async nextGroupSlotRaw(
    userId: string, groupId: string, notBefore: Date, campaignId?: string,
    stackUntil?: Date | null,
  ): Promise<{ slot: Date; skip: boolean }> {
    // The group's own interval, else the ACCOUNT's, else an hour.
    //
    // The account step was missing, and its absence is why lowering "מרווח בין פוסטים" in
    // Settings changed nothing for a campaign publishing to a group: the group's own field
    // is empty by default and reads "גלובלי" on screen, but this fell straight through to a
    // hardcoded 60. So a campaign set to run every half hour kept publishing hourly — the
    // pacing gate below still measured against an hour — with the settings screen insisting
    // otherwise. The scheduler's queue resolves group → account → 60; this is the same
    // chain, and the two must agree or the same group paces differently depending on which
    // path released the post.
    const creds = await this.credentials.getRaw(userId).catch(() => null);
    const intervalMin = pacingIntervalMinutes(
      await this.channels.getIntervalMinutes(userId, groupId).catch(() => null),
      creds?.schedule_interval_minutes,
    );
    const now = Date.now();
    const recentSentCutoff = new Date(now - intervalMin * 60_000);

    // What already occupies the group's rate: the latest PENDING (scheduled/queued) post,
    // and the last SENT time PER CAMPAIGN within the interval. Telegram-publishing posts
    // only (an Instagram-only campaign shares the group id for targeting but never reaches
    // the Telegram channel, so it must not consume the group's Telegram rate).
    // 'pending' counts as occupying the group. A post being sent RIGHT NOW sits in
    // 'pending' for a few seconds (scheduled → pending → sent), and the old status list
    // skipped it — so a campaign cron firing during those seconds saw the group as free,
    // booked the same minute, and the group got 06:00 and 06:01 back-to-back. The stale
    // safety is the 30-minute pending reset cron, so a hung send blocks at most that long.
    // The pacing HORIZON: only work landing within the current interval competes for this
    // slot. A post scheduled far ahead (a manual announcement queued for tonight) must not
    // make the group look busy for the hours in between — that silenced every campaign on
    // every group the post fanned out to, which is why the horizon is explicit here.
    const horizonMs = now + intervalMin * 60_000;

    const rows = await this.repo.createQueryBuilder('p')
      .select('p.campaign_id', 'campaign_id')
      .addSelect("MAX(CASE WHEN p.status IN ('scheduled','queued','pending') THEN COALESCE(p.scheduled_at, p.pending_at) END)", 'pending')
      // The NEAREST-TERM occupancy: the latest booking that lands INSIDE the horizon.
      // Aggregating only the overall MAX let a far-future booking SHADOW a near one —
      // a campaign with posts at both 16:00 and 20:00 reported only 20:00, the horizon
      // dropped it, the group looked free, and the scheduler stacked a new post right
      // next to the owner's manually-timed 16:00 one. Occupancy reads THIS column; the
      // raw MAX above stays for the fair-share bookkeeping.
      .addSelect("MAX(CASE WHEN p.status IN ('scheduled','queued','pending') AND COALESCE(p.scheduled_at, p.pending_at) <= :horizon THEN COALESCE(p.scheduled_at, p.pending_at) END)", 'pending_near')
      .setParameter('horizon', new Date(horizonMs))
      .addSelect("MAX(CASE WHEN p.status = 'sent' THEN p.sent_at END)", 'sent')
      // The sent post's SLOT time (scheduled_at), for spacing the next slot from. Spacing
      // from sent_at made the clock creep: each send finishes seconds after its slot, the
      // next slot inherited that lag plus its own, and 06:00 became 07:01, 08:02… — a
      // visible minute-per-hour drift the owner rightly flagged. Anchoring on the slot
      // keeps the chain on round hours; the busy checks below still use the ACTUAL send
      // time, because "did this group just publish?" is a question about reality, not
      // about the timetable. Manual sends have no slot → sent_at, exactly as before.
      .addSelect("MAX(CASE WHEN p.status = 'sent' THEN COALESCE(p.scheduled_at, p.sent_at) END)", 'sent_anchor')
      .leftJoin(Campaign, 'c', 'c.id = p.campaign_id')
      .where('p.user_id = :userId', { userId })
      .andWhere("p.status IN ('scheduled','queued','pending','sent')")
      .andWhere("(p.status != 'sent' OR p.sent_at >= :recent)", { recent: recentSentCutoff })
      .andWhere('(p.channel_override = :g OR p.channel_overrides LIKE :like)', { g: groupId, like: `%"${groupId}"%` })
      .andWhere('(p.campaign_id IS NULL OR c.target_platforms IS NULL OR c.target_platforms LIKE :tg)', { tg: '%telegram%' })
      .groupBy('p.campaign_id')
      .getRawMany();

    let latestMs = 0;
    let pendingSoon = false;
    let lastSentMs = 0;
    const lastSentByCampaign = new Map<string, number>();
    // Split out what belongs to THIS campaign, and what belongs to a manual post: those two
    // must block it outright, while a sibling CAMPAIGN's booking is merely something to
    // queue behind (see groupBusy below).
    let myPendingMs = 0;
    let mySentMs = 0;
    // The SLOT of this campaign's last send — what the busy check must measure from. See
    // group-pacing.ts: measuring from the actual send time let a slow send (AI images,
    // album upload) eat into the next interval and skip that run.
    let mySentAnchorMs = 0;
    let lastSentAnchorMs = 0;
    let manualPendingSoon = false;
    for (const r of rows) {
      const cid = String(r.campaign_id ?? '');
      // Occupancy prefers the horizon-bounded aggregate (see the query above): the raw
      // MAX is a far booking whenever both exist, and it must not shadow the near one.
      const pendRaw = r.pending_near ?? r.pending;
      const pend = pendRaw ? new Date(pendRaw).getTime() : 0;
      const pendAny = r.pending ? new Date(r.pending).getTime() : 0;
      const sent = r.sent ? new Date(r.sent).getTime() : 0;
      // An overdue pending post (pend < now) still occupies the group — it's the far-future
      // one we ignore. Re-spaced backlog lands at now + 1·interval, so the nearest queued
      // post stays inside the horizon and the anti-pile-up back-pressure is preserved.
      if (pend && pend <= horizonMs) {
        pendingSoon = true;
        latestMs = Math.max(latestMs, pend);
        if (!cid) manualPendingSoon = true;
        if (campaignId && cid === campaignId) myPendingMs = Math.max(myPendingMs, pend);
      }
      if (sent) {
        lastSentMs = Math.max(lastSentMs, sent);
        // SPACING runs off the slot anchor, so the chain stays on round hours instead of
        // creeping by each send's processing lag — and so does the BUSY check below, for
        // the same reason: the post that occupied 10:00 leaves 11:00 free however long its
        // upload took.
        const anchor = r.sent_anchor ? new Date(r.sent_anchor).getTime() : sent;
        latestMs = Math.max(latestMs, Math.min(anchor, sent));
        lastSentAnchorMs = Math.max(lastSentAnchorMs, Math.min(anchor, sent));
        if (campaignId && cid === campaignId) {
          mySentMs = Math.max(mySentMs, sent);
          mySentAnchorMs = Math.max(mySentAnchorMs, Math.min(anchor, sent));
        }
      }
      lastSentByCampaign.set(cid, Math.max(pendAny, sent));
    }

    if (!latestMs) return { slot: notBefore, skip: false };
    const slotMs = Math.max(latestMs + intervalMin * 60_000, notBefore.getTime());

    // Anchored on the SLOT, with a grace for cron jitter — see group-pacing.ts for the
    // failure this shape exists to prevent (a slow send stealing the next interval).
    const withinInterval = (ms: number) => occupiesCurrentInterval(ms, now, intervalMin);

    // Is the group too busy for THIS caller?
    //
    // `slotMs` above is already the group's next FREE slot (latest + interval) and the caller
    // stores it as scheduled_at — so the group's one-post-per-interval rate is enforced by
    // the SLOT, not by refusing to run. What this gate must prevent is narrower: a campaign
    // stacking a second post of its own on the group, and a manual one-off losing the slot it
    // occupies (a one-off has no cadence to take turns with).
    //
    // Treating ANY booking as busy is what starved a shared group: the 3-hourly
    // "FLYLINK — מאמא מותגים" campaign fires the same minute as the hourly campaign sharing
    // its group, the hourly one books first, and FLYLINK was skipped on EVERY run — silent
    // for 13 hours while its sibling published hourly. A sibling's booking now just moves
    // this campaign to the following slot; fair-share below still decides who goes first,
    // and one-booking-per-campaign keeps the queue depth bounded by the campaign count.
    // A booking of this campaign's own blocks a second one — EXCEPT while the new slot still
    // falls inside this run's own cycle. Without that exception "posts per run" was a lie for
    // any campaign publishing to a group: the first post booked, the second saw its own
    // pending post and skipped, and a campaign set to 2 or 3 posts silently produced exactly
    // one, every run, with nothing in the UI to say why. The group's rate is not weakened by
    // allowing it — `slotMs` already spaces each post a full interval behind the last.
    const stackable = !!stackUntil && slotMs < stackUntil.getTime();
    const myBookingBlocks = myPendingMs > 0 && !stackable;
    const groupBusy = campaignId
      ? myBookingBlocks || withinInterval(mySentAnchorMs) || manualPendingSoon
      : pendingSoon || withinInterval(lastSentAnchorMs);

    // FAIR-SHARE: when several campaigns publish to one group, the group's single rate is
    // split between them — the MOST-BEHIND campaign (oldest last-post, or never posted) wins
    // the free slot; the rest skip this round. So two "מאמא" campaigns on one 1/hour group
    // alternate (each ~every 2h) instead of the first one always starving the second. The
    // decision keys off last-post time, not scheduler run order, so it's stable. Single-
    // campaign groups: this campaign is trivially the winner → unchanged behaviour.
    //
    // Only CAMPAIGNS take turns. A manual/one-off post has no cadence to catch up on: it
    // consumes the slot it occupies (via groupBusy above) and nothing more. Letting it into
    // the rotation starved the campaigns outright — manual posts key to '' here, and
    // '' < any-uuid is always true, so they won every tie-break and the campaign skipped
    // the next run for a sibling that was never going to post again.
    let notMyTurn = false;
    if (campaignId && rows.length) {
      const mine = lastSentByCampaign.get(campaignId) ?? 0;
      // A sibling is "more behind" (older last-post, tie broken by id) → it gets the slot.
      for (const [cid, last] of lastSentByCampaign) {
        if (!cid || cid === campaignId) continue;
        if (last < mine || (last === mine && cid < campaignId)) { notMyTurn = true; break; }
      }
    }

    const bookedAhead = groupBusy || notMyTurn;
    const win = await this.channels.getScheduleWindow(userId, groupId).catch(() => null);
    const startHour = win?.startHour ?? creds?.schedule_start_hour ?? 9;
    const endHour = win?.endHour ?? creds?.schedule_end_hour ?? 22;
    const tz = process.env.SCHEDULER_TZ || 'Asia/Jerusalem';
    const slotHour = this.hourInZone(new Date(slotMs), tz);
    const outOfWindow = startHour < endHour && (slotHour < startHour || slotHour >= endHour);

    const skip = bookedAhead || outOfWindow;
    if (skip) {
      // Name the gate that closed. A silent skip is indistinguishable from "nothing to post",
      // which is what made a cadence regression here take hours to localise.
      const why = myBookingBlocks ? 'this campaign already has a post booked on the group,'
          + ` and the next slot (${new Date(slotMs).toISOString()}) falls past this run's cycle`
        : manualPendingSoon ? 'a manual post occupies this interval'
        // Report the SLOT age (what the gate measures) alongside the real send time, so a
        // send lagging its slot is visible in the log instead of having to be inferred.
        : groupBusy ? `slot was ${Math.round((now - (campaignId ? mySentAnchorMs : lastSentAnchorMs)) / 60_000)}m ago`
            + ` (sent ${Math.round((now - (campaignId ? mySentMs : lastSentMs)) / 60_000)}m ago, interval ${intervalMin}m)`
        : notMyTurn ? 'another campaign on this group is further behind'
        : `slot ${slotHour}:00 is outside the ${startHour}:00-${endHour}:00 window`;
      this.logger.log(`nextGroupSlot skip · group ${groupId}${campaignId ? ` · campaign ${campaignId}` : ''} · ${why}`);
    }

    return { slot: new Date(slotMs), skip };
  }

  /**
   * What each of a campaign's keywords produced over the scoring window: products posted,
   * the clicks those posts drew, and commissions on those products. Feeds the weighted
   * rotation; a query failure degrades to an empty map, i.e. plain round-robin.
   *
   * Revenue is matched on product_id, the same heuristic the optimizer and the attribution
   * report use. Note it is a WEAK signal here in practice — most orders on this account are
   * for products the autopilot never posted — so clicks carry the ranking.
   */
  private async keywordPerformance(campaignId: string): Promise<Map<string, KeywordPerformance>> {
    const rows: any[] = await this.repo.query(
      // Clicks = short-link clicks PLUS Pinterest outbound clicks. Pins carry the DIRECT
      // affiliate link (a redirect in the pin's link field risks rejection), so their
      // clicks never pass through /r/<code> — they arrive via the Pinterest analytics
      // sync into posts.pinterest_clicks. Counting only clicks_count left the weighted
      // rotation BLIND on Pinterest-only campaigns: every keyword scored zero and the
      // rotation degraded to round-robin exactly where the learning was asked about.
      `SELECT pp.keyword,
              count(DISTINCT pp.product_id)::int          AS posts,
              coalesce(sum(p.clicks_count + coalesce(p.pinterest_clicks, 0)), 0)::int AS clicks,
              coalesce((
                SELECT sum(e.commission_ils) FROM earnings e
                WHERE e.product_id IN (
                  SELECT pp2.product_id FROM campaign_posted_products pp2
                  WHERE pp2.campaign_id = $1 AND pp2.keyword = pp.keyword
                    AND pp2.created_at > now() - ($2 || ' days')::interval)
              ), 0)::float                                 AS revenue
       FROM campaign_posted_products pp
       LEFT JOIN posts p
         ON p.campaign_id = pp.campaign_id AND p.product_id = pp.product_id AND p.status = 'sent'
       WHERE pp.campaign_id = $1 AND pp.keyword IS NOT NULL
         AND pp.created_at > now() - ($2 || ' days')::interval
       GROUP BY pp.keyword`,
      [campaignId, String(KEYWORD_SCORE_WINDOW_DAYS)],
    );
    const out = new Map<string, KeywordPerformance>();
    for (const r of rows || []) {
      out.set(String(r.keyword), {
        posts: Number(r.posts) || 0,
        clicks: Number(r.clicks) || 0,
        revenue: Number(r.revenue) || 0,
      });
    }
    return out;
  }

  /**
   * WHICH KEYWORDS THIS CAMPAIGN SEARCHES ON THIS RUN, and how many posts it gets.
   *
   * Extracted so BOTH runners share one definition. The agents path (use_agents → the
   * OrchestratorAgent) used to hand `campaign.keywords` straight to the ProductAgent, which
   * meant the 🗓️ seasonal toggle and every registered bonus pool silently did nothing there
   * — the owner set them, saw no holiday products, and there was nothing on screen to say
   * why. Two runners deciding the same question separately is how that happens; one
   * function is how it stops.
   *
   * Advances the campaign's keyword cursor as a side effect: one call per run.
   */
  async campaignKeywordPlan(
    campaign: Campaign, userId: string, creds: DecryptedCredentials,
  ): Promise<CampaignKeywordPlan> {
    // Round-robin PER POST: each post this run takes the NEXT keyword, so a 2-post run
    // covers 2 different search families instead of doubling down on one. Pins from a
    // single keyword published minutes apart just compete with each other in the same
    // Pinterest searches (and read repetitive on Telegram). The cursor advances by the
    // number of posts, so the next run continues the rotation where this one stopped —
    // every keyword still gets equal airtime over time.
    const kwList = campaign.keywords.map((k) => k?.trim()).filter(Boolean);
    if (!kwList.length) throw new BadRequestException('לקמפיין אין מילות מפתח');

    // Commercial-calendar seasonality (account kill-switch in Settings ← תזמון). During an
    // event window the copywriter gets a one-line seasonal CONTEXT for the audience that
    // matches the campaign language (he→IL events, en→US); the window closing drops it.
    //
    // The event's search KEYWORDS are a separate, per-campaign opt-in. They decide which
    // products get found, so injecting them everywhere put "beach and pool accessories"
    // into a tactical-gear channel every July — off-brand posts the owner never asked for.
    // A campaign that wants seasonal stock sets `seasonal_keywords`; the hint costs nothing
    // either way, because it only angles the wording of a product the campaign chose itself.
    let occasionHint: string | null = null;
    let saleSeasonHint: string | null = null;
    // Which gate the run reached, so the run note can say WHY nothing seasonal came out —
    // three switches and a language all produce the same silence (see seasonal-status.ts).
    const language = campaign.language || 'he';
    const openEvents = activeSeasonalEvents(language).map((ev) => ev.name);
    let seasonalState: SeasonalStatus['state'] = 'active';
    // The seasonal terms actually in this run's rotation. They earn a boost below — an
    // extra post and a proven keyword's emphasis — because the window is short and the
    // intent inside it is the highest of the year (see seasonal-boost.ts). They also decide
    // WHICH posts get the occasion hint, below.
    const seasonalInRotation: string[] = [];
    if (creds.seasonal_enabled === false) {
      seasonalState = 'account-off';
    } else if (!(await this.subscription.allows(userId, 'seasonal_calendar').catch(() => true))) {
      seasonalState = 'plan-off';
    } else {
      if (campaign.seasonal_keywords) {
        for (const kw of seasonalKeywords(language)) {
          if (!kwList.includes(kw)) kwList.push(kw);
          seasonalInRotation.push(kw);
        }
      } else {
        seasonalState = 'campaign-off';
      }
      // The occasion hint is NOT unconditional. It asks the copywriter to tie the product to
      // the holiday, which is right for a serving platter and wrong for a tactical belt —
      // and "when relevant" in the prompt did not hold the line. It now rides the keyword
      // that found the product, so a campaign that never searches seasonal terms never
      // frames its products as holiday products. The sale-season line is different: it is a
      // fact about the calendar, not about the product, so it stays on every post.
      ({ occasion: occasionHint, saleSeason: saleSeasonHint } = seasonalCopyHints(language));
    }

    // BONUS POOLS (AliExpress incentive campaigns the owner registered for in the portal):
    // while a pool is live, a sale in its category pays the normal commission PLUS a bonus
    // — so those categories are simply worth more per post than anything else this campaign
    // could publish. Their keywords join the rotation for the duration, and only for
    // the autopilots the owner picked for that pool (a Home & Living bonus must never push
    // kitchen organisers into a tactical channel). The window closing removes them by
    // itself, with nothing to switch off.
    let bonusChannels: string[] = [];
    try { bonusChannels = JSON.parse(campaign.target_channels || '[]'); } catch { bonusChannels = []; }
    const bonus = await this.incentive.keywordsFor(userId, campaign.id, bonusChannels);
    if (bonus.keywords.length) {
      for (const kw of bonus.keywords) if (!kwList.includes(kw)) kwList.push(kw);
      this.logger.log(`campaign ${campaign.id}: ${bonus.keywords.length} bonus keywords in rotation (${bonus.names.join(', ')})`
        + (bonus.proven.length ? ` · ${bonus.proven.length} from pools that already sold — top rotation tier` : ''));
    }
    // Which keywords are bonus-pool ones, for the per-post copy angle below.
    const bonusKeywordSet = new Set(bonus.keywords.map((k) => k.trim().toLowerCase()));

    // An open event window buys one extra post per run — the owner's own posts_per_run is
    // never touched, so the optimizer's ±1-from-owner bound stays honest and the boost ends
    // with the window.
    const perPost = seasonalPostsPerRun(campaign.posts_per_run, seasonalInRotation.length > 0);
    if (perPost !== Math.max(1, campaign.posts_per_run)) {
      this.logger.log(`campaign ${campaign.id}: seasonal window open — ${perPost} posts this run`
        + ` (owner's ${campaign.posts_per_run}) · ${seasonalInRotation.join(', ')}`);
    }
    const baseCursor = campaign.keyword_cursor ?? 0;
    this.campaignRepo.increment({ id: campaign.id }, 'keyword_cursor', perPost).catch(() => {});

    // Bias the rotation toward keywords that actually produced something. A blind cursor
    // gave a keyword that never earned a single click the same airtime as one that sells,
    // permanently — the rotation now repeats proven keywords while still reaching every
    // keyword each cycle (an unproven keyword needs its chance to BE measured, and retiring
    // one is the optimizer's job, where it is capped and reversible).
    // Manager 24h pauses: a collapsed keyword (earned before, dead in the last 48h) sits
    // out one day. The pause is a manager_actions row that expires by until_at — nothing
    // to clean up. If EVERY keyword happens to be paused, the full list stands: a pause
    // must never silence a campaign outright.
    const pausedRows: Array<{ target_label: string }> = await this.repo.manager.query(
      `SELECT target_label FROM manager_actions
       WHERE kind = 'keyword_pause' AND target_id = $1 AND until_at > now()`,
      [campaign.id],
    ).catch(() => []);
    const pausedKw = new Set(pausedRows.map((r) => String(r.target_label || '').trim().toLowerCase()));
    const kwActive = pausedKw.size ? kwList.filter((k) => !pausedKw.has(k.toLowerCase())) : kwList;
    const kwEffective = kwActive.length ? kwActive : kwList;

    const perf = await this.keywordPerformance(campaign.id).catch(() => new Map());
    // A pool that has SOLD inside its window outranks even a proven earner: it earns AND
    // pays the bonus percentage on top of every further sale, so it gets more of the run's
    // product slots for as long as its window is open.
    // Boosted = worth more than usual RIGHT NOW, for a bounded time: a live bonus pool, and
    // a seasonal term inside its window. Both are unproven by history and would otherwise
    // sit one slot deep in a long cycle — which, for a three-week holiday, means the group
    // sees the holiday twice and then it is over.
    const rotation = weightedRotation(
      kwEffective, perf, new Set([...bonus.keywords, ...seasonalInRotation]), new Set(bonus.proven),
    );
    const rotationList = rotation.length ? rotation : kwEffective;

    // One keyword per post SLOT (repeats when there are fewer keywords than posts).
    const slotKeywords: string[] = [];
    for (let i = 0; i < perPost; i++) slotKeywords.push(rotationList[(baseCursor + i) % rotationList.length]);
    const distinctKeywords = Array.from(new Set(slotKeywords));

    return {
      kwList, kwEffective, rotationList, baseCursor, perPost,
      slotKeywords, distinctKeywords,
      occasionHint, saleSeasonHint,
      seasonalKeywordSet: new Set(seasonalInRotation.map((k) => k.trim().toLowerCase())),
      bonusKeywordSet,
      seasonalStatus: { state: seasonalState, events: openEvents, keywords: seasonalInRotation },
    };
  }

  async runCampaign(campaign: Campaign, userId: string, opts?: { fromScheduler?: boolean }): Promise<CampaignRunResult> {
    const creds = await this.credentials.getRaw(userId);
    if (!creds) throw new BadRequestException('חסרים פרטי חיבור — הגדר אותם במסך ההגדרות');

    // Skip scheduled runs outside the send window so overnight runs don't pile up at open.
    if (opts?.fromScheduler && !(await this.isCampaignWindowOpen(userId, campaign, creds))) {
      return { queued: 0, failed: 0, keyword: '', searched: '', errors: ['מחוץ לחלון הפרסום — דילוג'] };
    }

    // Campaign currency override: an English/US-audience campaign prices in USD (identity
    // pair → rate 1) while the account default stays ILS. Fallback = account currency.
    const currencyPair = campaign.currency_pair?.trim() || creds.currency_pair || 'USD_ILS';
    const rate = await this.rates.getRate(currencyPair);

    const {
      kwList, kwEffective, baseCursor, perPost,
      slotKeywords, distinctKeywords,
      occasionHint, saleSeasonHint, seasonalKeywordSet, bonusKeywordSet, seasonalStatus,
    } = await this.campaignKeywordPlan(campaign, userId, creds);

    // Products this campaign already posted — from the DURABLE de-dup table (survives
    // post deletion; the old posts-table query lost history whenever posts were deleted,
    // so cleared/expired products came straight back). Also tally posts PER KEYWORD so
    // each keyword can walk DEEPER into AliExpress results the more it's used, surfacing
    // fresh products before recycling old ones.
    //
    // REPEAT COOLDOWN: a product may be re-posted, but only after PRODUCT_REPEAT_COOLDOWN_DAYS
    // — so followers never see the same item day after day, yet a keyword that exhausted its
    // fresh stock recycles proven products instead of going silent. Only products posted
    // WITHIN the cooldown are blocked; older ones are eligible again (and the deep-paging
    // count also uses only recent posts, so it walks back toward page 1 as the window clears).
    const cooldownCutoff = new Date(Date.now() - PRODUCT_REPEAT_COOLDOWN_DAYS * 86_400_000);
    const postedRows = await this.postedRepo.find({
      where: { campaign_id: campaign.id, created_at: MoreThan(cooldownCutoff) },
      select: ['product_id', 'keyword', 'created_at'],
    }).catch(() => [] as PostedProduct[]);
    const postedIds = new Set(postedRows.map((r) => String(r.product_id)));
    // CROSS-CAMPAIGN, PER-GROUP dedup: also exclude products that ANY campaign posted to
    // THIS campaign's target group(s) within the cooldown. Two campaigns sharing a group
    // with overlapping keywords used to post the SAME product to it (observed: both
    // "Tactical" campaigns published product 1005009983369472 to the group seconds apart).
    // Because the scheduler runs campaigns sequentially, this also catches a product the
    // sibling campaign just QUEUED this tick.
    let campaignChannels: string[] = [];
    try { campaignChannels = JSON.parse(campaign.target_channels || '[]'); } catch { campaignChannels = []; }
    const crossGroupPosted = new Set<string>();
    if (campaignChannels.length) {
      const groupPosted = await this.postedProductIdsToChannels(campaignChannels, cooldownCutoff);
      for (const id of groupPosted) { postedIds.add(id); crossGroupPosted.add(id); }
    }
    // USER-WIDE cross-campaign dedup: a product ANY of this user's campaigns posted
    // (to any group) within the cooldown is skipped here too. Sibling campaigns with
    // overlapping keywords rank their pools identically (same sort + the shared
    // price-band steering), so without this they converge on the same head-of-results
    // items and the SAME product lands in every group. Ranked LAST for the recycle
    // tiers, like the group-scoped set.
    const siblingPosted: Array<{ product_id: string }> = await this.postedRepo.query(
      `SELECT DISTINCT pp.product_id
       FROM campaign_posted_products pp
       JOIN campaigns c ON c.id = pp.campaign_id
       WHERE c.user_id = $1 AND pp.campaign_id <> $2 AND pp.created_at > $3`,
      [userId, campaign.id, cooldownCutoff],
    ).catch(() => []);
    for (const r of siblingPosted) {
      postedIds.add(String(r.product_id));
      crossGroupPosted.add(String(r.product_id));
    }
    // product_id → last-posted ms, so a fallback recycle can pick the product posted
    // LONGEST ago (never the same item two days running).
    const postedAtMs = new Map<string, number>();
    // Treat cross-campaign group-posted products as JUST posted (now), so the oldest-first
    // recycle tiers rank them LAST — otherwise, absent from postedAtMs, they'd sort as 0
    // (oldest) and be recycled FIRST, re-posting the very item the dedup meant to suppress.
    for (const id of crossGroupPosted) postedAtMs.set(id, Date.now());
    for (const r of postedRows) {
      const ms = r.created_at ? new Date(r.created_at).getTime() : 0;
      const id = String(r.product_id);
      if (ms > (postedAtMs.get(id) ?? 0)) postedAtMs.set(id, ms);
    }
    const postedPerKeyword = new Map<string, number>();
    for (const r of postedRows) {
      const k = (r.keyword || '').trim();
      if (k) postedPerKeyword.set(k, (postedPerKeyword.get(k) || 0) + 1);
    }

    // Quality filters enforced HERE, not by the API: product.query has no rating param,
    // and (as discovered) its min_discount param is a no-op — so both are applied to the
    // fetched page. rating comes from each product's evaluate_rate (0–5).
    const minRating = campaign.min_rating ?? 0;
    const minDiscount = campaign.min_discount ?? 0;

    // One product pool per distinct keyword. A keyword that returns nothing usable is
    // reported but doesn't abort the run — its slot borrows from the other pools below.
    const searchedBy = new Map<string, string>();
    const poolBy = new Map<string, any[]>();
    const kwErrors: string[] = [];

    /** Build the product pool for ONE keyword. Returns null when the keyword is dry;
     *  the reason is recorded in kwErrors either way. */
    const buildPool = async (kw: string, needed: number): Promise<any[] | null> => {
      try {
        const searched = await this.searchKeyword(kw, creds);
        searchedBy.set(kw, searched);
        // Fetch a wide net (x10 per needed post) so we have room to skip already-posted
        // products. A rotating page 1-6 walks DEEPER into the results over time —
        // AliExpress returns the same top items on page 1 every run but has thousands of
        // matches; page 1 is the fallback for sparse keywords.
        const pageSize = Math.min(50, Math.max(30, needed * 20)); // widest net the API allows
        // The affiliate API returns a MUCH smaller, best-seller-sorted slice than the
        // consumer website — so a fixed sort keeps handing back the same top items even
        // though the site shows thousands. Widen the reachable catalog by rotating BOTH
        // the sort order AND the page as a keyword is used: each (sort, page) combo reveals
        // a different slice. block = how many page-fulls already consumed under this keyword;
        // it walks sort0/p1, sort1/p1, sort2/p1, sort0/p2, … (≈ 3×10 pages of unique items).
        const SORTS = ['LAST_VOLUME_DESC', 'LAST_VOLUME_ASC', 'SALE_PRICE_DESC'];
        const postedForKw = postedPerKeyword.get(kw) || 0;
        const block = Math.floor(postedForKw / pageSize);
        const sort = SORTS[block % SORTS.length];
        const page = Math.min(10, Math.floor(block / SORTS.length) + 1);
        const query = {
          keyword: searched, category_id: campaign.category_id,
          min_price: campaign.min_price, max_price: campaign.max_price,
          min_discount: campaign.min_discount, limit: pageSize, sort,
        };
        // Gather from the rotated (sort, page) slice MERGED with that sort's page 1 (the
        // reliable base), de-duplicated — best chance of fresh items. A deep page can ERROR
        // (out of range); that's caught, not fatal.
        const seenIds = new Set<string>();
        const found: any[] = [];
        for (const pg of (page === 1 ? [1] : [page, 1])) {
          const batch = await this.searchProducts({ ...query, page: pg }, creds).catch(() => []);
          for (const p of batch) {
            const id = String(p.product_id);
            if (!seenIds.has(id)) { seenIds.add(id); found.push(p); }
          }
        }
        const qualified = found.filter((p) =>
          (minRating <= 0 || (p.rating || 0) >= minRating) &&
          (minDiscount <= 0 || (p.discount_percent || 0) >= minDiscount),
        );
        // Self-healing, tiered selection — a campaign must NOT go silent while its keyword
        // still returns products. Tiers are tried top-down; each is used only when the one
        // above is empty. Recycled/relaxed picks are ordered OLDEST-posted-first so the same
        // item is never posted two days running (respects the repeat cooldown's INTENT even
        // when the pool is exhausted). This is what kept a strict campaign (rating≥4.5) alive
        // once its on-spec fresh stock aged into the 14-day cooldown mid-day.
        //   T1: on-spec + fresh (novel, meets filters)          — the ideal
        //   T2: on-spec, recycle oldest (meets filters, repeat)  — quality over novelty
        //   T3: relax filters, fresh (novel, lower rating)       — novelty over strictness
        //   T4: relax filters, recycle oldest (anything at all)  — last resort, never silent
        const fresh = (arr: any[]) => arr.filter((p) => !postedIds.has(String(p.product_id)));
        const oldestFirst = (arr: any[]) => [...arr].sort(
          (a, b) => (postedAtMs.get(String(a.product_id)) ?? 0) - (postedAtMs.get(String(b.product_id)) ?? 0),
        );
        let pool = fresh(qualified);
        let tier = 1;
        if (!pool.length && qualified.length) { pool = oldestFirst(qualified); tier = 2; }
        if (!pool.length) {
          const novel = fresh(found);
          if (novel.length) { pool = novel; tier = 3; }
          else if (found.length) { pool = oldestFirst(found); tier = 4; }
        }
        if (!pool.length) {
          kwErrors.push(`"${kw}": החיפוש לא החזיר מוצרים כלל`);
          return null;
        }
        if (tier > 1) {
          this.logger.warn(`campaign ${campaign.id} kw "${kw}": pool via fallback tier ${tier} `
            + `(rating≥${minRating}, discount≥${minDiscount}%, ${PRODUCT_REPEAT_COOLDOWN_DAYS}d cooldown exhausted) — staying live instead of silent`);
        }
        // SALES-PROFILE preference: products priced inside the account's PROVEN band (what
        // its buyers actually pay, from real orders) rank first; everything else follows in
        // its original order. A preference, never a filter — exploration survives, and an
        // account without enough orders gets the pool untouched.
        return preferInBand(pool, (p) => Number(p?.sale_price) || 0, await this.soldPriceBandFor(userId));
      } catch (err: any) {
        kwErrors.push(`"${kw}": ${err?.message || 'החיפוש נכשל'}`);
        return null;
      }
    };

    for (const kw of distinctKeywords) {
      const pool = await buildPool(kw, slotKeywords.filter((k) => k === kw).length);
      if (pool) poolBy.set(kw, pool);
    }

    // A single dead keyword must NOT silence the whole run. The rotation hands each run
    // one keyword per post slot, so a niche term that AliExpress returns nothing for
    // ("holographic sight") used to abort the run and cost the campaign its entire hour —
    // observed as a campaign publishing at half its configured rate. When every slot
    // keyword came back dry, walk FORWARD through the rotation for a live one; the run
    // publishes on time and the dead keyword is simply skipped this round (it is retried
    // next time, so a temporary API failure still self-heals).
    if (!poolBy.size) {
      const candidates = fallbackKeywords(
        kwList, baseCursor + perPost, new Set(distinctKeywords), KEYWORD_FALLBACK_ATTEMPTS,
      );
      for (const kw of candidates) {
        const pool = await buildPool(kw, 1);
        if (pool) {
          poolBy.set(kw, pool);
          this.logger.warn(`campaign ${campaign.id}: slot keyword(s) dry (${kwErrors.join(' | ')}) `
            + `— fell back to "${kw}" instead of skipping the run`);
          break;
        }
      }
    }

    if (!poolBy.size) {
      throw new BadRequestException(
        `אף מילת מפתח לא החזירה מוצרים (${kwErrors.join(' | ')}). נסה מילות מפתח אחרות או הרחב את טווח המחירים (${campaign.min_price ?? 0}–${campaign.max_price ?? '∞'}).`,
      );
    }

    // Fill each slot from ITS keyword's pool; a dry slot borrows from any other pool so
    // one dead keyword never shrinks the run. No product repeats within the run.
    const poolCursor = new Map<string, number>();
    const usedIds = new Set<string>();
    const takeFrom = (kw: string): any | null => {
      const pool = poolBy.get(kw);
      if (!pool) return null;
      let i = poolCursor.get(kw) ?? 0;
      while (i < pool.length) {
        const p = pool[i++];
        if (!usedIds.has(String(p.product_id))) {
          poolCursor.set(kw, i);
          usedIds.add(String(p.product_id));
          return p;
        }
      }
      poolCursor.set(kw, i);
      return null;
    };
    // Track WHICH keyword actually supplied each product (a borrowed slot carries the
    // donor keyword) — persisted on the post so revenue attribution can report per keyword.
    const toPost: Array<{ product: any; kw: string }> = [];
    for (const kw of slotKeywords) {
      let product = takeFrom(kw);
      let source = kw;
      if (!product) {
        for (const alt of poolBy.keys()) {
          product = takeFrom(alt);
          if (product) { source = alt; break; }
        }
      }
      if (product) toPost.push({ product, kw: source });
    }
    // Seasonal posts this run actually QUEUED — counted in the loop below, from the DONOR
    // keyword rather than the slot's (a seasonal slot that came up empty borrows from another
    // keyword), and only once the post is saved. Counting candidates here instead would
    // report a Halloween post that pacing then skipped, which is the exact failure the note
    // exists to expose.
    let fromSeasonal = 0;

    // A dedicated-Pinterest campaign writes pin-optimized copy (keyword-rich description,
    // no Telegram group voice) and must skip the account's default body template — that
    // template is the group's copy style (usually Hebrew) and would override the pin format.
    const platforms = this.parseTargetPlatforms(campaign.target_platforms);
    const pinterestOnly = !!platforms && platforms.size === 1 && platforms.has('pinterest');

    // A campaign runs headless — nothing hands it a template the way the composer does.
    // Fall back to the user's default body template so campaign posts are written in the
    // same voice as the ones they publish by hand, instead of the generic built-in one.
    const template = campaign.post_template?.trim()
      || (pinterestOnly ? '' : await this.getBodyText(userId, creds));

    const usedKeywords = distinctKeywords.filter((k) => poolBy.has(k));
    const result: CampaignRunResult = {
      queued: 0,
      failed: 0,
      keyword: usedKeywords.join(', '),
      searched: usedKeywords.map((k) => searchedBy.get(k) || k).join(', '),
      errors: [...kwErrors],
    };

    // Which group(s) this campaign publishes to. An AliExpress campaign can now target
    // specific groups (like FLYLINK) — its posts go ONLY there, isolated from other groups.
    // Empty = the account's default channel (legacy behaviour, unchanged).
    const targets = this.parseTargetChannels(campaign.target_channels);

    // PRODUCT-RELEVANCE GUARD: keyword search returns loosely-related items (deep pages
    // especially), so judge the picked products against THIS campaign's audience before
    // they become posts — a military training belt came back for מאמא under "אביזרי ים
    // ובריכה" and was published to a real audience. A rejected product is replaced from
    // the same pool (bounded attempts); no clean replacement → the slot is dropped and
    // the reason recorded. Fail-open: an unreachable judge changes nothing.
    if (toPost.length && this.ai.hasAnyKey(creds)) {
      const groupLabels = (await Promise.all(
        targets.map((t) => this.channels.getName(userId, t).catch(() => null)),
      )).filter((n): n is string => !!n);
      const fitCtx: ProductFitContext = { campaign: campaign.name, channels: groupLabels, keywords: kwEffective };
      const verdicts = await this.productFitVerdicts(creds, fitCtx, toPost.map((x) => ({
        keyword: x.kw, title: String(x.product.title || ''), category: x.product.category,
      })));
      const kept: Array<{ product: any; kw: string }> = [];
      for (let i = 0; i < toPost.length; i++) {
        if (verdicts[i].fits) { kept.push(toPost[i]); continue; }
        const rejectedTitle = String(toPost[i].product.title || '').slice(0, 50);
        this.logger.warn(`campaign ${campaign.id}: relevance guard rejected "${rejectedTitle}"`
          + ` (${verdicts[i].reason || 'no reason'}) for kw "${toPost[i].kw}"`);
        // Replacement draws from THIS keyword's pool first, then from any other keyword's —
        // the same borrowing the dry-slot filler already does. Without the borrow the guard
        // quietly cost the campaign a post whenever one keyword's remaining stock was all
        // off-audience, and a 3-hourly campaign stretched toward 8 hours between posts.
        let replaced = false;
        const donors = [toPost[i].kw, ...Array.from(poolBy.keys()).filter((k) => k !== toPost[i].kw)];
        for (const donor of donors) {
          for (let attempt = 0; attempt < 3 && !replaced; attempt++) {
            const next = takeFrom(donor);
            if (!next) break;
            const [v] = await this.productFitVerdicts(creds, fitCtx, [{
              keyword: donor, title: String(next.title || ''), category: next.category,
            }]);
            if (v.fits) { kept.push({ product: next, kw: donor }); replaced = true; }
          }
          if (replaced) break;
        }
        if (!replaced) {
          result.errors.push(
            `שומר הרלוונטיות: "${rejectedTitle}" נפסל (${verdicts[i].reason || 'לא מתאים לקהל'}) ולא נמצא תחליף — הפוסט דולג`,
          );
          this.logger.warn(`campaign ${campaign.id}: relevance guard dropped a slot — no on-audience replacement in ${donors.length} pool(s)`);
        }
      }
      toPost.length = 0;
      toPost.push(...kept);
    }

    // Publish times for THIS run — the campaign's own cron is the cadence, so posts go out
    // now (spaced 15 min for multi-post runs), NOT re-paced by the global queue interval.
    // Window precedence: the campaign's OWN window (with its own timezone — e.g. a
    // US-audience Pinterest campaign on New-York evening hours) → the target group's
    // window → the account's global window.
    const window = this.campaignWindow(campaign)
      ?? (targets.length
        ? await this.channels.getScheduleWindow(userId, targets[0]).catch(() => null)
        : null);
    const times = this.campaignScheduleTimes(toPost.length, creds, window || undefined);

    // This run's cycle end — when this campaign's cron fires again. Posts this run books on
    // the target group may stack up to that point (each still a full group interval apart),
    // which is what lets "posts per run" actually deliver more than one. Anything past it is
    // the next run's work. An unparseable cron gives null → the old one-per-run behaviour.
    const cycleEnd = nextRunAt(campaign.schedule_cron);

    // How each copy angle has performed for THIS campaign — the bandit's evidence. Read
    // once per run; a handful of posts will not move it, and a failure here only means the
    // run keeps exploring evenly, which is the correct default anyway.
    const variantStats = await this.variantStats(campaign.id);

    let skipped = 0;
    for (let i = 0; i < toPost.length; i++) {
      const { product, kw: slotKeyword } = toPost[i];
      try {
        // Per-group pacing: place the post in the group's next free slot (spaced by the
        // group's interval from any pending post to it, any source). On a SCHEDULED run,
        // if the group is already booked this interval, skip — so two campaigns to one
        // group never collide and the group publishes at most 1/interval. Each post is
        // saved before the next iteration, so successive posts chain off each other.
        // ONLY for campaigns that actually publish to Telegram: a platform-filtered
        // campaign (e.g. Instagram-only) never posts to the group's Telegram channel, so
        // it neither books the group's slot nor gets skipped by it — it runs purely on
        // its own cron cadence.
        let scheduledAt = times[i];
        if (targets.length && (!platforms || platforms.has('telegram'))) {
          const { slot, skip } = await this.nextGroupSlot(
            userId, targets[0], times[i], campaign.id, cycleEnd,
          );
          if (skip && opts?.fromScheduler) { skipped++; continue; }
          scheduledAt = slot;
        } else {
          // No group to pace against (Pinterest-only / Instagram-only). Pace the campaign
          // against ITSELF — see solo-campaign-slot.ts: every run firing while the window
          // is closed resolves to the same opening minute, and this campaign used to book
          // all of them onto it.
          const { slotMs, skip } = soloCampaignSlot({
            baseMs: times[i].getTime(),
            furthestBookedMs: await this.furthestCampaignBooking(campaign.id),
            gapMs: (cronTypicalIntervalMin(campaign.schedule_cron || '') ?? 15) * 60_000,
            cycleEndMs: cycleEnd ? cycleEnd.getTime() : null,
            fromScheduler: !!opts?.fromScheduler,
            alignToWindow: (ms) => this.alignToWindow(ms, creds, window || undefined).getTime(),
          });
          if (skip) { skipped++; continue; }
          scheduledAt = new Date(slotMs);
        }
        // Always resolve a SHORT affiliate link via link.generate (~42 chars, per-product,
        // tracked). The promotion_link that product.query returns is a broken 1065-char
        // link — identical across products AND over Telegram's 1024 caption limit — which
        // is exactly what made these posts fail. Do NOT prefer it.
        const affiliateUrl = await this.getAffiliateLink(product.product_id, creds);
        const parts = this.priceParts(product, rate);
        // The copy angle this post is written in. Picked per post, not per run, so the
        // explore share is spread across the campaign instead of landing in one burst.
        const variant = pickVariant(variantStats, Math.random());
        // A bonus-pool product gets an HONEST angle on top of the copy variant: a real
        // discount is leaned on hard; without one it is "the week's pick" — never a
        // whispered "special price", because the bonus commission is the owner's, not
        // the shopper's (see bonus-copy.ts).
        const hints = [variantHint(variant, campaign.language)];
        if (bonusKeywordSet.has(slotKeyword.trim().toLowerCase())) {
          const pct = parts.origUsd > parts.saleUsd && parts.origUsd > 0
            ? Math.round((1 - parts.saleUsd / parts.origUsd) * 100) : 0;
          hints.push(bonusCopyHint(pct, campaign.language));
        }
        // Season context for THIS post. The sale-season line is about the calendar and fits
        // anything; the occasion line is about the product and only fits one a seasonal
        // keyword actually found — same rule the bonus angle above follows.
        const seasonHint = [
          seasonalKeywordSet.has(slotKeyword.trim().toLowerCase()) ? occasionHint : null,
          saleSeasonHint,
        ].filter(Boolean).join('\n') || null;
        const text = await this.generateText(
          product, campaign.language, rate, creds, template || undefined, parts.localOverride,
          undefined, undefined, false,
          {
            currencyPair, style: pinterestOnly ? 'pinterest' : undefined, seasonHint,
            copyHint: hints.filter(Boolean).join('\n'),
          },
        );

        // SCHEDULE at the campaign's cadence (not the shared queue) so an "every 3h"
        // campaign publishes every 3h instead of being re-paced to the 60-min queue interval.
        const post = this.repo.create({
          user_id: userId,
          campaign_id: campaign.id,
          product_id: product.product_id,
          product_title: product.title,
          product_image: product.image_url,
          product_video: product.video_url || null,
          is_brand_plus: !!product.brand_plus,
          affiliate_url: affiliateUrl,
          original_price_usd: parts.origUsd,
          sale_price_usd: parts.saleUsd,
          price_ils: parts.priceIls,
          generated_text: text,
          keyword: slotKeyword,
          // Recorded even when a template suppressed the hint — writing down an angle the
          // copy was not actually written in would poison the very stats that pick it.
          copy_variant: template ? null : variant.id,
          status: 'scheduled',
          scheduled_at: scheduledAt,
        });
        // Route to the campaign's target group(s). Without this the post carries no
        // channel_override and the scheduled-send cron delivers it to the DEFAULT channel —
        // which is exactly how an ALI4YOU campaign leaked into טקטי בקליק.
        if (targets.length) this.applyChannels(post, targets);

        await this.repo.save(post);
        result.queued++;
        if (seasonalKeywordSet.has(String(slotKeyword || '').trim().toLowerCase())) fromSeasonal++;
        // Durable de-dup memory (survives post deletion). On a re-post after the cooldown,
        // REFRESH created_at so the cooldown restarts from now — otherwise a recycled product
        // would keep its old timestamp and become postable again on the very next run.
        await this.postedRepo.query(
          `INSERT INTO campaign_posted_products (campaign_id, product_id, keyword, created_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (campaign_id, product_id)
           DO UPDATE SET created_at = now(), keyword = EXCLUDED.keyword`,
          [campaign.id, String(product.product_id), slotKeyword],
        ).catch(() => {});
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

    // Hand back the rotation slots pacing skipped, so their keywords lead the next run instead
    // of being stepped over for good — see keyword-cursor.ts. Relative update, so it composes
    // with the pre-run advance in either order.
    const giveBack = cursorGiveBack(perPost, skipped);
    if (giveBack) {
      await this.campaignRepo.decrement({ id: campaign.id }, 'keyword_cursor', giveBack).catch(() => {});
    }

    // Record what this run DID, so a later "publishing slower than configured" alert can
    // name the cause instead of sending the next investigation back to the server logs
    // (which is where the last four went). Best-effort — never fail a run over its note.
    const note = [
      `${result.queued} פוסטים`,
      skipped ? `${skipped} דולגו (הקבוצה תפוסה)` : null,
      result.failed ? `${result.failed} נכשלו` : null,
      // Before the errors, so a long error list cannot push it past the 400-char cut.
      seasonalRunNote(seasonalStatus, fromSeasonal),
      ...result.errors.slice(0, 3),
    ].filter(Boolean).join(' · ').slice(0, 400);
    // A run that produced NOTHING because of failures leaves no post row (fail-loudly
    // path) — log it as data, or the drift check reads the hole it leaves as a pacing
    // fault (issue #60). Healthy runs just prune the log so old entries age out.
    const ranButFailed = !result.queued && result.failed > 0;
    const failedRunLog = ranButFailed
      ? recordFailedRun(campaign.failed_run_log, new Date())
      : pruneRunLog(campaign.failed_run_log, new Date());
    await this.campaignRepo.update(
      { id: campaign.id }, { last_run_note: note, failed_run_log: failedRunLog },
    ).catch(() => {});

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

  /**
   * Bulk-translate every campaign's Hebrew/Arabic keywords to the English phrase
   * AliExpress actually indexes — IN PLACE — so searches match the site instead of
   * relying on per-search translation. Already-English keywords are left untouched, and
   * a keyword that can't be translated keeps its original (never worse). Returns the diff.
   */
  async translateCampaignKeywordsToEnglish(userId: string): Promise<{
    campaigns_updated: number;
    translations: Array<{ campaign: string; before: string; after: string }>;
  }> {
    const creds = await this.credentials.getRaw(userId);
    if (!creds) throw new BadRequestException('חסרים פרטי חיבור — הגדר אותם בהגדרות');
    if (!this.ai.hasAnyKey(creds)) {
      throw new BadRequestException('נדרש מפתח AI פעיל לתרגום — הגדר אותו בהגדרות ← שווקים');
    }

    const campaigns = await this.campaignRepo.find({ where: { user_id: userId } });
    const translations: Array<{ campaign: string; before: string; after: string }> = [];
    let updated = 0;

    for (const c of campaigns) {
      const src = (c.keywords || []).map((k) => (k || '').trim()).filter(Boolean);
      if (!src.length) continue;
      const out: string[] = [];
      let changed = false;
      for (const kw of src) {
        if (!NON_LATIN_RE.test(kw)) { out.push(kw); continue; }
        const en = await this.searchKeyword(kw, creds);
        if (en && en !== kw) { translations.push({ campaign: c.name, before: kw, after: en }); changed = true; }
        out.push(en || kw);
      }
      if (changed) {
        c.keywords = Array.from(new Set(out)); // de-dup, keep order
        await this.campaignRepo.save(c);
        updated++;
      }
    }
    return { campaigns_updated: updated, translations };
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
    // The agent hands over what it needed to write the copy; the clip and the Brand+ flag
    // aren't part of that, so an agent-run campaign published image-only until now.
    const media = await this.productMediaFor(data.product_id, creds, data as any);

    const post = this.repo.create({
      user_id: userId,
      campaign_id: campaignId,
      product_id: data.product_id,
      product_title: data.title,
      product_image: data.image_url,
      product_video: media.video,
      is_brand_plus: media.brandPlus,
      affiliate_url: affiliateUrl,
      original_price_usd: parts.origUsd,
      sale_price_usd: parts.saleUsd,
      price_ils: parts.priceIls,
      generated_text: data.generated_text,
      status: 'pending',
      pending_at: new Date(),
    });

    // Route to the campaign's target group(s), same as the plain runner — without this an
    // agent-routed campaign silently ignored its configured groups and posted to the
    // account's DEFAULT channel.
    const agentCampaign = await this.campaignRepo.findOne({ where: { id: campaignId } }).catch(() => null);
    const agentTargets = this.parseTargetChannels(agentCampaign?.target_channels);
    if (agentTargets.length) this.applyChannels(post, agentTargets);

    await this.repo.save(post);
    await this.sendToTelegram(post, creds);
    return post;
  }

  // ── Stuck posts cleanup (called by cron every 15 min) ────────────────────

  async resetStuckPendingPosts(): Promise<void> {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago
    // Key off pending_at (when the send was claimed), falling back to created_at for rows
    // written before pending_at existed — so a post that merely sat queued a long time
    // isn't marked "stuck" the moment it starts sending.
    await this.repo.createQueryBuilder()
      .update(Post)
      .set({ status: 'failed', error_message: 'Timed out — server may have restarted during send' })
      .where('status = :pending', { pending: 'pending' })
      .andWhere('COALESCE(pending_at, created_at) < :cutoff', { cutoff })
      .execute();
  }

  // ── Winner recycling (daily cron) ─────────────────────────────────────────

  /**
   * Republish PROVEN posts: one that accumulated real shopper clicks (≥ the user's
   * threshold) or an attributed commission gets a fresh run — new AI copy, same product
   * and targets — instead of dying after a single publish. Guardrails: opt-in per user,
   * at most ONE recycle per user per day (this cron is daily), a 14-day cooldown per
   * product, and a live price check that skips products that got pricier since (a stale
   * lower price would mislead buyers).
   */
  @Cron('0 20 4 * * *')
  async recycleWinners(): Promise<void> {
    let users: Array<{ user_id: string; min_clicks: number }> = [];
    try {
      users = await this.credentials.listRecycleEnabled();
    } catch {
      return;
    }
    for (const u of users) {
      try {
        // Subscription gate: recycling is an Autopilot+ feature — a user who toggled it
        // on and later downgraded keeps the toggle but the cron stops honoring it.
        if (!(await this.subscription.allows(u.user_id, 'winner_recycling').catch(() => true))) continue;
        await this.recycleForUser(u.user_id, u.min_clicks);
      } catch (err: any) {
        this.logger.warn(`winner recycle failed for ${u.user_id}: ${err?.message}`);
      }
    }
  }

  private async recycleForUser(userId: string, minClicks: number): Promise<void> {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const cooldown = new Date(Date.now() - 14 * 86_400_000);
    // Top candidates by clicks; a few, because the price check below may reject some.
    const candidates = await this.repo.createQueryBuilder('p')
      .where('p.user_id = :userId', { userId })
      .andWhere("p.status = 'sent'")
      .andWhere('p.sent_at < :weekAgo', { weekAgo })
      .andWhere(
        "(p.clicks_count >= :minClicks OR EXISTS (SELECT 1 FROM earnings e WHERE e.post_id = p.id AND e.status != 'cancelled'))",
        { minClicks },
      )
      .andWhere(
        'NOT EXISTS (SELECT 1 FROM posts p2 WHERE p2.user_id = p.user_id AND p2.product_id = p.product_id AND p2.created_at > :cooldown)',
        { cooldown },
      )
      // Products the learning engine muted: many clicks, never an order. Ranking by clicks
      // made those the FIRST candidates here — the recycler was systematically republishing
      // the products proven not to convert. A standing (un-undone) mute row keeps them out.
      .andWhere(
        `NOT EXISTS (SELECT 1 FROM manager_actions ma
                     WHERE ma.user_id = p.user_id AND ma.kind = 'product_mute'
                       AND ma.target_id = p.product_id AND ma.undone_at IS NULL)`,
      )
      .orderBy('p.clicks_count', 'DESC')
      .addOrderBy('p.sent_at', 'DESC')
      .take(3)
      .getMany();
    if (!candidates.length) return;

    const creds = await this.credentials.getRaw(userId).catch(() => null);
    if (!creds) return;

    for (const original of candidates) {
      // Live price check (AliExpress products only): the winner's appeal was its price —
      // if it rose >5% since, republishing the old figure would mislead. Fresh data, when
      // available, also feeds the new copy.
      let fresh: any = null;
      if (/aliexpress/i.test(original.affiliate_url || '') && creds.aliexpress_app_key) {
        fresh = await this.products.refreshPrice(userId, original.product_id).catch(() => null);
        if (fresh) {
          const usdRate = await this.rates.getRate(creds.currency_pair || 'USD_ILS');
          const freshUsd = this.priceParts(fresh, usdRate).saleUsd;
          if (freshUsd > 0 && original.sale_price_usd > 0 && freshUsd > original.sale_price_usd * 1.05) {
            this.logger.log(`recycle skip ${original.id}: price rose ($${original.sale_price_usd} → $${freshUsd})`);
            continue;
          }
        }
      }

      const campaign = original.campaign_id
        ? await this.campaignRepo.findOne({ where: { id: original.campaign_id } }).catch(() => null)
        : null;
      const currencyPair = campaign?.currency_pair?.trim() || creds.currency_pair || 'USD_ILS';
      const rate = await this.rates.getRate(currencyPair);
      const platforms = this.parseTargetPlatforms(campaign?.target_platforms);
      const pinterestOnly = !!platforms && platforms.size === 1 && platforms.has('pinterest');
      const template = campaign?.post_template?.trim()
        || (pinterestOnly ? '' : await this.getBodyText(userId, creds));

      const product = fresh || {
        product_id: original.product_id,
        title: original.product_title,
        sale_price: original.sale_price_usd,
        original_price: original.original_price_usd,
        currency: 'USD',
        discount_percent: 0,
        orders_count: 0,
        rating: 0,
      };
      const parts = this.priceParts(product, rate);

      // Fresh copy so followers see a NEW post, not a rerun. Out of AI credits →
      // fall back to the proven original text rather than skipping the winner.
      let text: string;
      try {
        text = await this.generateText(
          product, campaign?.language || 'he', rate, creds, template || undefined, parts.localOverride,
          undefined, undefined, false,
          { currencyPair, style: pinterestOnly ? 'pinterest' : undefined },
        );
      } catch {
        text = original.generated_text;
      }

      const maxOrderResult = await this.repo.createQueryBuilder('p')
        .select('MAX(p.queue_order)', 'maxOrder')
        .where('p.user_id = :userId AND p.status = :status', { userId, status: 'queued' })
        .getRawOne();

      const recycled = this.repo.create({
        user_id: userId,
        campaign_id: original.campaign_id || null,
        product_id: original.product_id,
        product_title: original.product_title,
        product_image: original.product_image,
        // Carry the winner's clip and Brand+ badge into the rerun — a recycled post that
        // drops them republishes the winner in a weaker form than the one that won.
        product_video: original.product_video || null,
        is_brand_plus: !!original.is_brand_plus,
        affiliate_url: original.affiliate_url,
        original_price_usd: parts.origUsd || original.original_price_usd,
        sale_price_usd: parts.saleUsd || original.sale_price_usd,
        price_ils: parts.priceIls || original.price_ils,
        generated_text: text,
        keyword: original.keyword || null,
        recycled_from: original.id,
        status: 'queued',
        queue_order: (maxOrderResult?.maxOrder ?? -1) + 1,
        channel_override: original.channel_override || null,
        channel_overrides: original.channel_overrides || null,
        gallery_json: original.gallery_json || null,
      } as Partial<Post>);
      await this.repo.save(recycled);
      await this.primeQueueClock(userId, recycled as Post, creds);
      this.logger.log(`recycled winner ${original.id} → new queued post (${original.clicks_count} clicks)`);
      return; // one winner per user per day
    }
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
    post.pending_at = new Date();
    post.error_message = null;
    await this.repo.save(post);
    await this.sendToTelegram(post, creds, post.channel_override || undefined);
    return post;
  }

  /**
   * The currency this post is priced in, with the live rate — the campaign's own override
   * when it has one, else the account default. Mirrors the precedence the copy itself uses,
   * so the coupon tier can never be quoted in a different currency than the price above it.
   *
   * Best-effort: a rates failure returns no money and the coupon falls back to USD, which is
   * accurate if less convenient. Publishing never waits on a conversion.
   */
  private async postMoney(
    post: Post, creds: DecryptedCredentials,
  ): Promise<{ rate: number; symbol: string } | undefined> {
    try {
      const campaign = post.campaign_id
        ? await this.campaignRepo.findOne({ where: { id: post.campaign_id } })
        : null;
      const pair = campaign?.currency_pair?.trim() || creds?.currency_pair || 'USD_ILS';
      const rate = await this.rates.getRate(pair);
      return { rate, symbol: currencySymbol(pair) };
    } catch {
      return undefined;
    }
  }

  /**
   * Clicks per copy angle for one campaign — what the bandit picks the next angle from.
   *
   * Only SENT posts count: a post that never published cannot have drawn a click, and
   * counting it would punish its angle for a delivery failure. Best-effort — an empty
   * result simply means the run explores the angles evenly.
   */
  // Public: the FLYLINK runner (supplier-products.service) draws from the same stats.
  async variantStats(campaignId: string): Promise<VariantStat[]> {
    const rows: any[] = await this.repo.query(
      `SELECT copy_variant                          AS variant,
              count(*)::int                         AS posts,
              coalesce(sum(clicks_count), 0)::int   AS clicks
       FROM posts
       WHERE campaign_id = $1 AND status = 'sent' AND copy_variant IS NOT NULL
       GROUP BY copy_variant`,
      [campaignId],
    ).catch(() => []);
    return rows.map((r) => ({
      variant: String(r.variant),
      posts: Number(r.posts) || 0,
      clicks: Number(r.clicks) || 0,
    }));
  }

  /**
   * The post's trackable /r/<code> URL, falling back to the raw affiliate link.
   *
   * Every place a shopper can click through to the product must use this. A link that
   * skips it is not just an uncounted click — it makes the whole post look dead to the
   * optimizer, which retires keywords that "drew no clicks" and boosts ones that did.
   *
   * Tracking must never block publishing: any failure returns the raw affiliate link.
   */
  private async trackedLink(post: Post): Promise<string> {
    try {
      const code = await this.links.ensureCode(post);
      if (code) {
        // Persist a durable code→URL mapping so this link keeps resolving to the product
        // even if the post is later deleted (the link lives forever in the published ad).
        void this.links.recordTarget(code, post.affiliate_url, post.user_id);
        return this.links.shortUrl(code);
      }
    } catch { /* fall back to the raw affiliate link */ }
    return post.affiliate_url;
  }

  // ── Designed frames for URL-ingest platforms ──────────────────────────────
  //
  // Telegram receives the designed image (studio/AI enhancement, collage sheets) as raw
  // UPLOADED bytes — but Facebook and Instagram ingest by URL, so they used to get the
  // ORIGINAL image while Telegram showed the designed one. The bridge: keep each publish's
  // first designed frame briefly in memory and serve it at a public URL the platform
  // fetchers hit seconds later. In-memory on purpose: the frame is consumed immediately
  // after the send, and losing it on a restart only means a fallback to the original URL.

  private readonly enhancedFrames = new Map<string, { buf: Buffer; at: number }>();
  private static readonly ENHANCED_FRAME_TTL_MS = 45 * 60_000;

  /** Remember a publish's first designed frame (no-op for URL-based media). */
  registerEnhancedFrame(postId: string, media: TgMedia): void {
    const now = Date.now();
    for (const [k, v] of this.enhancedFrames) {
      if (now - v.at > PostsService.ENHANCED_FRAME_TTL_MS) this.enhancedFrames.delete(k);
    }
    if (media?.kind !== 'buffers' || !media.buffers?.length) return;
    this.enhancedFrames.set(postId, { buf: media.buffers[0], at: now });
  }

  /**
   * Store an owner-uploaded image (already normalized by the controller) and return the
   * public URL every platform can ingest. DB-backed on purpose: no object storage here,
   * and the URL must survive restarts (see uploaded-image.entity.ts).
   */
  async saveUploadedImage(userId: string, data: Buffer): Promise<{ url: string }> {
    const base = (process.env.BACKEND_URL || '').replace(/\/$/, '');
    if (!base) throw new BadRequestException('BACKEND_URL אינו מוגדר — אין כתובת ציבורית לתמונות');
    const row = await this.uploadedImages.save(this.uploadedImages.create({ user_id: userId, data, mime: 'image/jpeg' }));
    return { url: `${base}/posts/uploaded/${row.id}` };
  }

  /** Bytes for the public /posts/uploaded/:id endpoint; null for an unknown id. */
  async getUploadedImage(id: string): Promise<{ data: Buffer; mime: string } | null> {
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
    const row = await this.uploadedImages.findOne({ where: { id } }).catch(() => null);
    return row ? { data: row.data, mime: row.mime } : null;
  }

  // Pinterest pin frames get their own store: Pinterest validates the image URL AT pin
  // creation with an impatient fetcher, so the frame is composed BEFORE the create call
  // and served from memory — a millisecond read instead of an on-the-fly compose that
  // timed their fetcher out (which failed the whole create with Pinterest's vague
  // "Sorry! Something went wrong on our end.").
  private readonly pinFrames = new Map<string, { buf: Buffer; at: number }>();

  registerPinFrame(postId: string, buf: Buffer): void {
    const now = Date.now();
    for (const [k, v] of this.pinFrames) {
      if (now - v.at > PostsService.ENHANCED_FRAME_TTL_MS) this.pinFrames.delete(k);
    }
    this.pinFrames.set(postId, { buf, at: now });
  }

  getPinFrame(postId: string): Buffer | null {
    const entry = this.pinFrames.get(String(postId || ''));
    if (!entry) return null;
    if (Date.now() - entry.at > PostsService.ENHANCED_FRAME_TTL_MS) {
      this.pinFrames.delete(String(postId));
      return null;
    }
    return entry.buf;
  }

  /** The frame bytes for the public /posts/enhanced/:id endpoint; null once expired. */
  getEnhancedFrame(postId: string): Buffer | null {
    const key = String(postId || '');
    const entry = this.enhancedFrames.get(key);
    if (!entry) return null;
    if (Date.now() - entry.at > PostsService.ENHANCED_FRAME_TTL_MS) {
      this.enhancedFrames.delete(key);
      return null;
    }
    return entry.buf;
  }

  /** Public URL serving this post's designed frame, or null when none was prepared.
   *  `fitIg` letterboxes it onto an Instagram-legal canvas server-side. */
  private enhancedFrameUrl(post: Post, opts?: { fitIg?: boolean }): string | null {
    if (!this.getEnhancedFrame(post.id)) return null;
    const base = (process.env.BACKEND_URL || '').replace(/\/$/, '');
    if (!base) return null;
    return `${base}/posts/enhanced/${post.id}${opts?.fitIg ? '?fit=ig' : ''}`;
  }

  /** Composes the final message body: affiliate link + per-channel footer + HTML
   *  normalisation. Shared by the publisher and the failed-channel retry. */
  private async buildPostBody(
    post: Post, creds: DecryptedCredentials, channelOverride?: string, platform?: PostPlatform,
  ): Promise<string> {
    // Trackable short link: the body carries our /r/<code> URL instead of the raw
    // affiliate link, so every shopper click is recorded (minutes-fast feedback + the
    // attribution weighting signal). Pinterest is unaffected — its Pin link rides the
    // dedicated `link` field with the DIRECT affiliate URL (redirects in that field risk
    // pin rejection), and Instagram strips body links entirely. Tracking must never
    // block publishing: on any failure we fall back to the raw link.
    const link = await this.trackedLink(post);

    // Legacy copy (and verbatim REPOSTS of it) embeds the raw affiliate URL inside the
    // text. In-place substitution left a bare URL in the body — which escapes the pretty
    // "🛒 לרכישה — לחצו כאן" anchor treatment (that only wraps the 🔗-prefixed link) and
    // showed followers a raw long link. Instead: STRIP the inline URL and re-attach the
    // tracked short link in the one standard 🔗 form every post uses.
    const linkAlreadyInText = post.affiliate_url && post.generated_text.includes(post.affiliate_url);
    let body: string;
    if (linkAlreadyInText) {
      // stripInlineLink removes the URL together with its 🔗 line — deleting only the URL
      // used to leave an orphan "🔗" above the re-attached standard link (the FLYLINK
      // "רווחים מיותרים" bug: price line, blank, bare 🔗, blank, CTA).
      body = `${stripInlineLink(post.generated_text, post.affiliate_url)}\n\n🔗 ${link}`;
    } else {
      body = post.affiliate_url ? `${post.generated_text}\n\n🔗 ${link}` : post.generated_text;
    }

    // Coupons are AliExpress-ONLY — the codes redeem at AliExpress checkout, so an AliExpress
    // code on a FLYLINK post is useless and misleading. Attach one only when this post's link
    // is an AliExpress link (source is inferred from the link, same as the posts-list filter).
    // Resolved at SEND time so a queued/scheduled post never ships a code that expired while
    // it waited; priced in USD because the tiers are ($7 OFF $55+).
    const isAliExpressPost = /aliexpress/i.test(post.affiliate_url || '');

    // Brand+ (official brand store): the badge that answers "is it original?" — the exact
    // hesitation that blocks a branded purchase. AliExpress-only by construction (the flag
    // comes from its API); emphasized in code so it can never be over- or under-claimed.
    if (post.is_brand_plus && isAliExpressPost && !body.includes(BRAND_PLUS_MARK)) {
      body = `${body}\n\n${brandPlusLine(/[֐-׿]/.test(body))}`;
    }

    const match = isAliExpressPost
      ? await this.coupons.bestFor(post.user_id, post.sale_price_usd).catch(() => null)
      : null;
    if (match && !body.includes(match.coupon.code)) {
      // Priced in the same currency as the rest of this post, so a shopper can tell at a
      // glance whether they qualify instead of converting the tier themselves.
      body = `${body}\n\n${this.coupons.couponLine(match.coupon, match.qualifies, await this.postMoney(post, creds))}`;
    }

    // FLYLINK trust trailer — the hesitation on hidden products is trust, not interest.
    // Code-built like the price block (fixed wording, can never over-promise), attached at
    // send time so verbatim re-posts and already-queued posts get it too. Mirrors the
    // coupon rule above: source inferred from the link. The block's replica line rides
    // along on the owner's own group channels only (see flylink-trust.ts).
    // hasFlylinkTrustBlock, not a single-mark check: the opening line IS the "already has
    // one" test, so a reworded block would stack a second trailer onto every post carrying
    // the previous wording.
    if (isFlylinkPost(post.affiliate_url) && !hasFlylinkTrustBlock(body)) {
      body = `${body}\n\n${flylinkTrustBlock(platform)}`;
    }

    // The bridge from one product to the whole catalog. Attached at send time like the
    // trust and price blocks, so a verbatim repost and an already-queued post get it too;
    // added only when the owner actually switched a store on, and never twice.
    if (this.storefront) {
      const store = await this.storefront.liveStore(post.user_id).catch(() => null);
      if (store && !hasStoreLine(body, store.url)) {
        body = `${body}\n\n${storeLine({ url: store.url, name: store.name, hebrew: NON_LATIN_RE.test(body) })}`;
      }
    }

    const footer = await this.resolveFooterText(post.user_id, creds, channelOverride);
    if (footer && !body.includes(footer)) body = `${body}\n\n${footer}`;
    // Collapse doubled checkmarks ("✔️ ✔️ נוחות") — imported file rows carried their own
    // leading ✔️ on top of the template's. Fixed at import too; this display-time collapse
    // also heals the posts already sitting in the queue with the doubled form.
    body = body.replace(/(?:[✔✓☑]️?\s*){2,}/gu, '✔️ ');
    // The owner's vocabulary, enforced LAST — after the footer, coupon, store and trust
    // lines have all been appended, so no later addition can slip a banned word past it.
    // The copy model is told the same rule in its brief; this is what holds when the text
    // came from a supplier title or an imported row and no model ever saw it.
    if (violatesWordPolicy(body)) {
      this.logger.log(`word policy rewrote post ${post.id}`);
      body = applyWordPolicy(body);
    }
    // Hebrew bodies: pin every line right (emoji/price/link-opening lines otherwise render
    // LTR — each line's direction follows its first strong character) and collapse the
    // blank-line runs the copy model produces. English bodies pass through untouched.
    return tidyRtlBody(mdBoldToHtml(body));
  }

  /**
   * Re-attempt ONLY the platform(s) that failed on a partially-published post (e.g.
   * Telegram already went out but Facebook was rejected). The failed platforms are
   * read from `error_message`; only those are re-sent, and publish credits are NOT
   * charged again (the post was already billed on its original publish).
   */
  /** Guards the auto-retry sweep against overlapping scheduler ticks. */
  private retryingNetworkPartials = false;

  /**
   * Re-send the channels that died at the WIRE, without waiting for the owner.
   *
   * A partially-published post is invisible to every other check — it is `sent` — so this
   * class of failure used to sit until the watchdog raised an issue and a human pressed
   * "retry". For a connect-phase failure that ceremony buys nothing: nothing reached Meta,
   * so re-sending is safe, and a few minutes later the network is usually back.
   *
   * Exactly ONE automatic attempt per post: the row is stamped whether or not the retry
   * worked, so a genuinely broken channel can never spin the scheduler. Anything the owner
   * must fix, and anything that might already have published, is left alone — see
   * network-partial.ts.
   */
  async retryNetworkPartials(limit = 5): Promise<number> {
    if (this.retryingNetworkPartials) return 0;
    this.retryingNetworkPartials = true;
    try {
      // Cast a WIDE net in SQL (anything wire-tagged or legacy-worded) and let
      // isRetryableNetworkPartial make the real decision per row — the attempt counter and
      // the mixed-error rule are easier to get right in one place than in a LIKE clause.
      const rows: Array<{ id: string; user_id: string }> = await this.repo.query(
        `SELECT id, user_id FROM posts
         WHERE status = 'sent' AND error_message IS NOT NULL
           AND (error_message LIKE $1 OR error_message LIKE '%נכשל ברמת הרשת%')
           AND sent_at > now() - interval '6 hours'
         ORDER BY sent_at DESC LIMIT $2`,
        [`%${NET_SAFE_TAG}%`, limit],
      ).catch(() => []);

      let healed = 0;
      for (const row of rows) {
        const before = await this.repo.findOne({ where: { id: row.id } });
        if (!isRetryableNetworkPartial(before?.error_message)) continue;
        try {
          await this.retryFailedChannels(row.user_id, row.id);
        } catch (err: any) {
          this.logger.warn(`auto-retry post ${row.id}: ${err?.message || err}`);
        }
        // Stamp AFTER the attempt, on whatever error text the retry left behind — a retry
        // that succeeded clears the message and needs no stamp; one that failed keeps it,
        // and the stamp is what counts this attempt against MAX_AUTO_RETRIES.
        const after = await this.repo.findOne({ where: { id: row.id } });
        if (after?.error_message) {
          after.error_message = `${after.error_message}${AUTO_RETRY_MARK}`;
          await this.repo.save(after);
        } else if (after && !after.error_message) {
          healed++;
          this.logger.log(`auto-retry post ${row.id}: recovered — all channels published`);
        }
      }
      return healed;
    } finally {
      this.retryingNetworkPartials = false;
    }
  }

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

    // Media up front (see the main send path): a Facebook/Instagram retry should also
    // publish the designed frame, not fall back to the raw original.
    const media = (failed('Telegram') || failed('Facebook') || failed('Make') || failed('Instagram'))
      ? await this.prepareTelegramMedia(post, creds)
      : undefined;
    if (media) this.registerEnhancedFrame(post.id, media);

    // Telegram: re-send to each failed target group (media prepared once, sent sequentially).
    if (failed('Telegram')) {
      tasks.push((async () => {
        for (const target of targets) {
          if (!groupFailed(target)) continue;
          const body = await this.buildPostBody(post, creds, target, 'telegram');
          const label = await this.targetLabel(userId, target, multi);
          try { await this.sendToTelegramChannel(post, creds, body, target, media); }
          catch (err: any) { errors.push(`Telegram: ${label}${telegramErrorText(err)}`); }
        }
      })());
    }
    // Facebook / Make: one send per unique failed page. FB is delivered via Make when enabled.
    if ((failed('Facebook') || failed('Make'))) {
      const pages = await this.resolvePages(userId, targets, creds);
      for (const [pageId, target] of pages) {
        if (!groupFailed(target)) continue;
        const body = await this.buildPostBody(post, creds, target, 'facebook');
        const label = await this.targetLabel(userId, target, multi && pages.size > 1);
        if ((failed('Facebook') && !wantMake)) {
          const { token, source } = await this.resolveFacebookPageToken(userId, target, creds);
          tasks.push(this.sendToFacebook(post, creds, body, pageId, token)
            .catch((err: any) => { errors.push(`Facebook: ${label}${facebookErrorText(err, 'facebook', pageId, source)}`); }));
        }
        if (failed('Make') || (failed('Facebook') && wantMake)) {
          tasks.push(this.sendToMakeWebhook(post, creds, body, pageId)
            .catch((err: any) => { errors.push(`Make: ${label}${err?.response?.data?.message || err.message}`); }));
        }
      }
    }
    if (failed('Instagram')) {
      const ig = await this.instagramTargetFor(userId, targets, creds);
      if (ig) {
        const body = await this.buildPostBody(post, creds, ig.target, 'instagram');
        tasks.push(this.sendToInstagram(post, creds, body, userId, ig.target)
          .catch((err: any) => { errors.push(`Instagram: ${facebookErrorText(err, 'instagram')}`); }));
      }
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
  async pushToPlatforms(
    userId: string, postId: string, platforms: string[], channels?: string[],
    opts?: { pinterestRewrite?: boolean },
  ): Promise<Post> {
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
    // Groups this push CONFIRMED delivery to — the record the posts list labels the row
    // with. Only successes land here, and only real group ids (a default-channel send
    // has no group to name).
    const delivered = new Set<string>();
    const markDelivered = (target?: string) => { if (target) delivered.add(target); };

    // Media up front (see the main send path): the designed frame must be registered
    // before Facebook/Instagram build their image URLs.
    const media = (want.has('telegram') || want.has('facebook') || want.has('instagram'))
      ? await this.prepareTelegramMedia(post, creds)
      : undefined;
    if (media) this.registerEnhancedFrame(post.id, media);

    if (want.has('telegram')) {
      tasks.push((async () => {
        for (const target of targetList) {
          const body = await this.buildPostBody(post, creds, target, 'telegram');
          const label = await this.targetLabel(userId, target, multi);
          try {
            await this.sendToTelegramChannel(post, creds, body, target, media);
            anySuccess = true;
            markDelivered(target);
          } catch (err: any) { errors.push(`Telegram: ${label}${telegramErrorText(err)}`); }
        }
      })());
    }
    if (want.has('facebook')) {
      const pages = await this.resolvePages(userId, targetList, creds);
      // Explicit push with no eligible page: say WHY nothing was sent — a group without
      // its own page must not fall back onto another brand's default page.
      if (!pages.size) {
        errors.push('Facebook: לקבוצות שנבחרו אין עמוד פייסבוק משלהן — הגדר עמוד לקבוצה במסך הקבוצות');
      }
      tasks.push((async () => {
        for (const [pageId, target] of pages) {
          const body = await this.buildPostBody(post, creds, target, 'facebook');
          const label = await this.targetLabel(userId, target, multi && pages.size > 1);
          const fb = wantMake ? null : await this.resolveFacebookPageToken(userId, target, creds);
          try {
            if (wantMake) await this.sendToMakeWebhook(post, creds, body, pageId);
            else await this.sendToFacebook(post, creds, body, pageId, fb!.token);
            anySuccess = true;
            markDelivered(target);
          } catch (err: any) {
            errors.push(`${wantMake ? 'Make' : 'Facebook'}: ${label}${wantMake
              ? (err?.response?.data?.message || err?.message)
              : facebookErrorText(err, 'facebook', pageId, fb!.source)}`);
          }
        }
      })());
    }
    if (want.has('instagram')) {
      const ig = await this.instagramTargetFor(userId, targetList, creds);
      if (ig) {
        const body = await this.buildPostBody(post, creds, ig.target, 'instagram');
        tasks.push(this.sendToInstagram(post, creds, body, userId, ig.target)
          .then(() => { anySuccess = true; markDelivered(ig.target); })
          .catch((err: any) => { errors.push(`Instagram: ${facebookErrorText(err, 'instagram')}`); }));
      } else {
        errors.push('Instagram: לקבוצות שנבחרו אין חשבון אינסטגרם משלהן — הגדר חשבון לקבוצה במסך הקבוצות');
      }
    }
    if (want.has('pinterest')) {
      // A push re-sends the post AS IS by design (no AI re-charge) — which means a Hebrew
      // Telegram post lands on an English board in Hebrew, priced in ₪. When the owner
      // opts in, rewrite it for Pinterest instead: English SEO copy, USD price, pin
      // format. The stored post is NOT touched — the Telegram message it already
      // published stays exactly as it is.
      const rewrite = opts?.pinterestRewrite
        ? await this.pinterestRewrite(post, creds).catch((err: any) => {
          errors.push(`Pinterest: הכתיבה מחדש נכשלה (${err?.message || err}) — הפין לא נשלח`);
          return null;
        })
        : undefined;
      if (!(opts?.pinterestRewrite && !rewrite)) {
        // The Pinterest rewrite is its own AI draft and does NOT pass through
        // buildPostBody, so the vocabulary policy is applied to it here — otherwise the one
        // path that skips the choke point is the one that reaches a public board.
        const body = rewrite?.text
          ? applyWordPolicy(rewrite.text)
          : await this.buildPostBody(post, creds, targetList[0], 'pinterest');
        tasks.push(this.sendToPinterest(post, creds, body, rewrite
          ? { titleFromMessage: true, priceLabel: rewrite.priceLabel }
          : undefined)
          .then(() => { anySuccess = true; })
          .catch((err: any) => { errors.push(`Pinterest: ${err?.response?.data?.message || err?.response?.data?.error?.message || err.message}`); }));
      }
    }
    if (want.has('whatsapp')) {
      const body = await this.buildPostBody(post, creds, targetList[0], 'whatsapp');
      tasks.push(this.sendToWhatsApp(post, creds, body)
        .then(() => { anySuccess = true; })
        .catch((err: any) => { errors.push(`WhatsApp: ${err?.response?.data?.error?.message || err?.response?.data?.message || err.message}`); }));
    }
    await Promise.all(tasks);

    // Merge into the existing error_message: drop old lines for the platforms we just
    // attempted (they've been re-tried now), keep unrelated ones, add fresh failures.
    const attemptedTokens: string[] = [];
    if (want.has('telegram')) attemptedTokens.push('Telegram');
    if (want.has('facebook')) attemptedTokens.push('Facebook', 'Make');
    if (want.has('instagram')) attemptedTokens.push('Instagram');
    if (want.has('pinterest')) attemptedTokens.push('Pinterest');
    if (want.has('whatsapp')) attemptedTokens.push('WhatsApp');
    const kept = (post.error_message || '').split('|').map((s) => s.trim()).filter(Boolean)
      .filter((line) => !attemptedTokens.some((tok) => new RegExp(`^${tok}:`, 'i').test(line)));
    const merged = [...kept, ...errors].filter(Boolean);
    post.error_message = merged.length ? merged.join(' | ') : null;
    // ONLY a push that actually reached a platform may mark the post sent. This used to run
    // unconditionally, and the row was saved before the failure was thrown — so a push where
    // every platform failed still left the post reading 'נשלח' in the list forever, with the
    // real error buried in error_message. The caller saw an error once; the record lied after.
    // Record where this push ACTUALLY landed, so the list stops labelling the row with the
    // group the post was merely aimed at (a hand-push to another group used to keep showing
    // the original). Display only — targeting is untouched, so nothing is re-routed.
    if (anySuccess) {
      let existing: string[] = [];
      try {
        const parsed = post.delivered_channels ? JSON.parse(post.delivered_channels) : [];
        if (Array.isArray(parsed)) existing = parsed;
      } catch { /* unreadable record — rebuilt from scratch below */ }
      const record = mergeDeliveredChannels({
        wasSent: post.status === 'sent',
        existing,
        intended: this.resolveTargets(post).filter((t): t is string => !!t),
        pushed: Array.from(delivered),
      });
      if (record) post.delivered_channels = JSON.stringify(record);
    }

    if (anySuccess) {
      if (post.status !== 'sent') post.status = 'sent';
      if (!post.sent_at) post.sent_at = new Date();
    }
    // The error message is persisted either way — a failed push must leave its reason behind.
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
  async requeue(
    userId: string, postId: string, scheduledAt?: string,
    channels?: string[], platforms?: string[],
  ): Promise<Post> {
    const post = await this.repo.findOne({ where: { id: postId, user_id: userId } });
    if (!post) throw new NotFoundException('פוסט לא נמצא');

    // Retargeting, when the dialog sent a choice. `undefined` = the field wasn't offered
    // (old clients) → inherit as always. An explicit EMPTY list means "back to default":
    // no groups = the default channel, no platforms = campaign/account rules.
    if (channels !== undefined) {
      const uniq = Array.from(new Set((channels || [])
        .map((c) => (typeof c === 'string' ? c.trim() : '')).filter(Boolean)));
      post.channel_override = uniq[0] || null;
      post.channel_overrides = uniq.length > 1 ? JSON.stringify(uniq) : null;
    }
    if (platforms !== undefined) {
      const uniq = Array.from(new Set((platforms || [])
        .map((p) => String(p).toLowerCase().trim()).filter(Boolean)));
      post.target_platforms = uniq.length ? JSON.stringify(uniq) : null;
    }

    post.error_message = null;
    post.sent_at = null;
    post.telegram_message_id = null;
    post.facebook_post_id = null;
    post.instagram_post_id = null;
    post.pinterest_post_id = null;
    post.whatsapp_message_id = null;

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

  /** A campaign's target_platforms JSON as a lowercase Set, or null when unset (= use the
   *  account-global publish toggles). */
  private parseTargetPlatforms(raw: string | null | undefined): Set<string> | null {
    if (!raw) return null;
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr) || !arr.length) return null;
      return new Set(arr.map((p) => String(p).toLowerCase()));
    } catch {
      return null;
    }
  }

  /** The platform filter for a post: its OWN override first (set by the republish
   *  dialog), then its campaign's target_platforms, or null for everything else
   *  (= the account-global publish toggles). */
  private async postPlatformFilter(post: Post): Promise<Set<string> | null> {
    const own = this.parseTargetPlatforms(post.target_platforms);
    if (own) return own;
    if (!post.campaign_id) return null;
    const campaign = await this.campaignRepo
      .findOne({ where: { id: post.campaign_id } })
      .catch(() => null);
    return this.parseTargetPlatforms(campaign?.target_platforms);
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
    const defaultGroupId = await this.defaultChannelGroupId(userId, creds);
    const pages = new Map<string, string | undefined>();
    for (const t of targets) {
      const pid = await this.resolveFacebookPageId(userId, t, creds, defaultGroupId);
      if (!pid) {
        if (t) this.logger.log(`Facebook skipped for group ${t} — it has no page of its own (the account default page belongs to the default-channel group)`);
        continue;
      }
      if (!pages.has(pid)) pages.set(pid, t);
    }
    return pages;
  }

  /**
   * The saved group whose chat IS the account's default Telegram channel (or null).
   * The account-level Facebook page / Instagram account belong to THIS audience —
   * other groups must not fall back to them (a tactical product must never land on
   * the מאמא brand page just because the tactical group has no page of its own).
   */
  private async defaultChannelGroupId(userId: string, creds: DecryptedCredentials | null): Promise<string | null> {
    if (!creds?.telegram_channel_id) return null;
    return this.channels.groupIdForChat(userId, creds.telegram_channel_id).catch(() => null);
  }

  /**
   * The target whose Instagram account this post may publish to: the first target with
   * its OWN IG account; else a default (no-group) post or the default-channel group,
   * which use the account's global IG. Null → skip Instagram for this post entirely.
   */
  private async instagramTargetFor(userId: string, targets: (string | undefined)[], creds: DecryptedCredentials): Promise<{ target: string | undefined } | null> {
    for (const t of targets) {
      if (t && await this.channels.getInstagramBusinessId(userId, t).catch(() => null)) return { target: t };
    }
    const defaultGroupId = await this.defaultChannelGroupId(userId, creds);
    for (const t of targets) {
      if (!t || t === defaultGroupId) return { target: t };
    }
    this.logger.log('Instagram skipped — no target group has its own IG account and none is the default-channel group');
    return null;
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

    // A campaign that declares target_platforms publishes ONLY there — its posts ignore
    // the account-global toggles entirely (an English Pinterest-only campaign must not
    // leak into the Hebrew Telegram groups, and the Hebrew campaigns must not flood its
    // Pinterest board). `only` is null for non-campaign posts and legacy campaigns.
    const only = await this.postPlatformFilter(post);

    // Any explicit group target always means Telegram. Otherwise respect the user's
    // per-channel publish toggles (Telegram defaults on, Facebook defaults off).
    // Facebook honours its toggle GLOBALLY — even for group/queue posts — so enabling
    // "publish to Facebook" fans every post out to the page(s), not only default posts.
    const wantTelegram = only
      ? only.has('telegram')
      : targets.some((t) => !!t) || creds?.publish_telegram !== false;
    // Make.com is a GLOBAL relay for Facebook: when enabled + a webhook is set, FB is
    // delivered by POSTing to the user's Make scenario. BUT a channel that has its OWN
    // Facebook page token must still publish NATIVELY with that token even when Make is on —
    // otherwise the per-channel token the user configured is silently ignored (exactly why
    // Ali4You wasn't posting). So `wantFacebook` is just the master switch; per-target below
    // we pick native (own token) vs the Make relay.
    // Subscription gating: platforms above the user's plan tier are dropped from the
    // fan-out (feature enforcement, not a toggle). A dropped-but-wanted platform is
    // reported in errors below so the post shows "פורסם חלקית" with the upgrade reason
    // instead of silently not appearing on that platform.
    const gate = await this.subscription.platformGate(post.user_id);
    const planBlocked: string[] = [];
    const gated = (want: boolean, platform: string, label: string): boolean => {
      if (want && !gate.has(platform)) { planBlocked.push(label); return false; }
      return want;
    };
    const makeRelay = (!only || only.has('facebook'))
      && creds?.publish_via_make === true && !!creds?.make_webhook_url
      && gate.has('facebook');
    const wantFacebook = gated(only ? only.has('facebook') : creds?.publish_facebook === true, 'facebook', 'פייסבוק');
    const wantInstagram = gated(only ? only.has('instagram') : creds?.publish_instagram === true, 'instagram', 'אינסטגרם');
    // The GLOBAL "every post to Pinterest too" fan-out stands down while the Trial-tier
    // write block is fresh: each attempt is a guaranteed failure that stamps an
    // otherwise-successful post "published partially" and re-raises the watchdog nightly.
    // One probe a day (TIER_BLOCK_RETRY_MS) keeps it self-healing — when Standard access
    // lands, the next probe succeeds and clears the block with no manual step. Dedicated
    // pinterest-only posts are NOT suppressed: their campaign auto-pauses on the same
    // failure, and an explicit push must always be allowed to try.
    const globalPinterest = creds?.publish_pinterest === true
      && !tierBlockActive(creds?.pinterest_tier_blocked_at, Date.now());
    const wantPinterest = gated(only ? only.has('pinterest') : globalPinterest, 'pinterest', 'פינטרסט');
    const wantWhatsapp = gated(only ? only.has('whatsapp') : creds?.publish_whatsapp === true, 'whatsapp', 'וואטסאפ');

    // No channel enabled → fail WITHOUT charging credits (the check used to run
    // after the consume, so users were billed for a post sent nowhere).
    if (!wantTelegram && !wantFacebook && !wantInstagram && !wantPinterest && !wantWhatsapp && !makeRelay) {
      post.status = 'failed';
      post.error_message = planBlocked.length
        ? `הפלטפורמות ${planBlocked.join(', ')} אינן כלולות בתוכנית שלך — שדרג בהגדרות ← מנוי`
        : 'לא הופעל אף ערוץ פרסום — הפעל טלגרם/פייסבוק בהגדרות';
      await this.repo.save(post);
      return;
    }
    if (planBlocked.length) {
      errors.push(`תוכנית: ${planBlocked.join(', ')} לא נשלחו — זמינים בתוכנית גבוהה יותר`);
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

    // Prepare the album media ONCE, UP FRONT (not inside the Telegram task): recomputing
    // collage/enhancement per group in parallel overloaded the instance, and hoisting it
    // above the tasks lets the designed frame be REGISTERED before Facebook/Instagram
    // build their image URLs — so URL-ingest platforms publish the same designed image
    // Telegram uploads, instead of the raw original.
    const media = (wantTelegram || wantFacebook || wantInstagram)
      ? await this.prepareTelegramMedia(post, creds)
      : undefined;
    if (media) this.registerEnhancedFrame(post.id, media);

    if (wantTelegram) {
      tasks.push((async () => {
        for (const target of targets) {
          const body = await this.buildPostBody(post, creds, target, 'telegram');
          const label = await this.targetLabel(post.user_id, target, multi);
          try {
            await this.sendToTelegramChannel(post, creds, body, target, media);
            anySuccess = true;
          } catch (err: any) {
            errors.push(`Telegram: ${label}${telegramErrorText(err)}`);
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
        const body = await this.buildPostBody(post, creds, target, 'facebook');
        const label = await this.targetLabel(post.user_id, target, multi && pages.size > 1);
        const ownToken = target ? await this.channels.getFacebookPageToken(post.user_id, target) : null;
        // Advance the page's FB clock only on a successful publish, so the next post's throttle
        // check is accurate. Native and Make both count (Make can't return an id, so we track here).
        const markSent = () => { if (target) this.channels.markFacebookSent(post.user_id, target).catch(() => {}); };

        if (ownToken) {
          tasks.push(
            this.sendToFacebook(post, creds, body, pageId, ownToken)
              .then(() => { anySuccess = true; markSent(); })
              .catch((err: any) => { errors.push(`Facebook: ${label}${facebookErrorText(err, 'facebook', pageId, 'channel')}`); }),
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
              .catch((err: any) => { errors.push(`Facebook: ${label}${facebookErrorText(err, 'facebook', pageId, 'account')}`); }),
          );
        }
      }
    }

    // Image-only platforms are SKIPPED for imageless posts instead of attempted: a
    // text-only post (an import row whose enrichment never found the product) publishes
    // fine to Telegram, but Instagram and Pinterest have nothing to show — the attempt
    // was guaranteed to fail, and its error stamped an otherwise-good post "published
    // partially", waking the watchdog nightly over something no fix can change.
    let hasImage = !!post.product_image;
    if (!hasImage) {
      try {
        const g = post.gallery_json ? JSON.parse(post.gallery_json) : [];
        hasImage = Array.isArray(g) && !!g[0];
      } catch { /* no gallery */ }
    }
    if (!hasImage && (wantInstagram || wantPinterest)) {
      this.logger.log(`post ${post.id} has no image — Instagram/Pinterest skipped (image platforms)`);
    }

    // Instagram: one account per post — the target group's own when it has one; the
    // account's global IG only for default/default-group posts (brand isolation — same
    // rule as Facebook). No qualifying target → IG is skipped for this post.
    if (wantInstagram && hasImage) {
      const ig = await this.instagramTargetFor(post.user_id, targets, creds);
      if (ig) {
        const body = await this.buildPostBody(post, creds, ig.target, 'instagram');
        tasks.push(
          this.sendToInstagram(post, creds, body, post.user_id, ig.target)
            .then(() => { anySuccess = true; })
            .catch((err: any) => { errors.push(`Instagram: ${facebookErrorText(err, 'instagram')}`); }),
        );
      }
    }

    // Pinterest: a single board (no per-group fan-out). The Pin's link is the affiliate URL.
    if (wantPinterest && hasImage) {
      // A DEDICATED Pinterest campaign pins the generated text alone — the account
      // footer/coupon lines are group-channel copy (usually Hebrew CTAs) that would
      // pollute a keyword-optimized pin description. Mixed-platform posts keep the
      // full body so their pin matches what the other channels published.
      const dedicated = !!only && only.size === 1 && only.has('pinterest');
      const body = dedicated
        ? mdBoldToHtml(post.generated_text)
        : await this.buildPostBody(post, creds, targets[0], 'pinterest');
      tasks.push(
        this.sendToPinterest(post, creds, body, { titleFromMessage: dedicated })
          .then(() => {
            anySuccess = true;
            // A pin landed — whatever tier block was recorded is over (approval arrived).
            if (creds?.pinterest_tier_blocked_at) {
              void this.credentials.clearPinterestTierBlock(post.user_id).catch(() => {});
            }
          })
          .catch((err: any) => {
            errors.push(`Pinterest: ${err?.response?.data?.message || err?.response?.data?.error?.message || err.message}`);
            // Remember the definite tier refusal so the global fan-out stands down (above).
            if (isTierBlockError(err?.message)) {
              void this.credentials.markPinterestTierBlocked(post.user_id).catch(() => {});
            }
          }),
      );
    }

    // WhatsApp: a single target group (Green API) — no per-Telegram-group fan-out.
    if (wantWhatsapp) {
      const body = await this.buildPostBody(post, creds, targets[0], 'whatsapp');
      tasks.push(
        this.sendToWhatsApp(post, creds, body)
          .then(() => { anySuccess = true; })
          .catch((err: any) => { errors.push(`WhatsApp: ${err?.response?.data?.error?.message || err?.response?.data?.message || err.message}`); }),
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
      // Nothing was published — the publish credit consumed above bought nothing, so
      // refund it. Otherwise a lapsed token / outage silently drains paid credits.
      if (post.user_id) {
        await this.subscription.refund(post.user_id, this.subscription.costs.publish, 'publish-failed');
      }
      // The Trial-tier refusal is not a transient failure: every future run of a
      // Pinterest-ONLY campaign will fail identically until Pinterest grants Standard
      // access — burning an AI-copy credit per post and re-raising the same watchdog
      // alert nightly. Pause the campaign once, with the reason on it, and let the owner
      // resume after approval. Mixed-platform campaigns keep running: their other
      // channels still publish, and their pins resume on their own once access lands.
      if (post.campaign_id && errors.some((e) => isTierBlockError(e))) {
        await this.pausePinterestOnlyCampaign(post.campaign_id).catch((err: any) =>
          this.logger.warn(`tier-block auto-pause failed for campaign ${post.campaign_id}: ${err?.message}`));
      }
    }
    await this.repo.save(post);
  }

  /** Pause a Pinterest-only campaign that hit the Trial-tier write block (see caller). */
  private async pausePinterestOnlyCampaign(campaignId: string): Promise<void> {
    const campaign = await this.campaignRepo.findOne({ where: { id: campaignId } });
    if (!campaign || campaign.status !== 'active') return; // already paused / gone
    const platforms = this.parseTargetPlatforms(campaign.target_platforms);
    if (!platforms || platforms.size !== 1 || !platforms.has('pinterest')) return;
    campaign.status = 'paused';
    campaign.last_run_note =
      'הושהה אוטומטית: פינטרסט (Trial) חוסמת פרסום פינים עד אישור Standard access. '
      + 'כשהאישור מגיע — הפעל את הקמפיין מחדש מכאן.';
    await this.campaignRepo.save(campaign);
    this.logger.warn(`campaign ${campaignId} auto-paused: Pinterest Trial tier blocks pin writes`);
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
    // Gated: image enhancement is a Growth+ feature, so a lower plan that flipped the
    // toggle doesn't get it for free.
    if (creds?.image_enhance_enabled && !post.collage_cells
        && await this.subscription.allows(post.user_id, 'image_enhancer')) {
      const src = gallery.length ? gallery.slice(0, 10) : (post.product_image ? [post.product_image] : []);
      if (src.length) {
        // 'ai' mode: Gemini's image model ("Nano Banana") redesigns the shot(s) — clean
        // studio background, pro lighting — on the user's own Gemini key. Falls back to
        // the local studio pass per-image and wholesale, so publishing never blocks on AI.
        let buffers: Buffer[] = [];
        if (creds.image_enhance_mode === 'ai') {
          buffers = await this.aiRedesignImages(src, creds).catch(() => [] as Buffer[]);
        }
        if (!buffers.length) buffers = await this.collage.enhance(src).catch(() => [] as Buffer[]);
        if (buffers.length) return { kind: 'buffers', buffers };
      }
    }

    if (gallery.length > 1) return { kind: 'album', images: gallery.slice(0, 10) };
    return { kind: 'single', image: post.product_image };
  }

  /**
   * The redesign brief for Nano Banana. Two rules, in order:
   *  1. FIDELITY — an affiliate post must show the REAL product. The model may restage
   *     everything around it, never the item itself.
   *  2. THE BACKGROUND SELLS — the photo is the first (often only) thing a follower sees,
   *     so instead of a sterile studio sweep, stage the product in an appealing setting
   *     that matches what it is FOR. The product must remain the unmistakable hero:
   *     razor-sharp against a softly blurred scene, never lost in it.
   */
  private static readonly NANO_BANANA_PROMPT =
    'Redesign this e-commerce product photo into a scroll-stopping ad shot. '
    + 'RULE 1 — the product itself must stay 100% identical: same shape, colors, materials, printed text and logos; do not add, remove or alter anything on the product. '
    + 'RULE 2 — replace the background with an attractive, premium setting that fits the product\'s real use context (outdoor gear in nature, fashion against a stylish urban or interior backdrop, home items in a beautiful modern room, electronics on a sleek desk, toys in a bright playful space). '
    + 'Keep the product large in frame and razor-sharp as the clear hero, with the background softly blurred (shallow depth of field) so it adds interest without stealing attention. '
    + 'Dramatic but natural lighting, rich tasteful colors, strong contrast between product and scene, a subtle grounding shadow. '
    + 'Photorealistic only — no added text, no watermarks, no people, no invented branding.';

  /**
   * One-image AI-redesign preview so the owner can SEE the Nano Banana style before
   * enabling it for real posts. Explicit user action → exactly one Gemini call on the
   * user's own key. `imageUrl` optional: defaults to the newest post's product image, so
   * the preview shows the owner's OWN merchandise, not a stock demo. Errors are thrown
   * in Hebrew — this surfaces directly in the settings screen.
   */
  async enhancePreview(userId: string, imageUrl?: string): Promise<{ before: string; after_data_url: string }> {
    if (!(await this.subscription.allows(userId, 'image_enhancer'))) {
      throw new BadRequestException('שדרוג תמונות אינו כלול בתוכנית שלך — שדרג בהגדרות ← מנוי');
    }
    const creds = await this.credentials.getRaw(userId);
    if (!creds?.gemini_api_key) {
      throw new BadRequestException('חסר מפתח Gemini — הדבק אותו בהגדרות ← אינטגרציות כדי להשתמש בעיצוב AI');
    }

    let src = (imageUrl || '').trim();
    if (!src) {
      const recent = await this.repo.createQueryBuilder('p')
        .where('p.user_id = :userId', { userId })
        .andWhere("p.product_image IS NOT NULL AND p.product_image <> ''")
        .orderBy('p.created_at', 'DESC')
        .getOne();
      src = recent?.product_image || '';
    }
    if (!src) throw new BadRequestException('אין תמונת מוצר לתצוגה מקדימה — פרסם פוסט אחד קודם');

    const raw = await this.collage.fetchAsJpeg(src);
    if (!raw) throw new BadRequestException('לא הצלחתי להוריד את תמונת המוצר — נסה שוב');
    const gen = await this.ai.generateProductImage(
      creds, { mime: 'image/jpeg', data: raw.toString('base64') }, PostsService.NANO_BANANA_PROMPT,
    );
    if (!gen?.data?.length) {
      throw new BadRequestException('מודל התמונות לא החזיר תוצאה — בדוק את מפתח ה-Gemini ונסה שוב');
    }
    // Same bounding the real send path applies — the preview must show what actually ships.
    const bounded = (await this.collage.boundJpeg(gen.data)) || gen.data;
    return { before: src, after_data_url: `data:image/jpeg;base64,${bounded.toString('base64')}` };
  }

  /**
   * AI-redesign the first few images (cost control — the image model bills per image),
   * studio-pass the rest so the album stays visually coherent. Any per-image failure
   * degrades to the studio pass for that image; an empty result makes the caller fall
   * back to the studio pass wholesale.
   */
  private async aiRedesignImages(urls: string[], creds: DecryptedCredentials): Promise<Buffer[]> {
    const AI_MAX = 3;
    const out: Buffer[] = [];
    for (let i = 0; i < Math.min(urls.length, 10); i++) {
      const url = urls[i];
      if (i < AI_MAX) {
        const raw = await this.collage.fetchAsJpeg(url);
        if (raw) {
          const gen = await this.ai.generateProductImage(
            creds, { mime: 'image/jpeg', data: raw.toString('base64') }, PostsService.NANO_BANANA_PROMPT,
          );
          if (gen?.data?.length) {
            // Never upload the AI's raw output: it answers in PNG at native resolution
            // (several MB each), and a few of those in one album blew the 120s Telegram
            // upload. Bound it to the same ≤1440px JPEG envelope as every other image.
            const bounded = await this.collage.boundJpeg(gen.data);
            if (bounded) { out.push(bounded); continue; }
          }
        }
      }
      const studio = await this.collage.enhance([url]).catch(() => [] as Buffer[]);
      if (studio.length) out.push(studio[0]);
    }
    return out;
  }

  /**
   * Delivers a post's (pre-prepared) media + caption to ONE Telegram chat. `media` is
   * computed once by prepareTelegramMedia and reused across all target groups; when
   * omitted it is computed here (single-target callers).
   */
  private async sendToTelegramChannel(post: Post, creds: DecryptedCredentials, caption: string, channelOverride?: string, media?: TgMedia) {
    // Stamp the short link with its platform BEFORE the anchor rewrite below wraps it —
    // the tag is how the click recorder knows this click came from Telegram.
    caption = tagShortLinks(caption, 'tg');
    // Telegram renders HTML anchors — hide the raw link URL behind friendly CTA text so
    // followers see "לרכישה — לחצו כאן" instead of a long address (the URL rides the
    // anchor entity: clicks still track and still credit the affiliate). Telegram-only:
    // WhatsApp/Facebook get the plain-text body, where the raw URL must stay visible.
    caption = caption.replace(/🔗\s*(https?:\/\/\S+)/g, (_m, url) =>
      `<a href="${url}">${NON_LATIN_RE.test(caption) ? '🛒 לרכישה — לחצו כאן 🛒' : '🛒 Tap here to shop 🛒'}</a>`);

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

    // The product's own video, when the account opted in — it autoplays MUTED in the
    // feed, which is the scroll-stopper the owner wants. Falls back to the image ONLY
    // when it is provably safe: Telegram rejected the video (a response = nothing was
    // published) or the request never connected. An ambiguous failure (top-level
    // timeout on an open socket) rethrows — falling back there could publish the post
    // TWICE, once as video and once as photo (same doctrine as telegram-retry.ts).
    // Last chance to find the clip for a post whose row doesn't carry one yet.
    await this.ensureProductVideo(post, creds);

    if (creds?.prefer_product_video && post.product_video) {
      try {
        await this.sendTelegramVideo(token, channel, post.product_video, mediaCaption, post);
        await sendOverflow();
        return;
      } catch (err: any) {
        if (!err?.response && !isTelegramConnectionError(err)) throw err;
        this.logger.warn(`post ${post.id}: video send rejected (${err?.response?.data?.description || err?.code || err?.message}) — falling back to image`);
      }
    }

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
      // `photo` is a URL, so Telegram fetches the file from the supplier's CDN before it
      // answers — the same server-side round trip the video path already budgets 45s for.
      // This path was left at 15s, which is not the time WE need but the time TELEGRAM
      // needs, and a slow CDN aborted the send into the one outcome the system cannot
      // resolve by itself: a top-level ETIMEDOUT, where the post may or may not be live and
      // a retry may or may not duplicate it. Waiting longer costs a slow run; aborting early
      // costs a post nobody can safely re-send.
      const res = await this.tgRetryOnce('photo', () => axios.post(
        url,
        { chat_id: channel, photo: image, caption: mediaCaption, parse_mode: 'HTML' },
        { timeout: 45_000 },
      ));
      this.assertTelegramDelivered(res, 'photo');
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
          { timeout: 45_000 },   // same server-side CDN fetch as the attempt above
        );
        this.assertTelegramDelivered(res, 'photo');
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
  /**
   * A Telegram send "succeeded" ONLY when the API confirms it — `ok:true` with a real
   * result/message_id. axios throws on 4xx/5xx, but a 200 body carrying `ok:false` (or an
   * empty result) would otherwise resolve and mark the post 'sent' though nothing was
   * delivered — a post shown as sent but missing from the group. Throw so it reads as
   * failed and can be retried.
   */
  /**
   * Run a Telegram send, and give it ONE more attempt if it died at the connection level.
   *
   * Anything else — an API rejection, a caption that won't parse, an unconfirmed delivery —
   * rethrows untouched so the existing handling (plain-text fallback, hard failure) still
   * decides. See `isTelegramConnectionError` for why the line sits exactly there.
   */
  /**
   * Publish the product's video by URL. Telegram fetches the file server-side (URL sends
   * are capped at ~20MB — AliExpress product clips are short and fit), so the timeout is
   * longer than the photo path's. Mirrors the photo path's contracts: confirmed-delivery
   * check, one connection-level retry, and a plain-text resend when the HTML won't parse.
   */
  private async sendTelegramVideo(token: string, channel: string, video: string, caption: string, post: Post) {
    const url = `https://api.telegram.org/bot${token}/sendVideo`;
    try {
      const res = await this.tgRetryOnce('video', () => axios.post(
        url,
        { chat_id: channel, video, caption, parse_mode: 'HTML' },
        { timeout: 45_000 },
      ));
      this.assertTelegramDelivered(res, 'video');
      post.telegram_message_id = res.data?.result?.message_id;
    } catch (err: any) {
      const desc: string = err?.response?.data?.description || '';
      if (err?.response?.status === 400 && /parse|entit|tag/i.test(desc)) {
        const res = await axios.post(
          url,
          { chat_id: channel, video, caption: caption.replace(/<[^>]+>/g, '') },
          { timeout: 45_000 },
        );
        this.assertTelegramDelivered(res, 'video');
        post.telegram_message_id = res.data?.result?.message_id;
        return;
      }
      throw err;
    }
  }

  private async tgRetryOnce<T>(what: string, send: () => Promise<T>): Promise<T> {
    try {
      return await send();
    } catch (err: any) {
      if (!isTelegramConnectionError(err)) throw err;
      this.logger.warn(`telegram ${what} · ${err.code} — connection never reached Telegram, retrying once`);
      await new Promise((r) => setTimeout(r, 1500));
      return send();
    }
  }

  private assertTelegramDelivered(res: any, what: string): void {
    const data = res?.data;
    const result = data?.result;
    const ok = data?.ok === true
      && (Array.isArray(result) ? result.length > 0 && result[0]?.message_id : !!result?.message_id);
    if (!ok) {
      throw new Error(`טלגרם לא אישרה את השליחה (${what}): ${data?.description || 'no message_id'}`);
    }
  }

  private async sendTelegramText(token: string, channel: string, text: string) {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    try {
      const res = await this.tgRetryOnce('text', () => axios.post(url, {
        chat_id: channel, text, parse_mode: 'HTML', disable_web_page_preview: true,
      }, { timeout: 15000 }));
      this.assertTelegramDelivered(res, 'text');
    } catch (err: any) {
      const desc: string = err?.response?.data?.description || '';
      if (err?.response?.status === 400 && /parse|entit|tag/i.test(desc)) {
        const res = await axios.post(url, {
          chat_id: channel, text: text.replace(/<[^>]+>/g, ''), disable_web_page_preview: true,
        }, { timeout: 15000 });
        this.assertTelegramDelivered(res, 'text');
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
      // Telegram fetches EVERY image in the album from the supplier's CDN before answering,
      // so this path is the most exposed of the three to a slow CDN — up to ten fetches on
      // a budget that was shorter than the single-photo one needs.
      const res = await this.tgRetryOnce('album', () => axios.post(url, { chat_id: channel, media: build(true) }, { timeout: 60_000 }));
      this.assertTelegramDelivered(res, 'album');
      post.telegram_message_id = res.data?.result?.[0]?.message_id;
    } catch (err: any) {
      const desc: string = err?.response?.data?.description || '';
      // HTML parse error → retry with plain-text caption.
      if (err?.response?.status === 400 && /parse|entit|tag/i.test(desc)) {
        const plainCaption = caption.replace(/<[^>]+>/g, '');
        const media = images.map((img, i) => ({ type: 'photo', media: img, ...(i === 0 ? { caption: plainCaption } : {}) }));
        const res = await axios.post(url, { chat_id: channel, media }, { timeout: 60_000 });
        this.assertTelegramDelivered(res, 'album');
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
      // 120s: a 10-photo album is uploaded as raw multipart bytes from a small instance —
      // 40s regularly expired mid-upload while Telegram went on to PUBLISH the album anyway,
      // producing a false "failed" (and a duplicate when the user resent). Uploads are slow,
      // not stuck — give them room.
      return axios.post(url, form, { headers: form.getHeaders(), timeout: 120_000, maxBodyLength: Infinity, maxContentLength: Infinity });
    };
    try {
      const res = await this.tgRetryOnce('album-upload', () => send(true));
      this.assertTelegramDelivered(res, 'album-upload');
      post.telegram_message_id = res.data?.result?.[0]?.message_id;
    } catch (err: any) {
      const desc: string = err?.response?.data?.description || '';
      if (err?.response?.status === 400 && /parse|entit|tag/i.test(desc)) {
        const res = await send(false);
        this.assertTelegramDelivered(res, 'album-upload');
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
      // 90s — same slow-upload reality as the album path (see sendMediaGroupUpload).
      return axios.post(url, form, { headers: form.getHeaders(), timeout: 90_000, maxBodyLength: Infinity, maxContentLength: Infinity });
    };
    try {
      const res = await this.tgRetryOnce('photo-upload', () => send(true));
      this.assertTelegramDelivered(res, 'photo-upload');
      post.telegram_message_id = res.data?.result?.message_id;
    } catch (err: any) {
      const desc: string = err?.response?.data?.description || '';
      if (err?.response?.status === 400 && /parse|entit|tag/i.test(desc)) {
        const res = await send(false);
        this.assertTelegramDelivered(res, 'photo-upload');
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
  private async resolveFacebookPageId(userId: string, channelOverride: string | undefined, creds: DecryptedCredentials, defaultGroupId?: string | null): Promise<string> {
    if (channelOverride) {
      const pid = await this.channels.getFacebookPageId(userId, channelOverride);
      if (pid) return pid;
      // No page of its own: the account default page belongs to the default-channel
      // group's audience — only that group may fall back to it. Any other group returns
      // '' (= skip Facebook) rather than leaking its post onto another brand's page.
      if (defaultGroupId !== undefined && channelOverride !== defaultGroupId) return '';
    }
    return creds?.facebook_page_id || '';
  }

  /**
   * The Page Access Token to publish with: the target group's OWN token when it has one
   * (a Page token is page-specific), otherwise the account's global token. This is what lets
   * two groups on DIFFERENT Facebook pages each publish with their own token.
   *
   * It returns WHICH of the two it picked alongside the token, because a token error has to
   * name the screen that actually holds the failing value — and this method is the only place
   * that knows. Callers used to receive the string alone and then tell the owner to go fix
   * "הגדרות ← אינטגרציות" even when the group's own token was the one Facebook rejected.
   */
  private async resolveFacebookPageToken(
    userId: string, channelOverride: string | undefined, creds: DecryptedCredentials,
  ): Promise<{ token: string; source: TokenSource }> {
    if (channelOverride) {
      const tok = await this.channels.getFacebookPageToken(userId, channelOverride);
      if (tok) return { token: tok, source: 'channel' };
    }
    return { token: creds?.facebook_page_token || '', source: 'account' };
  }

  /** Publishes the post to a specific Facebook Page feed with the given token. Throws on failure. */
  private async sendToFacebook(post: Post, creds: DecryptedCredentials, message: string, pageId: string, token: string) {
    if (!pageId || !token) throw new Error('Missing Facebook credentials');

    // Facebook does not render Telegram-style HTML tags — strip them for the FB body.
    // The short link is stamped ?s=fb so its clicks report as Facebook's.
    const plain = tagShortLinks(message, 'fb').replace(/<\/?[^>]+>/g, '');
    // The tracked /r/<code> URL. It already sits inside `plain` (buildPostBody puts it
    // there), so a photo post carries it in the caption and clicks are still counted.
    const link = tagShortLinks((await this.trackedLink(post)) || '', 'fb');
    // The designed frame (enhancement/collage) when this publish prepared one — the same
    // image Telegram uploads — else the original gallery/product image.
    const image = this.enhancedFrameUrl(post) || this.facebookImage(post);

    // PHOTO post when we have the product image, LINK post only as a fallback.
    //
    // A link post has no image of its own: Facebook scrapes the destination and shows
    // whatever og:image it finds there. For an AliExpress product page that is routinely
    // not the product — one of these went out over a picture of a Chinese business licence
    // — and Graph has not allowed overriding it since v2.x. So the group got a random
    // certificate where Telegram, which uploads the photo directly, showed the product.
    //
    // Posting the photo puts the same image on both channels and makes the product the ad.
    // The trade is the preview card, which was the wrong picture anyway; the link stays in
    // the caption, clickable and tracked.
    const endpoint = image ? 'photos' : 'feed';
    const params = new URLSearchParams(
      image
        ? { url: image, caption: plain, access_token: token }
        : { message: plain, link, access_token: token },
    );

    const attempt = () => axios.post(
      `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/${endpoint}`,
      params.toString(),
      // 20s, not the 8s this used to be. Graph fetches the attached URL — the link to build
      // a preview card, or the image to ingest it — BEFORE it answers, and an AliExpress
      // round trip regularly pushes that past 8s. Timing out here is the worst outcome
      // available: Facebook may have published anyway, so the post is marked failed while
      // it exists on the page, and the retry duplicates it. Better to wait.
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000 },
    );
    let res;
    try {
      res = await attempt();
    } catch (err: any) {
      // Two failure families earn ONE paused retry, because in both nothing was published:
      // Graph's explicit transient rejections (#1 "retry your request" / #2 service
      // unavailable), and connection-level failures where the request never reached Meta
      // at all. Timeouts stay non-retryable (see comment above: Facebook may have
      // published before the reply was lost).
      if (!isTransientFacebookError(err) && !isMetaConnectionError(err)) throw err;
      this.logger.warn(`facebook ${endpoint} → page ${pageId}: transient failure, retrying once`);
      await new Promise((r) => setTimeout(r, 2500));
      res = await attempt();
    }
    // Graph can answer 200 with an error BODY. Re-throwing `new Error(error.message)` here
    // dropped the code, and with it every mapping in facebook-errors: a #190 arrived as raw
    // English marked "no user action needed", and a transient #1/#2 got no retry. That is
    // watchdog #68 exactly — fixed then for the Instagram path, while this copy kept the bug.
    if (res.data?.error) throw metaGraphError(res.data.error);
    // A 200 without an id means nothing was actually published — treat it as a failure
    // instead of marking the post 'sent' (Telegram validates delivery; FB didn't).
    // /photos answers with the PHOTO id plus `post_id`, the story on the page; prefer that,
    // since it is what identifies the post everywhere else in Graph.
    const publishedId = res.data?.post_id || res.data?.id;
    if (!publishedId) throw new Error('Facebook did not return a post id (nothing published)');
    post.facebook_post_id = String(publishedId);
  }

  /**
   * The image a Facebook post should carry: the first gallery picture the owner chose,
   * falling back to the product's main photo. Same source Telegram publishes from, so the
   * two channels show the same thing.
   *
   * Returns null when there is nothing usable — the caller then falls back to a link post
   * rather than failing, because a post with the wrong picture still beats no post at all.
   */
  private facebookImage(post: Post): string | null {
    let gallery: string[] = [];
    try { gallery = post.gallery_json ? JSON.parse(post.gallery_json) : []; } catch { gallery = []; }
    const candidate = gallery.find((u) => typeof u === 'string' && /^https?:\/\//i.test(u))
      || (/^https?:\/\//i.test(post.product_image || '') ? post.product_image : null);
    return candidate || null;
  }

  /**
   * Publishes the post to Instagram via the Content Publishing API (two-step:
   * create a media container from the product image + caption, then publish it).
   * Reuses the linked Facebook Page token (needs instagram_content_publish).
   * Instagram requires an image — text-only posts aren't supported — so we use the
   * product's main photo. The image URL must be publicly reachable (AliExpress URLs
   * and our Yupoo image proxy both are).
   */
  /**
   * Instagram feed captions render URLs as DEAD, non-tappable text — and a bare link can
   * suppress reach — so pasting the affiliate/Telegram links there is pure downside. For IG
   * we drop every line carrying a URL and end with a "link in bio" call-to-action; the bio
   * should point at the user's ClickLead landing page (which aggregates the product links).
   */
  private instagramCaption(message: string, post: Post): string {
    const noHtml = message.replace(/<\/?[^>]+>/g, '');
    // A line is a "link line" if it contains any URL/short-link/Telegram-join form.
    const urlLine = /(https?:\/\/|www\.|t\.me\/|s\.click\.|aliexpress\.|bit\.ly\/)/i;
    let kept = noHtml
      .split('\n')
      .filter((line) => !urlLine.test(line))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!kept) kept = (post.product_title || '').trim();
    return `${kept}\n\n🛍️ לרכישה — הלינק בביו 🔗`.trim();
  }

  /**
   * Publish to the Instagram Business account for this post's group, falling back to the
   * account's global one. An Instagram account is reached through the Facebook Page it is
   * linked to, so a group that brings its own Instagram must bring that page's token too —
   * the global token cannot publish to a different brand's account, and silently trying it
   * produces an opaque Graph error instead of a fixable one.
   */
  private async sendToInstagram(
    post: Post, creds: DecryptedCredentials, message: string,
    userId?: string, channelOverride?: string,
  ) {
    // Instagram captions don't hyperlink URLs, but the text still shows the address a
    // follower may copy/type — tag it so such clicks report as Instagram's.
    message = tagShortLinks(message, 'ig');
    let igId = creds?.instagram_business_id;
    let token = creds?.facebook_page_token;

    if (userId && channelOverride) {
      const ownIg = await this.channels.getInstagramBusinessId(userId, channelOverride).catch(() => null);
      if (ownIg) {
        const ownToken = await this.channels.getFacebookPageToken(userId, channelOverride).catch(() => null);
        if (!ownToken) {
          throw new Error(
            'לקבוצה הזו הוגדר חשבון אינסטגרם משלה אך לא הוגדר טוקן לדף הפייסבוק שלה — '
            + 'הוסף Page Access Token של אותו דף בהגדרות הקבוצה',
          );
        }
        igId = ownIg;
        token = ownToken;
      }
    }

    if (!igId || !token) throw new Error('Missing Instagram credentials');

    // The supplier's own photo, straight off its CDN. Kept aside as the fallback for #9004
    // below: every other candidate we hand Instagram is a URL WE serve (a designed frame,
    // a letterboxed variant), and #9004 means the fetch did not yield an image at all.
    let cdnImage = post.product_image || '';
    try {
      const g = post.gallery_json ? JSON.parse(post.gallery_json) : [];
      if (Array.isArray(g) && g[0]) cdnImage = g[0];
    } catch { /* ignore */ }
    // AliExpress CDN often serves ".jpg_.webp" variants; Instagram can't ingest WebP and
    // fails the container. Cut back to the underlying JPEG/PNG URL when one is embedded.
    if (/\.webp(\?|$)/i.test(cdnImage)) {
      const m = cdnImage.match(/^(.*?\.(?:jpe?g|png))/i);
      if (m) cdnImage = m[1];
    }

    // The designed frame (enhancement/collage) when this publish prepared one — the same
    // image Telegram uploads — letterboxed server-side onto an Instagram-legal canvas via
    // ?fit=ig. Otherwise the supplier photo above.
    let image = this.enhancedFrameUrl(post, { fitIg: true }) || '';
    if (!image) {
      image = cdnImage;
      if (!image) throw new Error('אין תמונת מוצר לפרסום באינסטגרם');

      // Aspect-ratio gate: Instagram rejects anything outside 4:5–1.91:1 with #36003 —
      // supplier fashion shots are routinely taller. When the ratio is illegal, hand
      // Instagram our ig-image URL instead, which serves the photo letterboxed onto the
      // nearest legal canvas. Best-effort: any failure here publishes the original.
      image = this.instagramFitImage(image);
    }

    const caption = this.instagramCaption(message, post);
    const base = `https://graph.facebook.com/${GRAPH_VERSION}/${igId}`;

    // 1) Create the media container. A connection-level failure (request never reached
    // Meta — the "Instagram: שגיאה לא ידועה" partial publish) gets one paused retry:
    // no container was created, so a resend cannot duplicate anything.
    //
    // 45s, not 15s: Meta FETCHES image_url before it answers, and that URL is usually our
    // own /posts/ig-image route, which itself pulls from the supplier CDN (12s budget) and
    // re-encodes. A slow CDN alone could push the round trip past 15 seconds — which is how
    // a perfectly healthy post ended up filed as "published partially".
    const createContainer = () => axios.post(
      `${base}/media`,
      new URLSearchParams({ image_url: image, caption, access_token: token }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 45_000 },
    );
    let create;
    try {
      create = await createContainer();
    } catch (err: any) {
      if (isMetaConnectionError(err)) {
        this.logger.warn('instagram container create: connection never reached Meta, retrying once');
        await new Promise((r) => setTimeout(r, 2500));
        create = await createContainer();
      } else if (isMetaTimeoutError(err)) {
        // A timeout HERE is not the ambiguous kind. Creating a container publishes nothing
        // — it stages an upload, and the media goes live only on media_publish — so a
        // resend cannot duplicate a post. Worst case Meta did create the container and only
        // the reply was lost, which leaks one unused container that Instagram expires by
        // itself within a day.
        //
        // Until now this fell through to `throw err`, and the generic timeout text told the
        // owner "ייתכן שהפרסום כן בוצע — בדוק בחשבון": it sent him to look for a post that
        // could not exist, on the one step where the answer is knowable.
        this.logger.warn('instagram container create timed out — this step publishes nothing, retrying once');
        await new Promise((r) => setTimeout(r, 2500));
        try {
          create = await createContainer();
        } catch (again: any) {
          if (isMetaTimeoutError(again)) {
            throw new Error('אינסטגרם לא השיבה בזמן בעת העלאת התמונה — הפוסט לא פורסם. לחץ "נסה שוב".');
          }
          throw again;
        }
      } else if (err?.response?.data?.error?.code === 9004) {
        // "Only photo or video can be accepted as media type" — Meta fetched the URL and
        // what came back was not an image. The URL it fetched was OURS (a designed frame,
        // or the letterboxed variant), so the frame is the suspect, not the product: an
        // expired in-memory frame answers with a redirect, and a restart between the send
        // and Meta's fetch loses it entirely. Fall back to the supplier's own CDN photo —
        // the publish loses its designed frame, which is the cheaper of the two losses.
        if (cdnImage && image !== cdnImage) {
          this.logger.warn(`instagram #9004 on ${image} — retrying with the supplier photo ${cdnImage}`);
          const designed = image;
          image = cdnImage;
          try {
            create = await createContainer();
          } catch (again: any) {
            if (again?.response?.data?.error?.code !== 9004) throw again;
            // BOTH urls came back as not-an-image, so the frame was never the suspect and
            // the supplier photo is gone too. Name them, for the reason #36003 below already
            // learned: without the url this is a guessing game over which image path failed.
            throw new Error(igMediaRejectedMessage(cdnImage, designed));
          }
        } else {
          // Nothing to fall back TO — Instagram already had the supplier's own photo.
          throw new Error(igMediaRejectedMessage(image));
        }
      } else if (isTransientFacebookError(err)) {
        // Graph's #1/#2 family — it ANSWERED, said "please retry your request later", and
        // created nothing. Safe to send again, and the container step is where a retry costs
        // the least. Without this, Meta having a bad second filed a healthy post as
        // "published partially" and left the owner an English sentence to decipher.
        this.logger.warn(`instagram container create hit a transient Meta error, retrying once: ${err?.response?.data?.error?.message}`);
        await new Promise((r) => setTimeout(r, 4000));
        create = await createContainer();
      } else if (err?.response?.data?.error?.code === 36003) {
        // The letterbox pipeline exists precisely to prevent #36003 — reaching here means
        // some URL slipped past it. Name the URL Instagram actually measured, so the next
        // occurrence is self-diagnosing instead of a guessing game over which image path
        // failed open.
        throw new Error(`(#36003) יחס התמונה לא נתמך. התמונה שאינסטגרם מדדה: ${image}`);
      } else {
        throw err;
      }
    }
    if (create.data?.error) throw metaGraphError(create.data.error);
    const creationId = create.data?.id;
    if (!creationId) throw new Error('Instagram container creation failed');

    // 2) Instagram processes the container ASYNCHRONOUSLY — publishing straight away fails
    // with "Media ID is not available". Poll the container's status_code until FINISHED
    // (ERROR = the image itself was rejected; timeout → still try to publish below).
    for (let i = 0; i < 10; i++) {
      // A network blip DURING the poll must not kill a publish whose container already
      // exists — treat it as "still processing" and let the bounded loop try again.
      // An uncaught ETIMEDOUT here failed the whole send (partial-publish alert) even
      // though the container was fine and the next poll would have answered.
      let code: string | undefined;
      try {
        const st = await axios.get(
          `https://graph.facebook.com/${GRAPH_VERSION}/${creationId}`,
          { params: { fields: 'status_code', access_token: token }, timeout: 8000, validateStatus: () => true },
        );
        code = st.data?.status_code;
      } catch (err: any) {
        this.logger.warn(`instagram status poll network error (treating as pending): ${err?.message}`);
      }
      if (code === 'FINISHED') break;
      if (code === 'ERROR') {
        throw new Error('אינסטגרם דחה את התמונה בעת העיבוד — ודא שהיא JPEG נגיש (לא WebP) וביחס גובה-רוחב נתמך');
      }
      await new Promise((r) => setTimeout(r, 2500));
    }

    // 3) Publish the container. A container can report FINISHED and still need a moment —
    // retry the known not-ready error a few times before giving up.
    let lastErr = '';
    let lastGraphErr: any = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      let publish;
      try {
        publish = await axios.post(
          `${base}/media_publish`,
          new URLSearchParams({ creation_id: creationId, access_token: token }).toString(),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000, validateStatus: () => true },
        );
      } catch (err: any) {
        // Connect-phase failure = the request never reached Meta, so retrying cannot
        // double-publish. A RESPONSE-phase timeout still aborts (the publish may have
        // landed) — same distinction as the container-create step.
        if (isMetaConnectionError(err)) {
          this.logger.warn('instagram publish: connection never reached Meta, retrying');
          lastErr = 'החיבור לשרתי מטא נכשל ברמת הרשת בעת הפרסום';
          await new Promise((r) => setTimeout(r, 2500));
          continue;
        }
        // A TIMEOUT here is the one ambiguous failure in the send path: the publish may
        // have landed and only the reply was lost. Rather than guess — and leave a
        // "published partially" alert nothing can clear — ASK the container. Its
        // status_code turns PUBLISHED the moment the media goes live, so the answer is
        // authoritative in both directions (see ig-container-status.ts).
        const verdict = publishTimeoutVerdict(await this.igContainerStatus(creationId, token));
        if (verdict === 'published') {
          this.logger.log(`instagram publish timed out but the container reports PUBLISHED (${creationId}) — the post is live`);
          post.instagram_post_id = await this.igLatestMediaId(igId, token) || '';
          return;
        }
        if (verdict === 'retry') {
          this.logger.warn('instagram publish timed out; container not published — publishing again');
          lastErr = 'אינסטגרם לא השיבה בזמן בעת הפרסום';
          await new Promise((r) => setTimeout(r, 2500));
          continue;
        }
        throw err;
      }
      if (!publish.data?.error && publish.data?.id) {
        post.instagram_post_id = publish.data.id;
        return;
      }
      // This call runs with validateStatus:()=>true, so a Graph failure arrives as a BODY,
      // never as a thrown axios error. Keep the payload: re-throwing only its `message`
      // strips the code, and with it every mapping in facebook-errors — which is how a
      // transient #2 reached the owner as raw English with no guidance.
      lastGraphErr = publish.data?.error ?? null;
      lastErr = lastGraphErr?.message || 'Instagram publish failed';
      // The container can report FINISHED and still need a moment.
      if (/Media ID is not available/i.test(lastErr)) {
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }
      // Graph's #1/#2 family: Meta answered with an error, so NOTHING was published and a
      // retry cannot duplicate the post. Its own message asks for exactly this ("please
      // retry your request later") — obeying it is the difference between a post that goes
      // out a few seconds late and a post filed as "published partially".
      if (isTransientFacebookError({ error: lastGraphErr })) {
        this.logger.warn(`instagram publish hit a transient Meta error, retrying: ${lastErr}`);
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }
      break; // a different error won't heal with retries
    }
    throw lastGraphErr ? metaGraphError(lastGraphErr) : new Error(lastErr);
  }

  /** A media container's status_code, or undefined when the check itself fails — the
   *  caller treats "no answer" as unknown rather than as an outcome. */
  private async igContainerStatus(creationId: string, token: string): Promise<string | undefined> {
    try {
      const res = await axios.get(
        `https://graph.facebook.com/${GRAPH_VERSION}/${creationId}`,
        { params: { fields: 'status_code', access_token: token }, timeout: 8000, validateStatus: () => true },
      );
      return res.data?.status_code;
    } catch (err: any) {
      this.logger.warn(`instagram container status check failed: ${err?.message}`);
      return undefined;
    }
  }

  /** The account's newest media id — used only to label a post whose publish reply was
   *  lost. Best-effort: an empty answer costs a reference, never the post. */
  private async igLatestMediaId(igId: string, token: string): Promise<string> {
    try {
      const res = await axios.get(
        `https://graph.facebook.com/${GRAPH_VERSION}/${igId}/media`,
        { params: { fields: 'id', limit: 1, access_token: token }, timeout: 8000, validateStatus: () => true },
      );
      return String(res.data?.data?.[0]?.id || '');
    } catch {
      return '';
    }
  }

  /**
   * The image URL Instagram should ingest: our /posts/ig-image letterbox route for every
   * eligible (allowlisted-host) image — the endpoint itself streams a legal image
   * byte-identical and pads an illegal one. A non-allowlisted host or a missing
   * BACKEND_URL returns the original untouched.
   */
  private instagramFitImage(imageUrl: string): string {
    // ALWAYS route an eligible image through our ig-image endpoint instead of measuring
    // the ratio here first. The old measure-then-decide version failed OPEN: when the
    // pre-fetch couldn't run (network blip, Yupoo hiccup) it handed Instagram the
    // ORIGINAL, and a too-tall product shot then died with #36003 — the exact rejection
    // the letterbox exists to prevent. The endpoint itself is the ratio decision: a legal
    // image streams through byte-identical, an illegal one is padded — so the only thing
    // this method needs to decide is eligibility (allowlisted host + a public base URL).
    try {
      const target = unwrapOwnProxy(imageUrl);
      const host = new URL(target).hostname;
      if (!isIgFittableHost(host) && !isOwnUploadedUrl(target)) return imageUrl;
      const base = (process.env.BACKEND_URL || '').replace(/\/$/, '');
      if (!base) return imageUrl;
      return `${base}/posts/ig-image?src=${encodeURIComponent(target)}`;
    } catch {
      return imageUrl;
    }
  }

  /**
   * Publishes the post as a Pinterest Pin (API v5). Unlike Instagram, a Pin carries a real
   * CLICKABLE destination link — we set it to the affiliate URL, so the Pin drives straight
   * to the product. Needs a Pinterest access token (scopes: boards:read, pins:read,
   * pins:write) and a target board id, both from Settings ← Integrations. Requires an image.
   */
  private async sendToPinterest(post: Post, creds: DecryptedCredentials, message: string, opts?: { titleFromMessage?: boolean; priceLabel?: string }) {
    // PINTEREST_API_BASE exists for ONE purpose: Pinterest's Standard-access review
    // requires the demo video to show a pin actually created, and a Trial app can only
    // do that against the sandbox host. The sandbox does NOT accept the production OAuth
    // token — it 401s ("Authentication failed") — so sandbox runs use their own token,
    // generated in the developer portal (Configure → Generate Access Token → Sandbox)
    // and passed as PINTEREST_SANDBOX_TOKEN. Both vars are set for the recording and
    // removed after; unset = production with the OAuth token, always.
    const apiBase = (process.env.PINTEREST_API_BASE || 'https://api.pinterest.com').replace(/\/$/, '');
    const sandbox = /sandbox/i.test(apiBase);

    // Ask PinterestService for the token rather than reading the stored one: it refreshes
    // when due, and it refuses up front when the grant is known to lack pins:write — the
    // failure that killed the first pin, reported there as a raw API sentence. A sandbox
    // run skips both: its portal token carries every open scope, and the tier gate is
    // exactly what the sandbox exists to sidestep.
    let token: string | null;
    let boardId = creds?.pinterest_board_id;
    if (sandbox) {
      token = process.env.PINTEREST_SANDBOX_TOKEN?.trim() || null;
      if (!token) {
        throw new Error(
          'מצב סנדבוקס פעיל (PINTEREST_API_BASE) אבל PINTEREST_SANDBOX_TOKEN חסר — '
          + 'צור טוקן בפורטל (Configure ← Generate Access Token ← Sandbox) והוסף אותו ב-Render.',
        );
      }
      // The sandbox is a SEPARATE universe: the production board id does not exist there,
      // so pinning to it would 404 even with a valid sandbox token. Use the sandbox's own
      // first board, creating one when the environment is empty — this makes the demo
      // recording a pure two-env-vars affair with nothing else to prepare.
      boardId = await this.sandboxBoardId(apiBase, token);
    } else {
      const live = await this.pinterest.publishToken(post.user_id);
      if (live.blockedReason) throw new Error(live.blockedReason);
      token = live.token;
    }
    if (!token || !boardId) throw new Error('Missing Pinterest credentials');

    // First gallery image, else the main product image.
    let image = post.product_image || '';
    try {
      const g = post.gallery_json ? JSON.parse(post.gallery_json) : [];
      if (Array.isArray(g) && g[0]) image = g[0];
    } catch { /* ignore */ }
    if (!image) throw new Error('אין תמונת מוצר לפרסום בפינטרסט');

    const plain = message.replace(/<\/?[^>]+>/g, '').trim(); // Pinterest shows no HTML
    // Pinterest caps: title ≤100 chars, description ≤500. The affiliate link rides the
    // dedicated `link` field (clickable), so URL lines in the text are dead clutter —
    // drop them the same way the Instagram caption does.
    const urlLine = /(https?:\/\/|www\.|t\.me\/|s\.click\.|aliexpress\.|bit\.ly\/)/i;
    const noLinks = plain
      .split('\n')
      .filter((line) => !urlLine.test(line))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    let title = (post.product_title || noLinks.split('\n')[0] || 'מוצר').slice(0, 100);
    let description = (noLinks || plain).slice(0, 500);
    // A dedicated-Pinterest campaign generates its own SEO title as the FIRST LINE of
    // the text — the raw AliExpress title is keyword-stuffed spam ("2024 New Hot
    // Sale..."), exactly what Pinterest's ranking dislikes. Use the generated title
    // and keep the remainder as the description.
    if (opts?.titleFromMessage) {
      const lines = noLinks.split('\n').map((l) => l.trim());
      const first = lines[0] || '';
      const rest = lines.slice(1).join('\n').trim();
      if (first && first.length <= 100 && rest) {
        title = first;
        description = rest.slice(0, 500);
      }
    }

    // The DESIGNED pin: letterbox the product photo onto a 2:3 canvas with a title band
    // and price tag (pin-frame.ts explains why this matters in Pinterest's feed).
    // PRE-COMPOSED and served from memory: Pinterest validates the image URL at create
    // time with an impatient fetcher, and pointing it at the on-the-fly compose endpoint
    // timed out and failed the create with "Sorry! Something went wrong on our end." —
    // the raw-image fallback below saved those pins, unframed. Any failure here keeps the
    // raw photo, so the frame can never cost a pin.
    const rawImage = image;
    try {
      const frameBase = (process.env.BACKEND_URL || '').replace(/\/$/, '');
      const frameTarget = unwrapOwnProxy(image);
      const frameHost = new URL(frameTarget).hostname;
      if (!frameBase) {
        this.logger.warn(`pin ${post.id} publishing RAW: BACKEND_URL is unset, no public URL to serve a frame from`);
      } else if (!isIgFittableHost(frameHost) && !isOwnUploadedUrl(frameTarget)) {
        // Silent before: a product photo on a host outside the allowlist skipped the
        // frame with no trace, and the owner saw an unexplained bare pin on the board.
        this.logger.warn(`pin ${post.id} publishing RAW: image host ${frameHost} is not frame-eligible`);
      } else {
        const upstream = await axios.get(frameTarget, {
          responseType: 'arraybuffer', maxRedirects: 0, headers: igFetchHeaders(frameHost),
          timeout: 12000, maxContentLength: 8 * 1024 * 1024, validateStatus: () => true,
        });
        if (upstream.status !== 200) {
          this.logger.warn(`pin ${post.id} publishing RAW: fetching the product photo returned ${upstream.status}`);
        } else {
          // A rewritten pin carries its own (USD) label — the stored post's currency is
          // the Telegram one and would put ₪ on an English board.
          const priceLabel = opts?.priceLabel ?? await this.pinPriceLabel(post, creds);
          const framed = await composePinFrame(Buffer.from(upstream.data), title, priceLabel);
          // PERSIST the frame, don't just park it in memory. Pinterest fetches this URL
          // seconds after the create call — but a deploy landing in those seconds wiped
          // the in-memory map, the endpoint 302'd to the original photo, and Pinterest
          // stored the RAW image forever (two bare pins on the board after a night of
          // deploys). A DB-backed /posts/uploaded/<uuid> URL survives restarts, so the
          // frame is there whenever their fetcher arrives. Memory stays as the fallback
          // when the row can't be written.
          this.registerPinFrame(post.id, framed);
          const stored = await this.saveUploadedImage(post.user_id, framed).catch((err: any) => {
            this.logger.warn(`pin frame not persisted for ${post.id}, using the in-memory URL: ${err?.message}`);
            return null;
          });
          image = stored?.url || `${frameBase}/posts/pin-frame/${post.id}`;
        }
      }
    } catch (e: any) {
      this.logger.warn(`pin frame pre-compose failed for ${post.id} (publishing raw): ${e?.message}`);
      image = rawImage;
    }

    // WHERE THE PIN POINTS decides whether Pinterest indexes it at all.
    //
    // The affiliate redirect was the destination until now, and it is the weakest one
    // available: a domain we neither own nor can claim, with no page behind it to read, and
    // the commonest affiliate-spam shape on the platform. Measured: 50 pins, 23 impressions
    // in 30 days, and not one findable in search by its own exact title — created, public,
    // never indexed.
    //
    // The storefront product page is our claimed host, has real content, and its buy button
    // already routes through the tracked short link, so a sale that starts on Pinterest is
    // finally attributable. The affiliate URL stays the fallback for an account with no live
    // store, or a post that page would never render (see postProductUrl).
    const destination = (this.storefront
      ? await this.storefront.postProductUrl(post.user_id, post).catch(() => null)
      : null) || post.affiliate_url || undefined;
    if (destination && destination !== post.affiliate_url) {
      this.logger.log(`pin ${post.id} → storefront product page (claimed domain)`);
    }
    // Pinterest reads alt text to understand what the image SHOWS — it is part of how a pin
    // is classified, not only an accessibility courtesy, and we were sending none.
    const altText = (post.product_title || title).replace(/\s+/g, ' ').trim().slice(0, 500);
    const createPin = (img: string) => axios.post(
      `${apiBase}/v5/pins`,
      {
        board_id: boardId,
        title,
        description,
        link: destination,
        ...(altText ? { alt_text: altText } : {}),
        media_source: { source_type: 'image_url', url: img },
      },
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 20000,
        validateStatus: () => true,
      },
    );
    // "Sorry! Something went wrong on our end." is Pinterest's own 5xx — seen in the wild
    // right after an access-tier upgrade, before the new tier propagates everywhere. Retry
    // once; if it STILL fails and the pin was framed, try once more with the raw product
    // image — that isolates our frame endpoint as a cause (Pinterest fetches the image
    // from us, and a fetch it dislikes reports as this same vague sentence). A pin that
    // succeeds raw loses the frame, not the post — and tells the logs exactly which half
    // was at fault.
    const theirEnd = (r: any) => r.status >= 500
      || /something went wrong/i.test(String(r.data?.message || ''));
    let res = await createPin(image);
    if (theirEnd(res)) {
      await new Promise((r) => setTimeout(r, 2500));
      res = await createPin(image);
    }
    if (theirEnd(res) && image !== rawImage) {
      this.logger.warn(`pinterest 5xx with framed image — retrying pin ${post.id} with the raw product image`);
      res = await createPin(rawImage);
      if (!theirEnd(res) && res.data?.id) {
        this.logger.warn(`pin ${post.id} succeeded RAW after failing framed — inspect /posts/pin-image`);
      }
    }
    // A permission refusal reaches the owner as a Pinterest sentence about scopes, which
    // reads like something to fix in our settings — it isn't. Replace it with the remedy,
    // and include what the grant actually holds: a refusal DESPITE a granted pins:write is
    // the access tier talking (Trial refuses production writes), and the message says so
    // instead of looping the owner through reconnect. Other failures keep their wording.
    if (res.status === 403 || /sufficient permissions|scopes/i.test(String(res.data?.message || ''))) {
      const granted = parseGrantedScopes(creds?.pinterest_scopes);
      throw new Error(granted.includes(PUBLISH_SCOPE)
        ? TIER_BLOCK_MESSAGE
        : describeMissingScopes([PUBLISH_SCOPE], granted));
    }
    if (res.status < 200 || res.status >= 300 || res.data?.error || !res.data?.id) {
      throw new Error(res.data?.message || res.data?.error?.message || `Pinterest publish failed (${res.status})`);
    }
    post.pinterest_post_id = res.data.id;
  }

  /**
   * Rewrite an existing post for Pinterest: English SEO pin copy priced in USD. Used by
   * an opted-in manual push — the copy a Telegram post carries (Hebrew, ₪) is wrong for
   * a US board, and the push path has no campaign to take language/currency from. The
   * post row is left untouched; only the pin gets this text.
   */
  private async pinterestRewrite(post: Post, creds: DecryptedCredentials): Promise<{ text: string; priceLabel: string }> {
    const usd = await this.postPriceUsd(post, creds);
    const product = {
      product_id: post.product_id,
      title: post.product_title,
      image_url: post.product_image,
      product_url: post.affiliate_url || '',
      affiliate_url: post.affiliate_url || '',
      // Already in the target currency → identity rate, no re-conversion downstream.
      sale_price: usd, original_price: usd, currency: 'USD',
      discount_percent: 0, orders_count: 0, rating: 0, category: '',
    };
    const text = await this.generateText(
      product, 'en', 1, creds, undefined, usd > 0 ? usd : undefined,
      undefined, undefined, false,
      { currencyPair: 'USD_USD', style: 'pinterest' },
    );
    return { text, priceLabel: usd > 0 ? `$${usd.toFixed(2)}` : '' };
  }

  /** A post's price in USD: the stored affiliate-API value when it has one, else the
   *  local price converted back at the account's live rate. 0 when unknown. */
  private async postPriceUsd(post: Post, creds: DecryptedCredentials): Promise<number> {
    const stored = Number(post.sale_price_usd);
    if (stored > 0) return +stored.toFixed(2);
    const local = Number(post.price_ils);
    if (!(local > 0)) return 0;
    const rate = await this.rates.getRate(creds?.currency_pair || 'USD_ILS').catch(() => 0);
    return rate > 0 ? +(local / rate).toFixed(2) : 0;
  }

  /**
   * The price sticker for a pin frame, in the post's OWN currency — the campaign's
   * override when it has one (a USD Pinterest campaign shows "$6.40"), else the account
   * default. Empty when the post has no usable price: a "$0.00" sticker reads as broken.
   */
  private async pinPriceLabel(post: Post, creds: DecryptedCredentials): Promise<string> {
    const amount = Number(post.price_ils);
    if (!(amount > 0)) return '';
    let pair = creds?.currency_pair || 'USD_ILS';
    if (post.campaign_id) {
      const campaign = await this.campaignRepo.findOne({ where: { id: post.campaign_id } }).catch(() => null);
      if (campaign?.currency_pair?.trim()) pair = campaign.currency_pair.trim();
    }
    return `${currencySymbol(pair)}${amount.toFixed(2)}`;
  }

  /**
   * The sandbox environment's own board to pin to — its first existing board, or a fresh
   * "Nexlify Demo" one when the environment is empty. Sandbox-only (see sendToPinterest);
   * a 401 here names the actual problem instead of the generic "Authentication failed".
   */
  private async sandboxBoardId(apiBase: string, token: string): Promise<string> {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const list = await axios.get(`${apiBase}/v5/boards`, {
      headers, params: { page_size: 1 }, timeout: 10_000, validateStatus: () => true,
    });
    if (list.status === 401 || list.status === 403) {
      throw new Error(
        `הסנדבוקס דחה את הטוקן (${list.status}) — ודא ש-PINTEREST_SANDBOX_TOKEN נוצר `
        + 'בפורטל עם סביבת "Sandbox" (לא Production) ושהוא הודבק במלואו.',
      );
    }
    const existing = list.data?.items?.[0]?.id;
    if (existing) return String(existing);
    // The sandbox supports only a subset of endpoints, and listing boards is not reliably
    // one of them — a board created a minute ago can be invisible to GET while POST still
    // knows its name is taken ("Try a different name!"). So every creation uses a unique
    // name; sandbox boards are throwaway and nobody ever sees them.
    const created = await axios.post(`${apiBase}/v5/boards`,
      { name: `Nexlify Demo ${Date.now().toString().slice(-6)}` },
      { headers, timeout: 10_000, validateStatus: () => true });
    if (!created.data?.id) {
      throw new Error(`יצירת לוח סנדבוקס נכשלה (${created.status}): ${created.data?.message || ''}`);
    }
    return String(created.data.id);
  }

  /** Normalize a WhatsApp target into a chatId. A value already carrying '@' is used as-is;
   *  a bare id is treated as a GROUP (…@g.us) — the intended publishing target. */
  /** When the previous WhatsApp message left this process, and the queue that serialises
   *  the pacing so two concurrent sends don't both decide "the line is free". */
  private waLastSentAt: number | null = null;
  private waChain: Promise<void> = Promise.resolve();

  /** Wait out this send's turn (jitter + minimum gap). Never throws — pacing must not be
   *  the reason a post fails to publish. */
  private paceWhatsApp(): Promise<void> {
    const turn = this.waChain.then(async () => {
      const delay = waDelayMs(this.waLastSentAt, Date.now(), Math.random());
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      this.waLastSentAt = Date.now();
    });
    this.waChain = turn.catch(() => { /* keep the line moving */ });
    return this.waChain;
  }

  private normalizeWaChatId(v: string): string {
    const s = (v || '').trim();
    if (!s) return '';
    if (s.includes('@')) return s;
    return `${s.replace(/\D/g, '')}@g.us`;
  }

  /**
   * Publishes the post to WhatsApp. The 'green' provider (Green API) CAN post to a GROUP
   * (chatId …@g.us) — unlike the official Cloud API, which only sends direct messages to a
   * number that messaged the business (and needs approved templates for the first contact).
   * Sends the product image + caption; falls back to a text message when there's no image.
   */
  private async sendToWhatsApp(post: Post, creds: DecryptedCredentials, message: string) {
    // Tagged ?s=wa, then translated into WhatsApp's own markup: bold/italic/strike survive,
    // and the "🔗 <url>" line becomes a bold CTA above a bare URL — the closest WhatsApp
    // gets to Telegram's anchor button (it has no hyperlink markup at all).
    const caption = toWhatsAppText(tagShortLinks(message, 'wa'));
    const provider = creds?.whatsapp_provider || 'green';

    // Behaviour, not content, is what gets a WhatsApp number restricted — see
    // whatsapp-pacing.ts. Hold the message a jittered moment so posts don't leave on the
    // scheduler's round minute, and never fire two within the minimum gap.
    await this.paceWhatsApp();

    let image = post.product_image || '';
    try {
      const g = post.gallery_json ? JSON.parse(post.gallery_json) : [];
      if (Array.isArray(g) && g[0]) image = g[0];
    } catch { /* ignore */ }

    if (provider === 'green') {
      const instance = creds?.green_api_instance_id;
      const token = creds?.green_api_token;
      const chat = this.normalizeWaChatId(creds?.whatsapp_group_id || '');
      if (!instance || !token || !chat) throw new Error('חסרים פרטי Green API (instance / token / מזהה קבוצה)');
      const base = (creds?.green_api_url || 'https://api.green-api.com').replace(/\/$/, '');

      // The product's own video when the account opted in — same fallback doctrine as
      // Telegram: a REJECTION (response received, nothing delivered) falls back to the
      // image; an ambiguous network death rethrows rather than risking a double-post.
      // A WhatsApp-only post never passes through the Telegram sender, so the clip is
      // resolved here too (no-op once either channel has already filled it in).
      await this.ensureProductVideo(post, creds);
      if (creds?.prefer_product_video && post.product_video) {
        try {
          const res = await axios.post(
            `${base}/waInstance${instance}/sendFileByUrl/${token}`,
            { chatId: chat, urlFile: post.product_video, fileName: 'product.mp4', caption },
            { timeout: 45_000 },
          );
          post.whatsapp_message_id = res.data?.idMessage || null;
          return;
        } catch (err: any) {
          if (!err?.response) throw err;
          this.logger.warn(`post ${post.id}: WhatsApp video rejected (${err?.response?.status}) — falling back to image`);
        }
      }

      if (image) {
        const res = await axios.post(
          `${base}/waInstance${instance}/sendFileByUrl/${token}`,
          { chatId: chat, urlFile: image, fileName: 'product.jpg', caption },
          { timeout: 20000 },
        );
        post.whatsapp_message_id = res.data?.idMessage || null;
      } else {
        const res = await axios.post(
          `${base}/waInstance${instance}/sendMessage/${token}`,
          { chatId: chat, message: caption },
          { timeout: 15000 },
        );
        post.whatsapp_message_id = res.data?.idMessage || null;
      }
      return;
    }

    // Official WhatsApp Cloud API — direct message to a recipient number (no group support).
    const phoneId = creds?.whatsapp_phone_number_id;
    const token = creds?.whatsapp_access_token;
    const to = (creds?.whatsapp_group_id || '').replace(/\D/g, '');
    if (!phoneId || !token || !to) throw new Error('חסרים פרטי WhatsApp Cloud API (Phone Number ID / Token / מספר יעד)');
    const res = await axios.post(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`,
      { messaging_product: 'whatsapp', to, type: 'text', text: { body: caption } },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 },
    );
    if (res.data?.error) throw new Error(res.data.error.message);
    post.whatsapp_message_id = res.data?.messages?.[0]?.id || null;
  }

  /**
   * Relays the post to a Make.com incoming webhook, which drives the user's own
   * scenario (and its authorized Facebook connection) to publish. This is the bridge
   * to their existing "Google Sheets → Facebook/Telegram" automation: instead of a
   * sheet row, Make receives a clean JSON payload per post. Sends both the plain and
   * HTML text plus every image URL, so the scenario can map whatever it needs.
   */
  private async sendToMakeWebhook(post: Post, creds: DecryptedCredentials, body: string, pageId: string) {
    // Make relays to Facebook — its links are Facebook clicks.
    body = tagShortLinks(body, 'fb');
    const url = creds?.make_webhook_url;
    if (!url) throw new Error('Missing Make webhook URL');
    // SSRF guard: the webhook URL is user-configured. Reject internal/private targets and
    // non-http(s) so it can't be pointed at cloud metadata / internal services (the payload
    // carries the post — a blind SSRF exfil vector otherwise).
    assertSafeOutboundUrl(url);

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
      // Tracked, for the same reason the Graph path is: this link becomes the album's
      // call-to-action, and an untracked one hides the whole channel from the optimizer.
      link: tagShortLinks((await this.trackedLink(post)) || '', 'fb'),
      price_ils: post.price_ils || 0,
      facebook_page_id: pageId,
      post_id: post.id,
    };

    const res = await axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000, maxRedirects: 0,
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
    sort?: string;
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
          'discount,product_main_image_url,product_detail_url,evaluate_rate,first_level_category_name,lastest_volume,' +
          'product_video_url,platform_product_type',
        page_size: params.limit || 10,
        page_no: params.page && params.page > 0 ? params.page : undefined,
        // Rotating sort widens the reachable catalog — a fixed sort keeps returning the
        // same best-sellers though the site has thousands more. Default stays best-sellers.
        sort: params.sort || 'LAST_VOLUME_DESC',
        tracking_id: creds.aliexpress_tracking_id,
      }, creds.aliexpress_app_secret);

      // Retry transient failures (network / 5xx / timeout): a single blip used to skip the
      // whole campaign cycle unattended. Up to 3 attempts with linear backoff.
      let res: any;
      for (let attempt = 1; ; attempt++) {
        try {
          res = await axios.get(ALI_API, { params: signed, timeout: 10000 });
          break;
        } catch (e: any) {
          const retriable = !e?.response || e.response.status >= 500 || e.code === 'ECONNABORTED';
          if (attempt >= 3 || !retriable) throw e;
          await new Promise((r) => setTimeout(r, attempt * 800));
        }
      }

      const items = res.data?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product || [];
      return items.map((p: any) => this.mapAliItem(p, targetCcy));
    } catch (err: any) {
      // Campaigns run unattended — inventing products here would publish fabricated
      // deals to the user's real audience. Fail the run instead; the scheduler logs it.
      this.logger.error(`searchProducts failed: ${err?.message}`);
      throw err;
    }
  }

  /** One raw affiliate-API product → the internal product shape (shared by query + detail). */
  private mapAliItem(p: any, targetCcy: string) {
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
      // The product's own promo video — published instead of the image on TG/WA when the
      // account opted in (prefer_product_video).
      video_url: p.product_video_url || undefined,
      // TMALL is the affiliate API's marker for official brand-store listings — the
      // "Brand+ / Certified Original" badge on the site.
      brand_plus: String(p.platform_product_type || '').toUpperCase() === 'TMALL',
    };
  }

  /**
   * The EXACT product by id via productdetail.get. A keyword search for a numeric id
   * (product.query) usually returns nothing — or unrelated items — which is why the
   * file import came back image-less; the detail endpoint is authoritative.
   */
  private async productDetailById(productId: string, creds: DecryptedCredentials): Promise<any | null> {
    if (!creds?.aliexpress_app_key) return null;
    const currencyPair = creds.currency_pair || 'USD_ILS';
    const targetCcy = currencyPair.split('_')[1] || 'ILS';
    const signed = signAliexpress({
      method: 'aliexpress.affiliate.productdetail.get',
      app_key: creds.aliexpress_app_key,
      product_ids: productId,
      // Local price for the destination country — without it the API returns a
      // default-country price that does NOT match what the user sees on the site.
      country: process.env.SHIP_TO_COUNTRY || ({ ILS: 'IL', GBP: 'GB' } as any)[targetCcy],
      fields: 'product_id,product_title,original_price,sale_price,sale_price_currency,' +
        'target_original_price,target_sale_price,target_sale_price_currency,promotion_link,' +
        'discount,product_main_image_url,product_detail_url,evaluate_rate,first_level_category_name,lastest_volume,' +
        'product_video_url,platform_product_type',
      target_currency: targetCcy,
      tracking_id: creds.aliexpress_tracking_id,
    }, creds.aliexpress_app_secret);
    // Bulk import fires many of these back-to-back; the API throttles with an HTTP-200
    // error_response ("App Call Limited") rather than a 5xx, so both shapes retry here.
    for (let attempt = 1; ; attempt++) {
      let res: any;
      try {
        res = await axios.get(ALI_API, { params: signed, timeout: 10000 });
      } catch (e: any) {
        if (attempt >= 3) throw e;
        await new Promise((r) => setTimeout(r, attempt * 900));
        continue;
      }
      const apiErr = res.data?.error_response;
      if (apiErr) {
        if (attempt < 3) { await new Promise((r) => setTimeout(r, attempt * 1200)); continue; }
        this.logger.warn(`productDetailById(${productId}): API error ${apiErr.code} ${apiErr.msg || ''}`);
        return null;
      }
      const items: any[] =
        res.data?.aliexpress_affiliate_productdetail_get_response?.resp_result?.result?.products?.product || [];
      const exact = items.find((p: any) => String(p.product_id) === String(productId)) || items[0];
      return exact ? this.mapAliItem(exact, targetCcy) : null;
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

  /**
   * The AI judge — last gate before a generated draft is accepted (see copy-judge.ts for
   * why it exists alongside the deterministic copyDefect patterns). Returns a defect tag
   * like copyDefect does, or null when the draft passes. FAIL-OPEN: any judge failure —
   * missing key, timeout, unparseable answer — passes the draft; the deterministic gate
   * already approved it, and a broken judge must never be why a post didn't go out.
   */
  private async copySanityVerdict(creds: DecryptedCredentials, candidate: string, style?: 'pinterest'): Promise<string | null> {
    try {
      const res = await this.ai.generate(creds, {
        // Pinterest pins have their own valid shape — without the style note the judge
        // rejected every pin draft as "not a marketing post" (issue #51).
        system: style === 'pinterest' ? COPY_JUDGE_SYSTEM + COPY_JUDGE_PINTEREST_NOTE : COPY_JUDGE_SYSTEM,
        // NEVER a raw slice: cutting mid-word made the judge see a text that really does
        // stop mid-sentence and answer BAD — our own trim, read back as the draft's defect.
        prompt: trimForJudge(candidate),
        // Room for "BAD <reason>" — the verdict alone left nothing to act on.
        maxTokens: 12,
        temperature: 0,
      });
      const { verdict, reason } = parseJudgeAnswer(res?.text);
      return verdict === 'bad' ? `שופט ה-AI פסל: ${reason}` : null;
    } catch {
      return null;
    }
  }

  /**
   * The product-relevance guard's model call — see product-relevance.ts for the fail-open
   * contract. Any failure (no key, timeout, malformed reply) returns all-accepted: the
   * guard exists to catch clear audience misfits, never to block publishing.
   */
  private async productFitVerdicts(
    creds: DecryptedCredentials,
    ctx: ProductFitContext,
    items: ProductFitItem[],
  ): Promise<ProductFitVerdict[]> {
    const accept = items.map(() => ({ fits: true, reason: '' }));
    if (!items.length) return accept;
    try {
      const res = await this.ai.generate(creds, {
        system: PRODUCT_FIT_SYSTEM,
        prompt: buildProductFitPrompt(ctx, items),
        maxTokens: 60 + items.length * 60,
        temperature: 0,
      });
      return res?.text ? parseProductFitVerdicts(res.text, items.length) : accept;
    } catch {
      return accept;
    }
  }

  private async generateText(product: any, language: string, rate: number, creds: DecryptedCredentials, template?: string, priceLocalOverride?: number, images?: GenerateImage[], hint?: string, forceVision = false, opts?: { currencyPair?: string; style?: 'pinterest'; seasonHint?: string | null; copyHint?: string | null; promo?: { discount?: number | null; endsLabel?: string | null } }): Promise<string> {
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
    // The caller may price this text in a different currency than the account default —
    // a per-campaign override (e.g. a USD Pinterest campaign) passes its pair in opts.
    const currencyPair = opts?.currencyPair || creds?.currency_pair || 'USD_ILS';
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
      : opts?.style === 'pinterest'
        ? this.pinterestSystemPrompt(language)
        : this.defaultSystemPrompt(language);

    // The owner's vocabulary rule, appended to EVERY brief — the default, the Pinterest
    // style and a custom template alike. A template is authoritative about structure and
    // tone, never about which words may reach the group. The deterministic filter in
    // buildPostBody guarantees the outcome; saying it here is what makes the sentence read
    // naturally instead of being patched after the fact (see word-policy.ts).
    systemPrompt += `\n\n${WORD_POLICY_BRIEF[language === 'he' ? 'he' : 'en']}`;

    // A product-type hint (from the user) is the AUTHORITATIVE ground truth — it fixes the
    // case where vision misreads an ambiguous first photo (e.g. flip-flops → "lighting").
    const h = hint?.trim();
    if (h) {
      systemPrompt += `\n\nסוג/שם המוצר (מקור אמת מוחלט): "${h}". כתוב/כתבי אך ורק על המוצר הזה. אם התמונות נראות כמו משהו אחר — התעלם/י והתבסס/י על סוג המוצר שצוין. אסור בשום אופן לכתוב על קטגוריה אחרת.`;
    }

    // Seasonal context (commercial calendar): a single line that lets the copy ride the
    // season when relevant. Applied for template posts too — it's context, not structure,
    // so it doesn't fight the template's fixed lines.
    // The copy ANGLE for this post — a nudge on how to open, chosen by the bandit from what
    // this group actually clicks. Never applied under a custom template: that template is
    // the owner's own wording, and an angle instruction would fight its fixed structure.
    if (opts?.copyHint && !hasTemplate) {
      systemPrompt += `\n\n${opts.copyHint}`;
    }

    if (opts?.seasonHint) {
      systemPrompt += `\n\n${opts.seasonHint}`;
    }

    // Limited-time PROMOTION context: turn the copy into a one-time, time-boxed deal with
    // real urgency and an explicit deadline. Layered as context (not structure) so it works
    // for template posts too. The deadline label is written literally so the reader sees
    // exactly when it ends (Telegram can't render a live countdown — the auto-removal cron
    // deletes the post when it expires).
    if (opts?.promo) {
      const endsLabel = opts.promo.endsLabel?.trim();
      const promoPct = opts.promo.discount && opts.promo.discount > 0 ? opts.promo.discount : null;
      if (language === 'he') {
        systemPrompt += `\n\nמצב מבצע חד-פעמי לזמן מוגבל — כתוב/כתבי פוסט קצר, ישיר וחד (חשוב: התעלם/י מהנחיית האורך הקודמת). מבנה קבוע: (1) שורת פתיחה מושכת עם אימוג'י מבצע (⏳🔥); (2) משפט אחד קצר שמתאר את המוצר; (3) שורת מחיר${promoPct ? ` עם ההנחה (${promoPct}%)` : ''}; (4) משפט מחץ אחד לסיום שקורא לפעולה מיידית (למשל "⏰ מהרו להזמין — לפני שייגמר!"). עד ~45 מילים, 3–5 שורות קצרות בלבד, בלי פסקאות ארוכות ובלי מילוי מיותר.${endsLabel ? ` ציין/י בקצרה את מועד הסיום: "עד ${endsLabel}".` : ''} אל תמציא/י מועד סיום אחר.`;
      } else if (language === 'ar') {
        systemPrompt += `\n\nوضع عرض لفترة محدودة — اكتب منشوراً قصيراً ومباشراً وحاداً (تجاهل قاعدة الطول السابقة). البنية: (1) سطر افتتاحي جذاب مع إيموجي عرض (⏳🔥)؛ (2) جملة قصيرة تصف المنتج؛ (3) سطر السعر${promoPct ? ` مع الخصم (${promoPct}%)` : ''}؛ (4) جملة ختامية قوية تدعو للطلب فوراً ("⏰ سارعوا بالطلب قبل النفاد!"). بحد أقصى ~45 كلمة، 3–5 أسطر قصيرة فقط.${endsLabel ? ` اذكر باختصار موعد الانتهاء: "حتى ${endsLabel}".` : ''}`;
      } else {
        systemPrompt += `\n\nLimited-time PROMO mode — write a SHORT, direct, punchy post (ignore the earlier length rule). Structure: (1) a hook line with a deal emoji (⏳🔥); (2) one short sentence describing the product; (3) a price line${promoPct ? ` with the ${promoPct}% discount` : ''}; (4) one punchy closing CTA that pushes immediate action ("⏰ Hurry — order before it's gone!"). Max ~45 words, 3–5 short lines only, no long paragraphs or filler.${endsLabel ? ` Briefly state the deadline: "until ${endsLabel}".` : ''} Do not invent a different end time.`;
      }
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
      : opts?.style === 'pinterest'
        ? this.buildPinterestPrompt(language, product, symbol, priceLocal, originalLocal, discount)
        : this.buildUserPrompt(language, product, symbol, priceLocal, originalLocal, discount);

    // A model that deliberates instead of writing copy must NEVER reach a channel. This
    // path used to accept anything non-empty, so a post went out to a live group carrying
    // the model's own scratchpad ("Wait, what if the instruction literally means…"), a quote
    // of this very system prompt, and a mid-word truncation. Validate the output; a rejected
    // draft gets ONE cooler retry (not billed again — the credit was consumed above for this
    // post, and charging twice to repair our own bad draft would be wrong), then the
    // deterministic template copy takes over.
    let text = '';
    const reasons: string[] = [];
    // Custom templates often produce longer, structured posts → give more room
    // and lower the temperature so the model adheres to the exact structure.
    // A pin carries a title line, 2-3 SEO sentences AND a hashtag line — 400 tokens
    // cut some of them mid-sentence, which the judge then (correctly) rejected as
    // truncated, and the campaign produced nothing at all.
    let tokenCap = hasTemplate ? 900 : (opts?.style === 'pinterest' ? 700 : 400);
    // Two JUDGED attempts. A draft the provider cut at the token budget is decided before
    // the judge ever sees it — it doesn't consume an attempt; it doubles the budget and
    // re-rolls (issue #59: a capped pin burned attempt 1 on "נקטע באמצע", leaving one shot).
    // `calls` bounds the loop so repeated truncations can't spin it forever.
    let attempt = 0;
    for (let calls = 0; calls < 4 && attempt < 2; calls++) {
      const result = await this.ai.generate(creds, {
        system: systemPrompt,
        prompt: userPrompt,
        images: visionImages,
        maxTokens: tokenCap,
        // A model whose reasoning eats the budget truncates the same way on every retry —
        // let a second keyed provider finish the copy instead (issue #62).
        truncationFailover: true,
        // The retry runs cold: rambling is a sampling failure, so a low temperature is the
        // single most effective change to get structured copy on the second try.
        temperature: attempt === 0 ? (hasTemplate ? 0.7 : 0.85) : 0.2,
      });

      const candidate = result?.text ? mdBoldToHtml(result.text) : '';
      if (!candidate) {
        // All keyed providers errored or answered empty — nothing to judge.
        reasons.push('ספקי ה-AI לא החזירו טקסט');
        this.logger.warn(`generateText: empty AI result for "${String(product?.title || '').slice(0, 60)}" — attempt ${attempt + 1}/2`);
        attempt++;
        continue;
      }
      if (result?.truncated) {
        reasons.push('הפלט נחתך במגבלת האורך — נוסה שוב עם תקציב כפול');
        tokenCap = Math.min(tokenCap * 2, 1600);
        this.logger.warn(`generateText: ${result.provider} draft hit the token cap for `
          + `"${String(product?.title || '').slice(0, 60)}" — retrying at ${tokenCap} tokens`);
        continue;
      }
      // Two gates, in order: the deterministic patterns (free, catches every KNOWN defect
      // shape), then the AI judge (one tiny call, catches NOVEL shapes the first time —
      // three different leak shapes reached channels before this existed).
      let defect = copyDefect(candidate);
      if (!defect) {
        defect = await this.copySanityVerdict(creds, candidate, opts?.style);
        // Final attempt + patterns passed: a single judge BAD now kills the post outright
        // (no silent fallback below), so require a SECOND independent BAD before failing —
        // a flaky verdict gets overturned, a systematic one stays authoritative.
        if (defect && attempt === 1) defect = await this.copySanityVerdict(creds, candidate, opts?.style);
      }
      if (!defect) { text = candidate; break; }
      reasons.push(defect);
      this.logger.warn(`generateText rejected ${result?.provider || 'ai'} draft (${defect}) `
        + `for "${String(product?.title || '').slice(0, 60)}" — attempt ${attempt + 1}/2`);
      attempt++;
    }

    if (!text) {
      // An AI-configured account must never publish the generic English-titled template to
      // a live audience (the "דיל לוהט" fallback shipped raw AliExpress titles to all three
      // groups). Fail LOUDLY instead: a campaign run records the reason and skips the
      // product (retried next cycle); manual screens show the reason to the user. The
      // AI credit consumed above is refunded — nothing was delivered for it.
      if (creds?.user_id) {
        await this.subscription.refund(creds.user_id, this.subscription.costs.ai_generate, 'ai-generate-failed')
          .catch(() => {});
      }
      const why = reasons.join(' | ') || 'סיבה לא ידועה';
      this.logger.error(`generateText: all drafts failed for "${String(product?.title || '').slice(0, 60)}" — ${why}`);
      throw new BadRequestException(`יצירת הטקסט נכשלה (${why}) — הפוסט לא נוצר כדי שלא תישלח תבנית גנרית לקבוצות`);
    }

    // Numbers are data, not prose: the price anchor and the social proof are rendered from
    // the same facts the model was given, so they can't come out unfilled, invented or
    // silently omitted. Appended only when the copy didn't state the price itself, so the
    // owner's existing price-bearing templates are untouched and migrate by simply dropping
    // their price line.
    const facts = {
      symbol, priceLocal, originalLocal, discount, language,
      rating: product?.rating, ordersCount: product?.orders_count,
    };
    if (!mentionsPrice(text, symbol, priceLocal)) {
      const block = priceProofBlock(facts);
      if (block) text = `${text}\n\n${block}`;
    }
    return text;
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
   * Pinterest is a visual SEARCH engine, not a feed: a pin is ranked by the keywords in
   * its description, lives for months, and its click already carries the product link.
   * So pin copy is the OPPOSITE of the Telegram voice — keyword-rich plain text, no
   * FOMO-heavy hype, no HTML (the API mapper strips tags), and short enough to survive
   * the 500-char description cap without being cut mid-sentence.
   */
  private pinterestSystemPrompt(language: string): string {
    if (language === 'he') {
      return `אתה כותב תוכן פינים לפינטרסט — מנוע חיפוש ויזואלי, לא פיד חברתי. הטקסט הוא SEO: פינים מופיעים בחיפוש במשך חודשים.
פורמט הפלט — טקסט רגיל בלבד (בלי HTML, בלי Markdown, בלי קישורים):
שורה 1: כותרת מוצר נקייה ועשירה במילות חיפוש — עד 90 תווים, בלי אימוג'י ובלי מילות ספאם ("חדש!", "מבצע חם")
שורה 2: ריקה
ואז 2–3 משפטים (עד 420 תווים): פתח במילת החיפוש המרכזית + התועלת העיקרית; שלב בטבעיות 2–3 ביטויי חיפוש משניים (שימוש, חדר, אירוע); ציין את המחיר פעם אחת; סיים בקריאה קצרה לפעולה (אל תזכיר "לינק" — הפין עצמו הוא הקישור)
שורה אחרונה: 3–4 האשטגים, מיקס של רחב וספציפי`;
    }
    if (language === 'ar') {
      return `أنت تكتب محتوى Pins لـ Pinterest — محرك بحث بصري، وليس موجزاً اجتماعياً. النص هو SEO: الـ Pins تظهر في البحث لأشهر.
تنسيق الإخراج — نص عادي فقط (بدون HTML أو Markdown أو روابط):
السطر 1: عنوان منتج نظيف غني بكلمات البحث — حتى 90 حرفاً، بدون إيموجي وبدون كلمات ترويجية مبتذلة
السطر 2: فارغ
ثم 2–3 جمل (حتى 420 حرفاً): ابدأ بعبارة البحث الرئيسية + الفائدة الأساسية؛ اذكر السعر مرة واحدة؛ اختم بدعوة قصيرة للعمل (لا تذكر "الرابط" — الـ Pin نفسه هو الرابط)
السطر الأخير: 3–4 هاشتاغات`;
    }
    return `You write Pinterest pin content for a US shopping audience. Pinterest is a visual SEARCH engine, not a social feed: pins surface through keyword search for months, so this is SEO copy — helpful and specific, never hype.

Output format — PLAIN TEXT only (no HTML, no Markdown, no links):
Line 1: a clean, keyword-rich product title — 50–90 characters, Title Case, no emoji, no year, no "Hot Sale"/"New" spam. The product's real name plus its strongest search phrase (e.g. "360 Rotating Jewelry Organizer with Earring Holder").
Line 2: empty.
Then 2–3 sentences (300–420 characters total):
• Open with the PRIMARY search phrase + the main benefit — the first 60 characters are all shoppers see in the feed, front-load them
• Naturally weave in 2–3 secondary search terms a shopper would type: the use case, the room, the occasion ("small spaces", "dorm room", "gift for her")
• American English, warm and helpful — a friend's recommendation, not an ad. No ALL-CAPS, no "Buy now!!", at most one emoji
• Mention the price exactly once in US format ("just $12.99"); if the order count is high, add one short social-proof note ("loved by 5K+ shoppers")
• Close with a short CTA like "Tap to shop" (never "link in bio/comments" — the pin IS the link)
Last line: 3–4 hashtags mixing one broad and two specific (e.g. #homeorganization #jewelrystorage #vanitydecor).`;
  }

  /** Product facts + the "write a pin description" ask — the Pinterest counterpart of
   *  buildUserPrompt (which asks for a Telegram post). */
  private buildPinterestPrompt(language: string, product: any, symbol: string, priceLocal: string, originalLocal: string, discount: number): string {
    const facts = `Product: ${product.title}
Price: ${symbol}${priceLocal}${discount > 0 ? ` (was ${symbol}${originalLocal}, -${discount}%)` : ''}
Rating: ${product.rating?.toFixed(1) || 'N/A'}/5 | Orders: ${product.orders_count || 0}
Category: ${product.category || 'General'}`;
    if (language === 'he') {
      return `כתוב תיאור פין לפינטרסט עבור המוצר הבא. עברית בלבד, טקסט רגיל בלבד.\n\n${facts}`;
    }
    if (language === 'ar') {
      return `اكتب وصف Pin لـ Pinterest للمنتج التالي. بالعربية فقط، نص عادي فقط.\n\n${facts}`;
    }
    return `Write a Pinterest pin description for the product below. English only, plain text only.\n\n${facts}`;
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
