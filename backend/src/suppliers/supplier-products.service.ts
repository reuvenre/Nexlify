import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import axios from 'axios';
import { SupplierProduct } from './entities/supplier-product.entity';
import { SupplierCatalog } from './entities/supplier-catalog.entity';
import { SupplierCatalogsService } from './supplier-catalogs.service';
import { YupooService } from './yupoo.service';
import { normalizeSku } from './sku-match.util';
import { openPostClash } from './flylink-dedup';
import { coverFirst } from './gallery-order';
import { dedupeProductImages, yupooPhotoKey } from './yupoo-image';
import { handPickedElsewhere } from './hand-picked-lock';
import { catalogsForCampaign } from './catalog-scope';
import { codeFromResolvedUrl, codesFromTitle, parseBulkLinks, titleFromHtml } from './flylink-bulk';
import { EMPTY_ENRICHMENT, Enrichment, hasAnything, parseEnrichment } from './store-enrich-parse';
import { CATEGORY_LIST_PROMPT } from '../storefront/store-categories';
import { PostsService, CampaignRunResult } from '../posts/posts.service';
import { FLYLINK_VARIANTS, pickVariant, variantHint } from '../posts/copy-variants';
import { Campaign } from '../campaigns/campaign.entity';
import { AiService, GenerateImage } from '../ai/ai.service';
import { CredentialsService, DecryptedCredentials } from '../credentials/credentials.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { RatesService } from '../rates/rates.service';
import { UNTRUSTED_DATA_RULE, fenceUntrusted, stripFenceMarks } from '../common/untrusted';

// store_name / store_category / store_brand are here so the owner can overrule the
// enrichment agent — it proposes, he decides, and the correction stands because
// store_enriched_at keeps the agent from revisiting the product.
const EDITABLE = ['title', 'description', 'image_url', 'price', 'currency', 'flylink_url', 'status', 'no_auto_post',
  'store_name', 'store_category', 'store_brand', 'store_hidden'] as const;

/**
 * A FLYLINK product isn't re-posted until at least this long after its last post. FLYLINK
 * catalogs are FINITE (unlike AliExpress's endless search), so when a catalog is small — or
 * mostly out of stock — the round-robin has nothing new and used to re-post the SAME product
 * every cron tick (the "same water gun over and over" bug). This gap makes a small catalog
 * cycle slowly instead of spamming one item; the campaign simply skips a tick when nothing is
 * past the gap. Tunable via env for stores that accept faster repeats.
 */
const FLYLINK_REPEAT_COOLDOWN_MS = (Number(process.env.FLYLINK_REPEAT_COOLDOWN_HOURS) || 48) * 3_600_000;

/** The same browser identity the Yupoo scraper needs — a bare client is a common block. */
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** One paste at a time. Each link costs a redirect fetch, so a runaway paste would hold
 *  the request open for minutes; the owner can simply paste the rest after. */
const MAX_BULK_LINKS = 200;

/** Album pages scanned to build the code index — 100 albums a page, so 2,000 products. */
const MAX_ALBUM_PAGES = 20;

/** Products the enrichment agent looks at per run — one vision call each. */
const STORE_ENRICH_BATCH = 12;

/** A code that two different albums share: matched to neither, on purpose. */
const AMBIGUOUS = Symbol('ambiguous-code');

interface AlbumHit { code: string; album_url: string }

@Injectable()
export class SupplierProductsService {
  private readonly logger = new Logger(SupplierProductsService.name);

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
      : await this.yupoo.fetchAlbum(dto.yupooUrl.trim(), this.catalogs.catalogPassword(catalog));
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

    // Identity is the ALBUM, not the code. Re-linking the same album is a refresh — attach
    // the new affiliate link and keep going, so "create post" always works.
    //
    // Matching on the code alone was silently wrong: when two albums normalized to the same
    // SKU, the second link was pinned onto the FIRST album's record and the post went out
    // with the wrong product's images. That failure is invisible — the link is right, the
    // pictures are not — so a code collision must never merge two albums.
    const albumUrl = (item.album_url || dto.yupooUrl).trim();
    const newLink = dto.flylinkUrl.trim();

    const existing = await this.repo.findOne({
      where: { user_id: userId, supplier_catalog_id: catalog.id, yupoo_url: albumUrl },
    });
    if (existing) {
      if (newLink && newLink !== existing.flylink_url) {
        existing.flylink_url = newLink;
        await this.repo.save(existing);
      }
      return { ...existing, sku_verified };
    }

    // A different album that normalizes to a code already in use. Keep both — they are
    // different products — and store this one under a code that stays unique so the
    // catalog's own de-dup can't collapse them later.
    let sku = yupooCanon;
    const clash = await this.repo.findOne({
      where: { user_id: userId, supplier_catalog_id: catalog.id, sku: yupooCanon },
    });
    if (clash) {
      const albumId = albumUrl.match(/albums\/(\d+)/)?.[1] || String(Date.now());
      sku = `${yupooCanon}-${albumId}`;
      this.logger.warn(
        `supplier code collision in catalog ${catalog.id}: "${yupooCanon}" already used by `
        + `${clash.yupoo_url} — storing the new album as "${sku}"`,
      );
    }

