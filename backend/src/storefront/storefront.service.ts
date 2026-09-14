import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Storefront } from './storefront.entity';
import { User } from '../users/user.entity';
import { LinksService } from '../links/links.service';
import { nextFreeSlug, slugError } from './store-slug';
import { storeTexts } from './store-defaults';
import { brandDisplayName, storeCardName } from './product-name';
import { priceBounds, sorter } from './store-sort';

/** One product as the public store shows it. */
export interface StoreProduct {
  id: string;
  title: string;
  brand: string | null;
  image: string | null;
  gallery: string[];
  price: number;
  currency: string;
  /** Where it came from: 'supplier' (hidden-brand catalog) or 'post' (published deal). */
  source: 'supplier' | 'post';
  /** Group it was published to, when it was — the store's own filter. */
  group: string | null;
  /** The shop category the enrichment agent decided, or the owner corrected. */
  category: string | null;
  /** ISO date it was last published, newest-first ordering. */
  at: string | null;
}

const PAGE_SIZE = 24;

/**
 * The public storefront: every product a customer publishes, in one browsable place.
 *
 * Reads across two catalogs. The supplier catalog is the hidden-brand shelf — products
 * linked to a FLYLINK affiliate link, whether or not they have been posted yet, because
 * the store is the full offering and not a publication log. The posts side is everything
 * that went out to the channels, deduplicated to one row per product.
 */
@Injectable()
export class StorefrontService {
  private readonly logger = new Logger(StorefrontService.name);

  constructor(
    @InjectRepository(Storefront) private readonly repo: Repository<Storefront>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly links: LinksService,
  ) {}

  // ── Owner side ─────────────────────────────────────────────────────────────

  /** The owner's store, created on first look so the settings screen always has one. */
  async mine(userId: string): Promise<Storefront> {
    const existing = await this.repo.findOne({ where: { user_id: userId } });
    if (existing) return existing;

    const user = await this.users.findOne({ where: { id: userId } });
    const seed = user?.name?.trim() || (user?.email || '').split('@')[0] || 'store';
    const taken = (await this.repo.find({ select: ['slug'] })).map((s) => s.slug);
    return this.repo.save(this.repo.create({
      user_id: userId,
      slug: nextFreeSlug(seed, taken),
      name: user?.name?.trim() || 'החנות שלי',
      enabled: false,
    }));
  }

  async update(userId: string, dto: Partial<Storefront>): Promise<Storefront> {
    const store = await this.mine(userId);

    if (dto.slug !== undefined) {
      const slug = String(dto.slug || '').trim().toLowerCase();
      const err = slugError(slug);
      if (err) throw new BadRequestException(err);
      if (slug !== store.slug) {
        const clash = await this.repo.findOne({ where: { slug } });
        if (clash) throw new BadRequestException('הכתובת הזו כבר תפוסה — בחר אחרת');
        store.slug = slug;
      }
    }
    if (dto.name !== undefined) {
      const name = String(dto.name || '').trim();
      if (!name) throw new BadRequestException('שם החנות לא יכול להיות ריק');
      store.name = name.slice(0, 60);
    }
    for (const key of ['tagline', 'whatsapp', 'shipping_text', 'details_text'] as const) {
      if (dto[key] !== undefined) (store as any)[key] = (String(dto[key] ?? '').trim() || null);
    }
    if (dto.enabled !== undefined) store.enabled = !!dto.enabled;
    if (dto.link_in_posts !== undefined) store.link_in_posts = !!dto.link_in_posts;
    if (dto.sources !== undefined) {
      const wanted = String(dto.sources || '').split(',').map((s) => s.trim())
        .filter((s) => s === 'suppliers' || s === 'posts');
      if (!wanted.length) throw new BadRequestException('בחר לפחות מקור מוצרים אחד');
      store.sources = wanted.join(',');
    }
    return this.repo.save(store);
  }

  /** The public address, for the settings screen and the post footer. */
  storeUrl(slug: string): string {
    const base = (process.env.FRONTEND_URL || '').split(',')[0].trim().replace(/\/$/, '');
    return `${base}/s/${slug}`;
  }

  /**
   * The store's address and name for a post about to go out, or null when there is no
   * live store to link to.
   *
   * Reads on the publish path, so it never creates a row the way `mine` does — a send is
   * not the place to discover that a user has no storefront yet.
   *
   * Two switches have to agree: the store has to be live, and its owner has to want the
   * channels advertising it. Either one off means the post goes out without the line.
   */
  async liveStore(userId: string): Promise<{ url: string; name: string } | null> {
    const store = await this.repo
      .findOne({ where: { user_id: userId, enabled: true, link_in_posts: true } })
      .catch(() => null);
    if (!store) return null;
    const url = this.storeUrl(store.slug);
    // FRONTEND_URL unset would produce "/s/slug" — a relative path in a Telegram message
    // is not a link, it is noise.
    return /^https?:\/\//.test(url) ? { url, name: store.name } : null;
  }

  /**
   * The public product page for one post, or null when there is nowhere to send traffic.
   *
   * Pinterest decides what to INDEX largely from a pin's destination, and an affiliate
   * redirect is the weakest destination there is: a domain we do not own and cannot claim,
   * with no page behind it to read. Fifty pins drew 23 impressions in a month and not one
   * appeared in search for its own exact title. This page is the opposite — our claimed
   * host, real content, and a buy button that already goes through the tracked link, so a
   * sale that starts on Pinterest stops being invisible.
   *
   * Returns null rather than a guess. The page renders a post only when it satisfies the
   * catalog query, so the same conditions are checked here: a pin aimed at a page that will
   * never render is worse than the redirect it replaced.
   */
  async postProductUrl(userId: string, post: {
    id?: string | null;
    product_id?: string | null;
    product_title?: string | null;
    price_ils?: number | null;
    affiliate_url?: string | null;
  }): Promise<string | null> {
    if (!post?.id || !post.product_id) return null;
    if (!String(post.product_title || '').trim()) return null;
    if (!(Number(post.price_ils) > 0)) return null;
    if (!String(post.affiliate_url || '').trim()) return null;

    const store = await this.repo
      .findOne({ where: { user_id: userId, enabled: true } })
      .catch(() => null);
    if (!store) return null;

    const base = this.storeUrl(store.slug);
    // FRONTEND_URL unset yields "/s/slug" — a relative path is not a destination a crawler
    // can follow, and handing Pinterest one would be worse than sending it nowhere.
    if (!/^https?:\/\//.test(base)) return null;
    // encodeURIComponent to match the link the store's own grid builds ("p:<uuid>").
    return `${base}/p/${encodeURIComponent(`p:${post.id}`)}`;
  }

  // ── Public side ────────────────────────────────────────────────────────────

  /** A live store by its address, or 404. A disabled store does not exist publicly. */
  async bySlug(slug: string): Promise<Storefront> {
    const store = await this.repo.findOne({ where: { slug: String(slug || '').toLowerCase() } });
    if (!store || !store.enabled) throw new NotFoundException('החנות לא נמצאה');
    return store;
  }

  /** The store's header, and the filter values that actually have products behind them. */
  async publicMeta(slug: string) {
    const store = await this.bySlug(slug);
    const catalog = await this.publicCatalog(store);
    const values = (pick: (p: StoreProduct) => string | null) => Array
      .from(new Set(catalog.map(pick).filter((v): v is string => !!v)))
      .sort((a, b) => a.localeCompare(b, 'he'));
    // The two accordions always have content — the owner's where they wrote one, the
    // standing default where they didn't. A product page must never ship with its two
    // most-read sections blank.
    const texts = storeTexts(store);
    return {
      slug: store.slug,
      name: store.name,
      tagline: store.tagline,
      whatsapp: store.whatsapp,
      shipping_text: texts.shipping_text,
      details_text: texts.details_text,
      brands: values((p) => p.brand),
      categories: values((p) => p.category),
      groups: values((p) => p.group),
    };
  }

  /**
   * A page of products, newest first.
   *
   * Deliberately one query per source rather than a UNION with pagination pushed into SQL:
   * the two catalogs have different shapes and different notions of "when", and a wrong
   * merge shows a customer the wrong price. Merged and paged here, where it is readable.
   */
  async publicProducts(slug: string, opts: {
    page?: number; brand?: string; group?: string; category?: string; q?: string;
    minPrice?: number; maxPrice?: number; sort?: string;
  } = {}): Promise<{
    products: StoreProduct[]; total: number; page: number; pages: number;
    priceRange: { min: number; max: number };
  }> {
    const store = await this.bySlug(slug);
    const sources = store.sources.split(',');
    const all: StoreProduct[] = [];

    if (sources.includes('suppliers')) all.push(...await this.supplierProducts(store));
    if (sources.includes('posts')) all.push(...await this.postProducts(store));

    // A product that is both in the supplier catalog and published keeps ONE card — the
    // supplier row wins, because it carries the gallery and the live stock flag.
    const seen = new Set<string>();
    let merged = all.filter((p) => {
      const key = `${p.title.trim().toLowerCase()}|${p.price}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // The slider's ends come from the WHOLE catalog, before any filter — bounds that
    // moved every time the shopper narrowed something would make the control unusable.
    const priceRange = priceBounds(merged);

    const q = (opts.q || '').trim().toLowerCase();
    if (q) merged = merged.filter((p) => p.title.toLowerCase().includes(q)
      || (p.brand || '').toLowerCase().includes(q));
    // Brand matching is case-insensitive: the same brand reaches the store in whatever
    // case the seller typed, and the chip the shopper clicked is only one of those.
    if (opts.brand) {
      const want = opts.brand.trim().toLowerCase();
      merged = merged.filter((p) => (p.brand || '').toLowerCase() === want);
    }
    if (opts.group) merged = merged.filter((p) => (p.group || '') === opts.group);
    if (opts.category) merged = merged.filter((p) => (p.category || '') === opts.category);
    if (Number.isFinite(opts.minPrice)) merged = merged.filter((p) => p.price >= (opts.minPrice as number));
    if (Number.isFinite(opts.maxPrice)) merged = merged.filter((p) => p.price <= (opts.maxPrice as number));

    merged.sort(sorter(opts.sort));

    const page = Math.max(1, Number(opts.page) || 1);
    const pages = Math.max(1, Math.ceil(merged.length / PAGE_SIZE));
    return {
      products: merged.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      total: merged.length,
      page,
      pages,
      priceRange,
    };
  }

  /** One product page, with the buy link already turned into a tracked one. */
  async publicProduct(slug: string, id: string): Promise<StoreProduct & { buy_url: string }> {
    const store = await this.bySlug(slug);
    const [kind, realId] = String(id || '').split(':');

    const product = kind === 'p'
      ? (await this.postProducts(store, realId))[0]
      : (await this.supplierProducts(store, realId))[0];
    if (!product) throw new NotFoundException('המוצר לא נמצא');

    return { ...product, buy_url: await this.buyUrl(store, kind, realId) };
  }

  /**
   * The tracked destination for the buy button.
   *
   * Routed through the same /r/<code> redirect the posts use, so a sale that started on
   * the store is not invisible to the learning engine — a store click and a channel click
   * are the same evidence about the same product, and only one of them was being counted.
   */
  private async buyUrl(store: Storefront, kind: string, realId: string): Promise<string> {
    const rows: Array<{ url: string; code: string | null }> = kind === 'p'
      ? await this.repo.query(
        `SELECT affiliate_url AS url, short_code AS code FROM posts WHERE id = $1 AND user_id = $2`,
        [realId, store.user_id])
      : await this.repo.query(
        `SELECT flylink_url AS url, NULL AS code FROM supplier_products WHERE id = $1 AND user_id = $2`,
        [realId, store.user_id]);
    const row = rows[0];
    if (!row?.url) throw new NotFoundException('למוצר הזה אין קישור רכישה');
    if (row.code) return this.links.shortUrl(row.code);

    // A supplier product has no post and therefore no code of its own; mint a durable one
    // so its store clicks are counted the same way.
    const code = await this.links.mintTarget(row.url, store.user_id).catch(() => null);
    return code ? this.links.shortUrl(code) : row.url;
  }

  // ── Catalog reads ──────────────────────────────────────────────────────────

  private async supplierProducts(store: Storefront, id?: string): Promise<StoreProduct[]> {
    const rows: any[] = await this.repo.query(
      `SELECT sp.id, sp.title, sp.description, sp.image_url, sp.gallery_json, sp.price,
              sp.currency, sp.last_posted_at, sp.created_at, sc.name AS catalog,
              sp.store_name, sp.store_category, sp.store_brand
       FROM supplier_products sp
       LEFT JOIN supplier_catalogs sc ON sc.id = sp.supplier_catalog_id
       WHERE sp.user_id = $1 AND sp.status = 'active'
         AND sp.flylink_url IS NOT NULL AND sp.flylink_url <> ''
         AND sp.in_stock IS DISTINCT FROM false
         AND sp.store_hidden IS DISTINCT FROM true
         ${id ? 'AND sp.id = $2' : ''}
       ORDER BY coalesce(sp.last_posted_at, sp.created_at) DESC
       LIMIT 500`,
      id ? [store.user_id, id] : [store.user_id],
    ).catch((err: any) => {
      this.logger.warn(`store supplier read failed: ${err?.message}`);
      return [];
    });

    return rows.map((r) => {
      // The supplier catalog's "description" is whatever was left of the album title after
      // the code came out — which means it arrives carrying the wreckage ("POLO- -5349",
      // "CHANEL $"). Cleaned here, or the brand FILTER becomes forty near-duplicates.
      // What the agent decided (or the owner corrected) always wins. The derived values
      // below are the fallback for a product it has not reached yet — a catalog does not
      // have to wait for the whole queue to drain before its shelf is readable.
      const brand = (r.store_brand ? String(r.store_brand).trim() : '')
        || brandDisplayName(r.description) || null;
      return {
        id: `s:${r.id}`,
        // A Yupoo album is titled with its stock code and wholesale price. The card needs
        // a name a shopper recognises, not the warehouse label.
        title: (r.store_name ? String(r.store_name).trim() : '')
          || storeCardName(String(r.title || ''), brand),
        brand,
        category: (r.store_category ? String(r.store_category).trim() : '') || null,
        image: r.image_url || null,
        gallery: this.parseGallery(r.gallery_json, r.image_url),
        price: Number(r.price) || 0,
        currency: r.currency || 'USD',
        source: 'supplier' as const,
        group: r.catalog ? String(r.catalog) : null,
        at: r.last_posted_at || r.created_at
          ? new Date(r.last_posted_at || r.created_at).toISOString() : null,
      };
    }).filter((p) => p.title && p.price > 0);
  }

  private async postProducts(store: Storefront, id?: string): Promise<StoreProduct[]> {
    // DISTINCT ON keeps the NEWEST post per product: the same deal published to three
    // groups, and every recycled rerun of it, is one shelf item — not four.
    const rows: any[] = await this.repo.query(
      `SELECT DISTINCT ON (p.product_id)
              p.id, p.product_id, p.product_title, p.product_image, p.gallery_json,
              p.price_ils, p.sent_at, p.keyword,
              coalesce(ch.name, c.name) AS grp
       FROM posts p
       LEFT JOIN channels ch ON ch.channel_id = p.channel_override AND ch.user_id = p.user_id
       LEFT JOIN campaigns c ON c.id = p.campaign_id
       WHERE p.user_id = $1 AND p.status = 'sent'
         AND p.product_id IS NOT NULL AND p.product_title <> '' AND p.price_ils > 0
         AND p.affiliate_url IS NOT NULL AND p.affiliate_url <> ''
         ${id ? 'AND p.id = $2' : ''}
       ORDER BY p.product_id, p.sent_at DESC
       LIMIT 500`,
      id ? [store.user_id, id] : [store.user_id],
    ).catch((err: any) => {
      this.logger.warn(`store post read failed: ${err?.message}`);
      return [];
    });

    return rows.map((r) => ({
      id: `p:${r.id}`,
      // An AliExpress title is written for AliExpress's own search box — a hundred and
      // twenty characters of every phrase a buyer might type. Not a name.
      title: storeCardName(String(r.product_title || ''), r.keyword),
      brand: brandDisplayName(r.keyword) || null,
      category: null,
      image: r.product_image || null,
      gallery: this.parseGallery(r.gallery_json, r.product_image),
      price: Number(r.price_ils) || 0,
      currency: 'ILS',
      source: 'post' as const,
      group: r.grp ? String(r.grp) : null,
      at: r.sent_at ? new Date(r.sent_at).toISOString() : null,
    })).filter((p) => p.title && p.price > 0);
  }

  private parseGallery(json: string | null, main: string | null): string[] {
    let list: string[] = [];
    try {
      const parsed = json ? JSON.parse(json) : [];
      if (Array.isArray(parsed)) list = parsed.map((s) => String(s)).filter(Boolean);
    } catch { list = []; }
    if (main && !list.includes(main)) list.unshift(main);
    return list.slice(0, 12);
  }



  private async publicCatalog(store: Storefront): Promise<StoreProduct[]> {
    const sources = store.sources.split(',');
    const out: StoreProduct[] = [];
    if (sources.includes('suppliers')) out.push(...await this.supplierProducts(store));
    if (sources.includes('posts')) out.push(...await this.postProducts(store));
    return out;
  }
}