    const product = this.repo.create({
      user_id: userId,
      supplier_catalog_id: catalog.id,
      sku,
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

  /**
   * Follow a FLYLINK short link to whatever it actually opens.
   *
   * `https://s.flylinking.com/g-XKBRBNHMUD` is a fixed prefix and ten random characters —
   * it says nothing about the product, which is why linking a catalog meant pairing each
   * link to an album BY HAND. The destination is a real product URL, so resolving it is
   * what lets a bare column of links be matched to albums with nothing typed.
   *
   * Redirects are followed manually so the FINAL url is known exactly (axios reports only
   * the request it was given). Never throws: an unresolvable link is reported on its own
   * line, it does not fail the batch.
   */
  async resolveFlylink(url: string, maxHops = 5): Promise<{ url: string; title: string }> {
    let current = url;
    for (let hop = 0; hop < maxHops; hop++) {
      let res: any;
      try {
        res = await axios.get(current, {
          maxRedirects: 0,
          timeout: 12_000,
          validateStatus: () => true,
          // The same browser-ish identity Yupoo needs; a bare client is a common block.
          headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,*/*' },
        });
      } catch {
        return { url: current, title: '' };
      }
      const location = res.headers?.location;
      if (res.status >= 300 && res.status < 400 && location) {
        try { current = new URL(location, current).toString(); } catch { return { url: current, title: '' }; }
        continue;
      }
      // The destination page's title is where the product code actually lives — the URL
      // carries only opaque tokens.
      return { url: current, title: titleFromHtml(typeof res.data === 'string' ? res.data : '') };
    }
    return { url: current, title: '' };
  }

  /**
   * Link a whole batch of pasted FLYLINK links at once.
   *
   * The one thing in this pipeline no machine can produce is the affiliate link — FLYLINK
   * generates an opaque token per product on its own site. Everything AFTER that was
   * already automatic, and everything BEFORE it (title, price, gallery) is scraped. What
   * remained manual was the pairing: one album plus one link per pass through a form,
   * repeated for every product in the catalog.
   *
   * Here the owner pastes the links and nothing else. Each one is resolved to its
   * destination, the product code is read off it, and the matching Yupoo album is found by
   * the catalog's own SKU rules. A line that cannot be matched is REPORTED, never guessed
   * at: a link silently attached to the wrong album publishes the wrong pictures, and that
   * failure is invisible — the link works, the product is not the one in the photo.
   */
  async bulkLink(userId: string, catalogId: string, text: string): Promise<{
    linked: number; updated: number; failed: number; duplicates: number;
    results: Array<{ line: number; url: string; code: string; status: string; detail?: string }>;
  }> {
    const catalog = await this.catalogs.get(userId, catalogId);
    if (!catalog.source_store) throw new BadRequestException('לא הוגדרה חנות Yupoo לקטלוג');

    const { entries, skipped, duplicates } = parseBulkLinks(text);
    if (!entries.length && !skipped.length) throw new BadRequestException('לא נמצאו קישורים בטקסט');
    if (entries.length > MAX_BULK_LINKS) {
      throw new BadRequestException(`יותר מדי קישורים בבת אחת (${entries.length}) — עד ${MAX_BULK_LINKS}`);
    }

    const index = await this.albumIndex(catalog);
    const results: Array<{ line: number; url: string; code: string; status: string; detail?: string }> = [];
    let linked = 0; let updated = 0; let failed = 0;

    for (const n of skipped) {
      results.push({ line: n, url: '', code: '', status: 'skipped', detail: 'אין קישור בשורה' });
    }

    for (const entry of entries) {
      // What the owner typed beats what we can infer — he was looking at the product.
      // Otherwise: open the link, and read the code off the page it lands on. Several
      // candidates come back (the bare number, the brand-prefixed form), each TRIED
      // against the real albums — a wrong candidate simply finds nothing.
      let candidates = entry.code ? [entry.code] : [];
      let opened = false;
      if (!candidates.length) {
        const res = await this.resolveFlylink(entry.url);
        opened = !!res.title || res.url !== entry.url;
        candidates = codesFromTitle(res.title);
        const fromUrl = codeFromResolvedUrl(res.url);
        if (fromUrl && !candidates.includes(fromUrl)) candidates.push(fromUrl);
      }
      if (!candidates.length) {
        failed++;
        results.push({
          line: entry.line, url: entry.url, code: '', status: 'no_code',
          detail: opened
            ? 'הקישור נפתח אבל לא זוהה קוד מוצר — הוסף את הקוד בשורה'
            : 'לא הצלחתי לפתוח את הקישור — הוסף את הקוד בשורה',
        });
        continue;
      }

      // Every candidate that matches an album. Two candidates landing on DIFFERENT albums
      // is the same coin flip as a shared code, and is refused for the same reason.
      const matches = new Map<string, AlbumHit | typeof AMBIGUOUS>();
      for (const c of candidates) {
        const canon = normalizeSku(c, catalog.sku_match_mode, catalog.sku_match_config || {});
        const found = canon ? index.get(canon) : undefined;
        if (found) matches.set(c, found);
      }
      const code = Array.from(matches.keys())[0] || candidates[0];
      const distinct = new Set(
        Array.from(matches.values()).map((m) => (m === AMBIGUOUS ? 'ambiguous' : m.album_url)),
      );
      const hit = matches.size ? Array.from(matches.values())[0] : undefined;

      if (!hit) {
        failed++;
        results.push({
          line: entry.line, url: entry.url, code, status: 'no_album',
          detail: `לא נמצא אלבום עם הקוד הזה בחנות (נוסו: ${candidates.join(', ')})`,
        });
        continue;
      }
      if (hit === AMBIGUOUS || distinct.size > 1) {
        // Two albums normalize to one code. Picking either would be a coin flip on which
        // photos go out, so this one stays for the owner.
        failed++;
        results.push({ line: entry.line, url: entry.url, code, status: 'ambiguous', detail: 'יותר מאלבום אחד תואם — קשר ידנית' });
        continue;
      }

      try {
        const before = await this.repo.findOne({
          where: { user_id: userId, supplier_catalog_id: catalog.id, yupoo_url: hit.album_url },
        });
        await this.link(userId, {
          catalogId, yupooUrl: hit.album_url, flylinkUrl: entry.url, code,
        });
        if (before) { updated++; results.push({ line: entry.line, url: entry.url, code, status: 'updated' }); }
        else { linked++; results.push({ line: entry.line, url: entry.url, code, status: 'linked' }); }
      } catch (err: any) {
        failed++;
        results.push({ line: entry.line, url: entry.url, code, status: 'error', detail: err?.message || 'שגיאה' });
      }
    }

    this.logger.log(`bulk link catalog ${catalogId}: ${linked} new, ${updated} updated, ${failed} failed`);
    return { linked, updated, failed, duplicates, results };
  }

  /**
   * Every album in the store, by its normalized code.
   *
   * A code shared by two albums maps to AMBIGUOUS rather than to one of them: the existing
   * per-album collision handling exists because merging two albums on a shared code put the
   * WRONG product's images on a post, and a bulk import must not reintroduce that by
   * picking whichever album happened to be scraped first.
   */
  private async albumIndex(catalog: SupplierCatalog): Promise<Map<string, AlbumHit | typeof AMBIGUOUS>> {
    const pw = this.catalogs.catalogPassword(catalog);
    const index = new Map<string, AlbumHit | typeof AMBIGUOUS>();
    for (let page = 1; page <= MAX_ALBUM_PAGES; page++) {
      const res = await this.yupoo.fetchStore(catalog.source_store!, { page, password: pw });
      for (const item of res.items) {
        if (!item.code || !item.album_url) continue;
        const canon = normalizeSku(item.code, catalog.sku_match_mode, catalog.sku_match_config || {});
        if (!canon) continue;
        const seen = index.get(canon);
        if (!seen) index.set(canon, { code: item.code, album_url: item.album_url });
        else if (seen !== AMBIGUOUS && seen.album_url !== item.album_url) index.set(canon, AMBIGUOUS);
      }
      if (!res.hasMore) break;
    }
    return index;
  }

  /**
   * The enrichment agent: look at the photograph once, and write down what the product
   * is CALLED, what it IS, and whose it is.
   *
   * A Yupoo album is titled for the warehouse (`6380-42.66-LHYF-High quality…`) and the
   * only thing that reliably says what is in the box is the picture. Vision is not an
   * optimisation here, it is the whole method — which is also why the run stops when no
   * image can be fetched rather than guessing from the title it already knows is useless.
   *
   * Never throws: this runs over a whole catalog on a cron, and one product that cannot
   * be read must cost that product, not the batch.
   */
  async enrichForStore(userId: string, limit = STORE_ENRICH_BATCH): Promise<{
    looked: number; named: number; reason?: string;
  }> {
    const creds = await this.credentials.getRaw(userId).catch(() => null);
    if (!creds) return { looked: 0, named: 0, reason: 'אין הגדרות חשבון' };

    const pending = await this.repo.find({
      where: { user_id: userId, store_enriched_at: IsNull(), status: 'active' },
      order: { created_at: 'ASC' },
      take: Math.min(Math.max(limit, 1), 60),
    }).catch(() => [] as SupplierProduct[]);
    if (!pending.length) return { looked: 0, named: 0 };

    let named = 0;
    for (const product of pending) {
      const enrichment = await this.enrichOne(product, creds).catch((err: any) => {
        this.logger.warn(`store enrich ${product.id} failed: ${err?.message}`);
        return EMPTY_ENRICHMENT;
      });

      // Stamped either way. A product the agent could not read is not retried forever,
      // and the stamp is also what keeps the agent off one the owner has since corrected.
      const patch: Partial<SupplierProduct> = { store_enriched_at: new Date() };
      if (enrichment.name) patch.store_name = enrichment.name;
      if (enrichment.category) patch.store_category = enrichment.category;
      if (enrichment.brand) patch.store_brand = enrichment.brand;
      await this.repo.update({ id: product.id }, patch).catch(() => {});
      if (hasAnything(enrichment)) named++;
    }

    this.logger.log(`store enrich: ${named}/${pending.length} named for ${userId}`);
    return { looked: pending.length, named };
  }

  /** Owners with products the store has not named yet — the cron's work list. */
  async usersWithUnnamedProducts(limit = 20): Promise<string[]> {
    const rows: Array<{ user_id: string }> = await this.repo.query(
      `SELECT DISTINCT user_id FROM supplier_products
       WHERE store_enriched_at IS NULL AND status = 'active'
         AND flylink_url IS NOT NULL AND flylink_url <> ''
       LIMIT $1`,
      [limit],
    ).catch(() => []);
    return rows.map((r) => String(r.user_id));
  }

  /** One product, through the model's eyes. */
  private async enrichOne(p: SupplierProduct, creds: DecryptedCredentials): Promise<Enrichment> {
    const images = await this.fetchImagesBase64([p.image_url || ''].filter(Boolean), 1);
    if (!images.length) return EMPTY_ENRICHMENT;

    const res = await this.ai.generate(creds, {
      system: [
        'אתה מקטלג מוצרים בחנות אונליין ישראלית.',
        'אתה מקבל תמונה של מוצר ומחזיר JSON בלבד, בלי טקסט נוסף:',
        '{"name": "...", "category": "...", "brand": "..."}',
        '',
        'name — שם קצר בעברית שקונה היה מחפש, עד 6 מילים. לדוגמה: "נעלי ניו באלנס 9060", "תיק כתף קואץ\'".',
        `category — בדיוק אחת מהאפשרויות: ${CATEGORY_LIST_PROMPT}`,
        'brand — שם המותג באנגלית אם הוא נראה בתמונה או בכותרת. אם אינך רואה מותג — החזר מחרוזת ריקה.',
        '',
        'אל תמציא. אם אינך יודע שדה — החזר עבורו מחרוזת ריקה.',
        '',
        UNTRUSTED_DATA_RULE,
      ].join('\n'),
      prompt: [
        'קטלג את המוצר שבתמונה.',
        p.title ? `כותרת הספק (עשויה להכיל קוד מק"ט ומחיר סיטונאי — התעלם מהם): ${fenceUntrusted(p.title)}` : '',
        p.description ? `רמז נוסף מהספק: ${fenceUntrusted(p.description, 500)}` : '',
      ].filter(Boolean).join('\n'),
      images,
      maxTokens: 220,
      temperature: 0.2,
    });

    return res?.text ? parseEnrichment(stripFenceMarks(res.text)) : EMPTY_ENRICHMENT;
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
      `שם/מותג: ${fenceUntrusted(p.title)}`,
      p.price > 0 ? `מחיר: ${p.currency} ${p.price}` : null,
    ].filter(Boolean).join('\n');
    const result = await this.ai.generate(creds, {
      system: 'אתה כותב תיאורי מוצר קצרים ומדויקים בעברית לקטלוג. 2-4 משפטים, ענייני, בלי מחיר ובלי קישור. עברית בלבד (מותג באנגלית מותר).\n\n'
        + UNTRUSTED_DATA_RULE,
      prompt: `כתוב תיאור לפי:\n${facts}`,
      maxTokens: 300, temperature: 0.6,
    });
    const description = stripFenceMarks(result?.text?.trim() || '');
    if (!description) throw new BadRequestException('יצירת התיאור נכשלה');
    p.description = description;
    await this.repo.save(p);
    return { description };
  }

  /** All product photos (colors/variants), proxied → one swipeable Telegram album. */
  private proxiedGallery(p: SupplierProduct): string[] {
    // Deduped by PHOTO, not by URL: the album serves one shot at several sizes, so a
    // by-URL check let the same photo in twice (and the low-res twin looked blurry beside
    // its sharp one). Applied at read time, not only at scrape, so catalogs imported
    // before the fix are healed without re-importing. It also subsumes the old cover
    // check — the cover is usually present in the gallery under a different size.
    return this.rawGallery(p).map((u) => this.proxyImage(u));
  }

  /**
   * Resolve the publish target group(s): explicit multi-select `channels` →
   * single `channelId` → the catalog's default group → the user's default channel.
   * Returns [] when nothing is set (post goes to the user's default channel).
   */
  private async targetChannels(p: SupplierProduct, channels?: string[], channelId?: string): Promise<string[]> {
    const multi = Array.from(new Set((channels || [])
      .map((c) => (typeof c === 'string' ? c.trim() : ''))
      .filter(Boolean)));
    if (multi.length) return multi;
    if (channelId?.trim()) return [channelId.trim()];
    const catalog = await this.repo.manager.findOne(SupplierCatalog, { where: { id: p.supplier_catalog_id } });
    return catalog?.target_channel_id ? [catalog.target_channel_id] : [];
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
  async preview(userId: string, id: string, opts?: { language?: string; template?: string; vision?: boolean; hint?: string; copyHint?: string }) {
    const p = await this.get(userId, id);
    const gallery = this.proxiedGallery(p);
    const image = this.proxyImage(p.image_url) || gallery[0] || '';

    // Vision: fetch SEVERAL of the real product photos so the AI can identify the item
    // reliably — a single first image is often a cover/size-chart/logo and makes the model
    // write about the wrong thing (flip-flops → "lighting"). For Yupoo/FLYLINK the "title" is
    // just a CODE (e.g. "MM-2642001DP"), so the image is the ONLY product identity — vision
    // must run EVEN with a template (the template gives the voice, vision gives the subject).
    let images: GenerateImage[] | undefined;
    let visionUsed = false;
    if (opts?.vision) {
      images = await this.fetchImagesBase64(this.rawGallery(p), 3);
      visionUsed = images.length > 0;
    }

    const { price, currency } = await this.pricing(userId, p.price);
    const product = this.toPostProduct(p, image, price, currency);
    // A hint is the meaningful product name — use it in the facts so the copy is on-topic.
    if (opts?.hint?.trim()) product.title = opts.hint.trim();

    const result = await this.posts.preview(
      userId, p.sku || p.id, opts?.language || 'he', product, opts?.template, images, opts?.hint,
      !!opts?.vision, // forceVision: keep vision on even under a template (code-only titles)
      undefined,
      opts?.copyHint, // the bandit's angle nudge (campaign runs) — suppressed under a template
    );
    return { ...result, gallery, vision_used: visionUsed };
  }

  /**
   * Raw (un-proxied) product image URLs — main image first, then the gallery, one entry
   * per real photo (see yupoo-image.ts: the same shot arrives at several sizes, and the
   * duplicates both bloated the album and published blurry low-res twins).
   */
  private rawGallery(p: SupplierProduct): string[] {
    let g: string[] = [];
    try { g = p.gallery_json ? JSON.parse(p.gallery_json) : []; } catch { /* ignore */ }
    return dedupeProductImages([p.image_url, ...g]);
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
      // Validate BY PHOTO: a selection saved before the size-variant de-dup names a URL the
      // clean gallery no longer contains verbatim, and an exact-URL filter silently dropped
      // it — the post then published the whole album instead of the chosen few. Matching on
      // photo identity also upgrades each pick to the sharp rendition.
      const byKey = new Map(full.map((u) => [yupooPhotoKey(u), u]));
      const chosen = dedupeProductImages(
        selected.map((u) => byKey.get(yupooPhotoKey(u))).filter((u): u is string => !!u),
      ).slice(0, max);
      if (chosen.length) return chosen;
    }
    // No manual pick → album order, but the CATALOG COVER leads. Yupoo fashion albums
    // routinely open with a size chart / color-code sheet, and Facebook (which posts ONE
    // photo = gallery[0]) then advertised a Height/Weight table instead of the product.
    return coverFirst(full, this.proxyImage(p.image_url), max);
  }

  /**
   * Gallery for a manual send/schedule/queue. An explicit user selection always wins.
   * Otherwise, when this product was ALREADY published, a re-push must mirror the first
   * post's images — not dump the whole Yupoo album. Only a never-posted product falls
   * back to the full album (capped). Fixes re-sends ballooning e.g. 4 → 10 images.
   */
  private async resolveGallery(userId: string, p: SupplierProduct, selected: string[] | undefined, max: number): Promise<string[]> {
    if (selected?.length) return this.selectGallery(p, selected, max);
    const original = await this.posts.findOriginalPost(userId, String(p.sku || p.id)).catch(() => null);
    if (original) {
      let g: string[] = [];
      try { g = original.gallery_json ? JSON.parse(original.gallery_json) : []; } catch { g = []; }
      if (!g.length && original.product_image) g = [original.product_image];
      if (g.length) return g.slice(0, max);
    }
    return this.selectGallery(p, undefined, max);
  }

  /**
   * The image choices for a POST's gallery editor (posts screen): the post's current
   * gallery plus the product's full catalog album, so the owner can re-pick from scratch.
   * The post's product_id is `sku || id` of the supplier product — both are tried. A post
   * whose product no longer exists in the catalog still gets its own current images.
   */
  async postGalleryOptions(userId: string, postId: string): Promise<{ current: string[]; catalog: string[] }> {
    const post = await this.posts.getOwnedPost(userId, postId);
    let current: string[] = [];
    try { current = post.gallery_json ? JSON.parse(post.gallery_json) : []; } catch { current = []; }
    if (!current.length && post.product_image) current = [post.product_image];

    const key = String(post.product_id || '').trim();
    let product = key
      ? await this.repo.findOne({ where: { user_id: userId, sku: key } })
      : null;
    if (!product && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
      product = await this.repo.findOne({ where: { user_id: userId, id: key } });
    }
    const catalog = product ? this.proxiedGallery(product) : [];
    // Match the post's stored images to the catalog BY PHOTO, not by URL: a post saved
    // before the de-dup fix carries a different size variant of the same shot, which an
    // exact-URL union re-added as a separate (blurry) choice and left unhighlighted as
    // "selected". Mapping onto the catalog URL fixes both at once.
    const byKey = new Map(catalog.map((u) => [yupooPhotoKey(u), u]));
    const currentMapped = dedupeProductImages(current.map((u) => byKey.get(yupooPhotoKey(u)) || u));
    // The union keeps any current image the catalog no longer carries selectable.
    const extras = currentMapped.filter((u) => !byKey.has(yupooPhotoKey(u)));
    return { current: currentMapped, catalog: [...catalog, ...extras] };
  }

  /**
   * Refuse to queue/schedule a product that ALREADY has an open post (queued / scheduled /
   * pending) to any of the same groups — that open post IS the publish the user asked for,
   * and a second one duplicates it in the channel (the "one sent + one scheduled again"
   * bug). Sending NOW is not guarded — an immediate push is an explicit user decision —
   * and already-sent history never blocks (that's the repost feature).
   */
  private async assertNotAlreadyPending(userId: string, p: SupplierProduct, targets: string[]): Promise<void> {
    const open = await this.posts.openPostsForProduct(userId, String(p.sku || p.id)).catch(() => []);
    if (openPostClash(open, targets)) {
      throw new BadRequestException(
        'המוצר כבר ממתין לפרסום לקבוצה הזו (בתור או מתוזמן). מחק את הפוסט הקיים במסך הפוסטים אם ברצונך לתזמן מחדש.',
      );
    }
  }

  /** Send now — to one group or several at once (a single credit for the action). */
  async send(userId: string, id: string, text?: string, channelId?: string, images?: string[], collageCells?: number, channels?: string[]) {
    const p = await this.get(userId, id);
    if (p.in_stock === false) throw new BadRequestException('המוצר לא זמין (קישור FLYLINK מת)');
    if (!p.flylink_url) throw new BadRequestException('חסר קישור FLYLINK למוצר');

    const gallery = await this.resolveGallery(userId, p, images, collageCells ? 30 : 10);
    const image = gallery[0] || this.proxyImage(p.image_url) || '';
    const finalText = text?.trim() || (await this.preview(userId, id)).generated_text;
    const targets = await this.targetChannels(p, channels, channelId);
    const { price } = await this.pricing(userId, p.price);

    const post = await this.posts.sendCustomNow(userId, {
      productId: p.sku || p.id, title: p.title, image, images: gallery,
      affiliateUrl: p.flylink_url, text: finalText, priceIls: price,
      channelOverride: targets[0], channels: targets, collageCells,
    });
    p.has_post = true;
    p.last_posted_at = new Date(); // advance the campaign rotation cursor — a manual publish counts
    await this.repo.save(p);
    return { sent: true, post_id: post.id, channels: targets.length ? targets : ['default'] };
  }

  /** Schedule for a specific time — to one group or several at once. */
  async schedule(userId: string, id: string, scheduledAt: Date, text?: string, channelId?: string, images?: string[], collageCells?: number, channels?: string[]) {
    const p = await this.get(userId, id);
    if (p.in_stock === false) throw new BadRequestException('המוצר לא זמין (קישור FLYLINK מת)');
    if (!p.flylink_url) throw new BadRequestException('חסר קישור FLYLINK למוצר');

    const targets = await this.targetChannels(p, channels, channelId);
    await this.assertNotAlreadyPending(userId, p, targets);

    const gallery = await this.resolveGallery(userId, p, images, collageCells ? 30 : 10);
    const image = gallery[0] || this.proxyImage(p.image_url) || '';
    const finalText = text?.trim() || (await this.preview(userId, id)).generated_text;
    const { price } = await this.pricing(userId, p.price);

    const post = await this.posts.scheduleCustom(userId, {
      productId: p.sku || p.id, title: p.title, image, images: gallery,
      affiliateUrl: p.flylink_url, text: finalText, priceIls: price,
      channelOverride: targets[0], channels: targets, collageCells,
    }, scheduledAt);
    p.has_post = true;
    p.last_posted_at = new Date(); // advance the campaign rotation cursor — a manual publish counts
    await this.repo.save(p);
    return { scheduled: true, post_id: post.id, at: scheduledAt, channels: targets.length ? targets : ['default'] };
  }

  /**
   * Publish: push the supplier product into the SHARED post queue, routed to the
   * chosen group (or the catalog's default). Reuses the entire existing pipeline.
   */
  async queue(userId: string, id: string, text?: string, channelId?: string, images?: string[], collageCells?: number, channels?: string[]) {
    const p = await this.get(userId, id);
    if (p.in_stock === false) throw new BadRequestException('המוצר לא זמין (קישור FLYLINK מת)');
    if (!p.flylink_url) throw new BadRequestException('חסר קישור FLYLINK למוצר');

    const targets = await this.targetChannels(p, channels, channelId);
    await this.assertNotAlreadyPending(userId, p, targets);

    const gallery = await this.resolveGallery(userId, p, images, collageCells ? 30 : 10);
    const image = gallery[0] || this.proxyImage(p.image_url) || '';
    const { price, currency } = await this.pricing(userId, p.price);

    const post = await this.posts.createQueuedPost(
      userId,
      this.toPostProduct(p, image, price, currency),
      undefined,
      text?.trim() || p.description || undefined,
      targets[0],
      gallery,
      collageCells,
      targets,
    );
    p.has_post = true;
    p.last_posted_at = new Date(); // advance the campaign rotation cursor — a manual publish counts
    await this.repo.save(p);
    const creds = await this.credentials.getRaw(userId);
    return {
      queued: true, post_id: post.id, channels: targets.length ? targets : ['default'],
      queue_active: creds?.schedule_enabled === true,
      interval_minutes: creds?.schedule_interval_minutes ?? 60,
    };
  }

  /**
   * One FLYLINK campaign cycle. Unlike AliExpress there is no keyword search — FLYLINK has
   * no search API and links are pasted by hand — so the campaign ROTATES the user's already-
   * linked catalog: it picks the least-recently-posted in-stock products, writes fresh AI
   * copy in the target group's voice, and queues them (they publish on the normal schedule,
   * one per interval). last_posted_at is the round-robin cursor, so once every product has
   * gone out the oldest resurfaces and the rotation loops — no repeats until a full lap.
   *
   * Mirrors PostsService.runCampaign's contract: queues (never sends immediately), throws
   * on any condition that yields zero posts, per-product try/catch so one failure can't
   * abort the batch.
   */
  async runFlylinkCampaign(campaign: Campaign, userId: string, opts?: { fromScheduler?: boolean }): Promise<CampaignRunResult> {
    // Skip scheduled runs outside the send window — otherwise overnight hourly runs create
    // posts clamped to the window-open time and all burst at once (same fix as AliExpress).
    if (opts?.fromScheduler && !(await this.posts.isCampaignWindowOpen(userId, campaign))) {
      return { queued: 0, failed: 0, keyword: '', searched: '', errors: ['מחוץ לחלון הפרסום — דילוג'] };
    }

    // Target groups: a flylink campaign has no default channel to fall back to, so an
    // unset target is a hard error, not a silent post-to-nowhere.
    let targets: string[] = [];
    try { targets = JSON.parse(campaign.target_channels || '[]'); } catch { targets = []; }
    targets = Array.from(new Set(targets.filter((t) => typeof t === 'string' && t.trim())));
    if (!targets.length) throw new BadRequestException('לקמפיין FLYLINK לא הוגדרה קבוצת יעד — ערוך את הקמפיין ובחר קבוצה');

    const limit = Math.max(1, Math.min(20, campaign.posts_per_run || 1));

    // WHOSE SHELF: honour the catalog's "קבוצה מקושרת" the same way a manual send does.
    // Without this the autopilot rotated every product the account owns regardless of which
    // catalog it came from, so the tactical campaign published brand items to the tactical
    // group — and the per-group dedup then locked the mama campaign out of them. An unlinked
    // catalog declares nothing and stays open to every campaign (see catalog-scope.ts).
    const catalogs = await this.repo.manager.find(SupplierCatalog, { where: { user_id: userId } });
    const allowedCatalogs = catalogsForCampaign(catalogs, targets);
    if (catalogs.length && !allowedCatalogs.length) {
      throw new BadRequestException(
        'אף קטלוג ספקים לא מקושר לקבוצות היעד של הקמפיין — קשר קטלוג לקבוצה במסך הספקים, '
        + 'או נקה את "קבוצה מקושרת" כדי לאפשר לכל הקמפיינים לסובב אותו',
      );
    }

    // Oldest-first rotation: NULLS FIRST puts never-posted products at the head, so a fresh
    // catalog publishes everything once before anything repeats. in_stock IS DISTINCT FROM
    // false keeps NULL (never-checked) AND true, dropping only confirmed-dead links.
    const query = this.repo.createQueryBuilder('p')
      .where('p.user_id = :userId', { userId })
      .andWhere('p.status = :status', { status: 'active' })
      .andWhere('p.in_stock IS DISTINCT FROM false')
      // The owner's per-product opt-out: never rotated by the autopilot (manual sends only).
      .andWhere('p.no_auto_post IS DISTINCT FROM true')
      .andWhere("p.flylink_url IS NOT NULL AND p.flylink_url <> ''");
    if (allowedCatalogs.length) {
      query.andWhere('p.supplier_catalog_id IN (:...allowedCatalogs)', { allowedCatalogs });
    }
    const candidates = await query
      .orderBy('p.last_posted_at', 'ASC', 'NULLS FIRST')
      .addOrderBy('p.created_at', 'ASC')
      .take(Math.max(limit * 5, 50)) // room to skip products this campaign already posted
      .getMany();

    if (!candidates.length) {
      // Name the scope when it is the reason — "the whole catalog is empty" would send him
      // looking at products that exist and are simply another group's.
      throw new BadRequestException(allowedCatalogs.length < catalogs.length
        ? 'אין מוצרי FLYLINK זמינים בקטלוגים המקושרים לקבוצות היעד של הקמפיין'
        : 'אין מוצרי FLYLINK זמינים במלאי לפרסום');
    }

    // CROSS-ORIGIN dedup — the same per-group signal the AliExpress runner uses: exclude
    // any product that ANY post (a manual queue/schedule from the catalog included) already
    // targets in this campaign's group(s) — open posts always, sent ones within the
    // cooldown. Without this the campaign re-posted exactly what the owner had just queued
    // by hand: manual posts carry no campaign_id (invisible to postedProductIds below) and
    // don't advance last_posted_at, so they sat at the HEAD of this rotation (observed:
    // POLO-5349 sent once and queued again).
    const groupBusy = await this.posts
      .postedProductIdsToChannels(targets, new Date(Date.now() - FLYLINK_REPEAT_COOLDOWN_MS))
      .catch(() => new Set<string>());

    // HAND-PICKED LOCK — the catalog is shared by every FLYLINK campaign, so an item the
    // owner sent by hand to one group used to surface later in another campaign's group
    // (observed: a tactical item published to the brands-for-moms group). A product he
    // aimed at a group this campaign does not publish to is his, not the rotation's.
    const handLocked = handPickedElsewhere(
      await this.posts.handPickedChannels(userId).catch(() => []),
      targets,
    );

    const available = candidates.filter(
      (p) => !groupBusy.has(String(p.sku || p.id)) && !handLocked.has(String(p.sku || p.id)),
    );
    if (!available.length) {
      return { queued: 0, failed: 0, keyword: 'מוצרי FLYLINK', searched: 'FLYLINK',
        errors: ['כל המוצרים הזמינים כבר ממתינים לפרסום או פורסמו לאחרונה לקבוצות היעד — דילוג'] };
    }

    // Explicit dedup — the SAME signal the AliExpress runner uses (and why it never repeats):
    // skip products this campaign already posted. last_posted_at ordering alone let a product
    // get re-selected on the next run (observed: WT1463 posted at 06:00 AND 09:00).
    const postedIds = await this.posts.postedProductIds(campaign.id).catch(() => new Set<string>());
    const fresh = available.filter((p) => !postedIds.has(String(p.sku || p.id)));
    // Once the whole catalog has been posted at least once, repeats are allowed — but ONLY
    // for items past the repeat-cooldown, oldest-first (candidates are ordered by
    // last_posted_at ASC). Without this, a tiny/mostly-out-of-stock catalog re-posted the
    // same product every cron tick. If nothing is past the cooldown, publish NOTHING this
    // run rather than spam the same item — the campaign catches up next cadence.
    let pool = fresh;
    if (!pool.length) {
      const cutoff = Date.now() - FLYLINK_REPEAT_COOLDOWN_MS;
      pool = available.filter((p) => !p.last_posted_at || new Date(p.last_posted_at).getTime() < cutoff);
    }
    const products = pool.slice(0, limit);
    if (!products.length) {
      return { queued: 0, failed: 0, keyword: 'מוצרי FLYLINK', searched: 'FLYLINK',
        errors: ['כל מוצרי הקטלוג פורסמו לאחרונה — דילוג עד שהקולדאון יעבור. הוסף מוצרים לקטלוג לפרסום תכוף ומגוון יותר.'] };
    }

    // Copy style of the group the campaign posts to (first target) — e.g. the "מאמא מותגים"
    // hidden-product template. Empty → the built-in voice.
    const template = await this.posts.resolveBodyTemplate(userId, targets[0]);

    const result: CampaignRunResult = { queued: 0, failed: 0, keyword: 'מוצרי FLYLINK', searched: 'FLYLINK', errors: [] };
    const now = new Date();

    // Publish times for THIS run — the campaign's cron is the cadence, so a "every 3h"
    // flylink campaign publishes every 3h rather than being re-paced to the queue interval.
    const creds = await this.credentials.getRaw(userId);
    const times = this.posts.campaignScheduleTimes(products.length, creds);

    let skipped = 0;
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      try {
        // Per-group pacing WITH fair-share (same rule as AliExpress): pass the campaign id so
        // a group shared by this FLYLINK campaign and an AliExpress one ALTERNATES between
        // them. Without the id, FLYLINK booked every interval and the AliExpress campaign
        // (which does pass its id) always saw the group busy and was starved.
        const { slot, skip } = await this.posts.nextGroupSlot(userId, targets[0], times[i], campaign.id);
        if (skip && opts?.fromScheduler) { skipped++; continue; }

        const productKey = String(p.sku || p.id);
        const original = await this.posts.findOriginalPost(userId, productKey);

        if (original) {
          // REPOST: republish the ORIGINAL post VERBATIM — same copy, same images. No AI
          // rewrite, no gallery re-pick. The user wants a re-post to be an exact re-run of
          // the first publish (the AI rewrites came out wrong, and re-selecting the gallery
          // dumped every catalog image). textOverride skips generation; the original gallery
          // is passed as-is so no extra images are added.
          let origGallery: string[] = [];
          try { origGallery = original.gallery_json ? JSON.parse(original.gallery_json) : []; } catch { origGallery = []; }
          if (!origGallery.length && original.product_image) origGallery = [original.product_image];
          const displayCcy = (creds?.currency_pair || 'USD_ILS').split('_')[1] || 'ILS';
          const product = {
            product_id: productKey,
            title: original.product_title,
            image_url: original.product_image || origGallery[0] || '',
            affiliate_url: original.affiliate_url,
            sale_price: original.price_ils ?? 0,      // already in display currency → not re-converted
            original_price: original.price_ils ?? 0,
            currency: displayCcy,
            discount_percent: 0,
            orders_count: 0,
            rating: 0,
          };
          await this.posts.createQueuedPost(userId, product, undefined, original.generated_text || undefined, targets[0], origGallery, undefined, targets,
            { scheduledAt: slot, campaignId: campaign.id });
        } else {
          // FIRST TIME for this product: write fresh AI copy in the group's voice (one
          // generation credit; createQueuedPost reuses it via textOverride, not twice). Use
          // VISION — the Yupoo title is just a code, so the AI must write from the PHOTOS or
          // it hallucinates the product (a swimsuit was described as "storage").
          const gallery = this.selectGallery(p, undefined, 10);
          const image = gallery[0] || this.proxyImage(p.image_url) || '';
          const { price, currency } = await this.pricing(userId, p.price);
          const product = this.toPostProduct(p, image, price, currency);
          // The copy angle, from the FLYLINK pool — which adds 'trust' (speak straight to
          // the replica-fear) on top of the shared angles. Recorded on the post either way
          // so clicks per angle teach the bandit; the hint itself is suppressed under a
          // group template, whose wording is the owner's (same contract as AliExpress).
          const stats = await this.posts.variantStats(campaign.id).catch(() => []);
          const variant = pickVariant(stats, Math.random(), FLYLINK_VARIANTS);
          const preview = await this.preview(userId, p.id, {
            language: 'he', template: template || undefined, vision: true,
            copyHint: variantHint(variant, 'he'),
          });
          const text = preview?.generated_text || p.description || undefined;
          await this.posts.createQueuedPost(userId, product, undefined, text, targets[0], gallery, undefined, targets,
            { scheduledAt: slot, campaignId: campaign.id, copyVariant: variant.id });
        }

        p.has_post = true;
        p.last_posted_at = now; // advance the rotation cursor
        await this.repo.save(p);
        await this.posts.incrementCampaignPosts(campaign.id);
        result.queued++;
      } catch (err: any) {
        result.failed++;
        result.errors.push(`${p.title?.slice(0, 40) || p.sku || p.id}: ${err.message}`);
      }
    }

    // A group already booked this interval is a legitimate skip, not a failure.
    if (!result.queued && !skipped) throw new BadRequestException(result.errors.join(' | ') || 'הרצת הקמפיין לא יצרה פוסטים');
    return result;
  }

  /** Fetch a Yupoo album's FULL content (all color images) for the post modal — no save. */
  async previewAlbum(userId: string, catalogId: string, url: string) {
    const cat = await this.catalogs.get(userId, catalogId); // authorize catalog ownership
    if (!url?.trim()) throw new BadRequestException('חסר קישור Yupoo');
    const item = await this.yupoo.fetchAlbum(url.trim(), this.catalogs.catalogPassword(cat));
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
        // A password-protected store needs its catalog password to fetch — load it best-effort.
        let pw: string | undefined;
        try {
          const cat = await this.catalogs.get(product.user_id, product.supplier_catalog_id);
          pw = this.catalogs.catalogPassword(cat);
        } catch { /* catalog gone — try public */ }
        const item = await this.yupoo.fetchAlbum(product.yupoo_url, pw);
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
