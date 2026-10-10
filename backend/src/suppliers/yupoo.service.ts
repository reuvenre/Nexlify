import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { assertSafeOutboundUrl } from '../common/ssrf';
import { dedupeProductImages } from './yupoo-image';

export interface YupooItem {
  code: string;        // raw code from the title, e.g. "LUN1526"
  price: number;       // parsed from the title
  currency: string;
  description: string; // remainder of the title, e.g. "COACH"
  title: string;       // full original title
  images: string[];    // real product photos
  album_url: string;
}

// Browser-like headers get past Yupoo's anti-bot (verified: plain requests → HTTP 567).
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,he;q=0.8',
  'Upgrade-Insecure-Requests': '1',
};

/**
 * Extracts product content from a public Yupoo store. Album titles carry
 * "CODE $PRICE DESCRIPTION" (e.g. "LUN1526 $56.99 COACH") and product photos
 * live on photo.yupoo.com — confirmed live. Pure axios + cheerio (no headless).
 */
@Injectable()
export class YupooService {
  private readonly logger = new Logger(YupooService.name);

  /**
   * A token that looks like a real product code: it carries letters AND a run of at least
   * three digits — "ZT12681", "HE7160", "LUN1526", "MM-68SM2606", "MM-148A0B".
   *
   * The three-digit floor is what separates a code from the noise around it: brand words
   * ("adidas", "AP", "POLO") have no digits, model words ("Pro3", "Buds4") have one, and a
   * bare year ("2024") has no letters. Without it, a store that writes the price first and
   * the brand before the code — "$110 AP ZT12681" — yielded "AP" as the product code, and
   * every album of that brand then collapsed onto the same SKU.
   */
  private static readonly CODE_TOKEN = /^(?=.*[A-Za-z])(?=.*\d{3})[A-Za-z0-9][A-Za-z0-9\-_]*$/;

  /**
   * Pick the product code out of the tokens left after the price is removed. Falls back to
   * the first token — the historical behaviour — when nothing looks like a code, so a store
   * whose codes don't fit the shape keeps working exactly as before.
   */
  private pickCode(tokens: string[]): string {
    const clean = tokens
      .map((t) => t.replace(/^[$\-–—]+|[$\-–—]+$/g, ''))
      .filter(Boolean);
    return clean.find((t) => YupooService.CODE_TOKEN.test(t)) || clean[0] || '';
  }

  /**
   * Parse an album title into { code, price, description }. Stores format titles very
   * differently, e.g.:
   *   "LUN1526 $56.99 COACH"   (space-separated)
   *   "MM-68SM2606-$45"        (hyphen, no space, price stuck to the code)
   *   "MM-148A0B-$99.86 ADA"
   *   "$110 AP ZT12681"        (price first, brand before the code)
   * So we find the price by its `$` anchor ANYWHERE (either side), strip it out, and pick
   * the code-shaped token out of what remains.
   */
  private parseTitle(raw: string): { code: string; price: number; description: string } {
    const title = (raw || '').replace(/\s+/g, ' ').trim();

    // Price = a number adjacent to a "$" (dollar on either side), anywhere in the title.
    const priceMatch = title.match(/\$\s*(\d+(?:[.,]\d+)?)/) || title.match(/(\d+(?:[.,]\d+)?)\s*\$/);
    if (priceMatch) {
      const price = parseFloat(priceMatch[1].replace(',', '.')) || 0;
      // Remove the "$price" token, then trim stray separators ($ - – — spaces) left behind.
      // Internal hyphens in the code (MM-68SM2606) are preserved.
      const rest = title.replace(priceMatch[0], ' ')
        .replace(/^[\s$\-–—]+|[\s$\-–—]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      // Separators left dangling on a token (e.g. "MM-148A0B-") are stripped by pickCode;
      // internal hyphens are kept.
      const tokens = rest.split(' ');
      const code = this.pickCode(tokens);
      const description = tokens.filter((t) => t !== code).join(' ').trim();
      return { code: code || title, price, description };
    }

    // Legacy "CODE PRICE DESC" with no "$" (space-separated).
    const m = title.match(/^(\S+)\s+(\d+(?:[.,]\d+)?)\s+(.*)$/);
    if (m) return { code: m[1], price: parseFloat(m[2].replace(',', '.')) || 0, description: (m[3] || '').trim() };

    // No price in the title.
    const tokens = title.split(' ');
    const code = this.pickCode(tokens);
    return { code: code || title, price: 0, description: tokens.filter((t) => t !== code).join(' ').trim() };
  }

  private base(url: string): string {
    try { const u = new URL(url); return `${u.protocol}//${u.host}`; } catch { return url; }
  }

  /**
   * Accept EITHER a bare store slug ("seppuyukeji") OR a full URL
   * ("https://seppuyukeji.x.yupoo.com") and return the canonical base URL.
   * Users naturally paste the full URL — building `https://${input}.x.yupoo.com`
   * on a full URL produced a malformed host and a 500.
   */
  private storeBase(input: string): string {
    const s = (input || '').trim();
    const m = s.match(/^https?:\/\/([^./]+)\.x\.yupoo\.com/i);
    const slug = m ? m[1] : s.replace(/^https?:\/\//, '').split(/[./]/)[0];
    return `https://${slug}.x.yupoo.com`;
  }

  private async get(url: string, referer: string, password?: string): Promise<string> {
    // SSRF guard: this URL comes straight from user input (catalog/album URL). Restrict it to
    // Yupoo hosts and never follow redirects — otherwise a user could point it at cloud
    // metadata / internal services and exfiltrate the response (title/headings/images).
    assertSafeOutboundUrl(url, { allowHost: /(^|\.)yupoo\.com$/i });
    // A password-protected ("index-lock") store unlocks with the `indexlockcode` cookie set
    // to the password — proven live (cookie alone → full album list, no verify call needed).
    const cookie = password ? { Cookie: `indexlockcode=${encodeURIComponent(password)}` } : {};
    // Render→Yupoo can be slow/intermittent (a single 12s attempt often ECONNABORTED).
    // Retry with backoff before giving up; keep the total under the caller's HTTP timeout.
    let lastMsg = 'network error';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await axios.get(url, {
          headers: { ...BROWSER_HEADERS, ...cookie, Referer: referer },
          timeout: 14000, maxRedirects: 0, maxContentLength: 5 * 1024 * 1024,
          validateStatus: () => true,
        });
        if (res.status === 200 && typeof res.data === 'string') return res.data;
        lastMsg = `HTTP ${res.status}`; // e.g. 567 anti-bot — worth a retry
      } catch (err: any) {
        lastMsg = err?.code || err?.message || 'network error';
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
    }
    throw new BadRequestException(`לא ניתן להגיע ל-Yupoo — בדוק את כתובת/שם החנות (${lastMsg})`);
  }

  /** Yupoo's index-lock overlay marker — present when the store is password-gated + not unlocked. */
  private isLocked(html: string): boolean {
    return /indexlock__main|主页已加密/.test(html);
  }

  /** Fetch a single album page → the product content. `password` unlocks a gated store. */
  async fetchAlbum(albumUrl: string, password?: string): Promise<YupooItem> {
    const base = this.base(albumUrl);
    const html = await this.get(albumUrl, base + '/', password);
    if (this.isLocked(html)) {
      throw new BadRequestException('החנות מוגנת בסיסמה — הגדר/תקן את סיסמת הקטלוג (Yupoo).');
    }
    const $ = cheerio.load(html);

    const rawTitle = ($('.showalbumheader__gallerytitle').first().text()
      || $('h1,h2').first().text()
      || $('title').text().split('|')[0]
      || '').trim();
    const { code, price, description } = this.parseTitle(rawTitle);

    // Real product photos live on photo.yupoo.com/{store}/... — exclude site assets (s.yupoo.com).
    const images: string[] = [];
    $('img').each((_, el) => {
      let src = $(el).attr('data-src') || $(el).attr('data-origin-src') || $(el).attr('src') || '';
      if (src.startsWith('//')) src = 'https:' + src;
      if (/photo\.yupoo\.com/i.test(src) && !/s\.yupoo\.com/i.test(src)) {
        images.push(src.replace(/\/(small|thumb)\.jpg/i, '/medium.jpg'));
      }
    });
    // One entry per real photo: the album renders the same shot at several sizes, and an
    // exact-URL dedup let all of them in — the catalog then showed duplicates, with the
    // low-res twin blurry once blown up to post size. See yupoo-image.ts.
    const uniqImages = dedupeProductImages(images);

    if (!code) throw new BadRequestException('לא נמצא קוד מוצר בכותרת האלבום ב-Yupoo');
    return {
      code, price, currency: 'USD', description,
      title: rawTitle, images: uniqImages, album_url: albumUrl,
    };
  }

  /** The brand categories of a store — for in-system browsing. */
  async fetchCategories(store: string, password?: string): Promise<Array<{ id: string; name: string; isSubCate: boolean }>> {
    const base = this.storeBase(store);
    const html = await this.get(`${base}/albums`, base + '/', password);
    const $ = cheerio.load(html);
    const out: Array<{ id: string; name: string; isSubCate: boolean }> = [];
    const seen = new Set<string>();
    $('a[href*="/categories/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const m = href.match(/\/categories\/(\d+)/);
      if (!m || seen.has(m[1])) return;
      const name = ($(el).text() || '').replace(/\s+/g, ' ').trim();
      if (!name) return;
      seen.add(m[1]);
      // SUB-categories must be fetched with ?isSubCate=true or Yupoo returns 404/empty;
      // top-level categories must be fetched WITHOUT it. Preserve which one this is.
      out.push({ id: m[1], name, isSubCate: /isSubCate=true/i.test(href) });
    });
    return out;
  }

  /**
   * Browse a store's albums (optionally within a category), paginated — so the whole
   * catalog is browsable from inside the app without visiting Yupoo. 120 albums/page.
   */
  async fetchStore(
    store: string,
    opts: { page?: number; categoryId?: string; isSubCate?: boolean; password?: string } = {},
  ): Promise<{ items: Array<{ code: string; price: number; description: string; album_url: string; thumb?: string }>; hasMore: boolean }> {
    const base = this.storeBase(store);
    const page = Math.max(1, opts.page || 1);
    const params = new URLSearchParams({ page: String(page) });
    // A sub-category 404s / returns empty unless fetched with isSubCate=true; a top-level
    // category 404s WITH it. The caller passes which kind this category is.
    if (opts.categoryId && opts.isSubCate) params.set('isSubCate', 'true');
    const path = opts.categoryId ? `/categories/${opts.categoryId}` : '/albums';
    const html = await this.get(`${base}${path}?${params.toString()}`, base + '/', opts.password);
    if (this.isLocked(html)) {
      throw new BadRequestException('החנות מוגנת בסיסמה — הגדר/תקן את סיסמת הקטלוג (Yupoo).');
    }
    return this.parseAlbumCards(html, base);
  }

  /**
   * Search a store's albums by the words in their titles — Yupoo's own store search
   * (`/search/album?q=`), the same box a visitor uses on the site. Titles are what the
   * supplier wrote: product codes, English, and Chinese, so a Hebrew word finds nothing.
   * Results are ranked by Yupoo (an exact code first) and paged 120 at a time, in the
   * same album-card markup as the store listing.
   */
  async searchStore(
    store: string,
    query: string,
    opts: { page?: number; password?: string } = {},
  ): Promise<{ items: Array<{ code: string; price: number; description: string; album_url: string; thumb?: string }>; hasMore: boolean }> {
    const q = (query || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!q) return { items: [], hasMore: false };
    const base = this.storeBase(store);
    const page = Math.max(1, opts.page || 1);
    const params = new URLSearchParams({ uid: '1', sort: '', q, page: String(page) });
    const html = await this.get(`${base}/search/album?${params.toString()}`, base + '/', opts.password);
    if (this.isLocked(html)) {
      throw new BadRequestException('החנות מוגנת בסיסמה — הגדר/תקן את סיסמת הקטלוג (Yupoo).');
    }
    return this.parseAlbumCards(html, base);
  }

  /** The album cards of a listing page (store, category or search results). */
  private parseAlbumCards(html: string, base: string): { items: Array<{ code: string; price: number; description: string; album_url: string; thumb?: string }>; hasMore: boolean } {
    const $ = cheerio.load(html);
    // Each album card has TWO <a> to the same /albums/<id>: an IMAGE link (real
    // photo.yupoo.com src, no title) and a TITLE link (the title, but a lazy 1x1
    // placeholder img). Reading both from a single <a> grabbed the placeholder — so
    // merge per album href: title from whichever <a> has it, thumb from whichever <a>
    // carries a real photo.yupoo.com image.
    type Row = { code: string; price: number; description: string; album_url: string; thumb?: string };
    const byAlbum = new Map<string, Row>();
    $('a[href*="/albums/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!/\/albums\/\d+/.test(href)) return;
      const clean = href.split('?')[0];
      const row: Row = byAlbum.get(clean) || {
        code: '', price: 0, description: '',
        album_url: href.startsWith('http') ? href : base + href,
      };

      if (!row.code) {
        const rawTitle = ($(el).attr('title') || $(el).text() || '').trim();
        if (rawTitle) {
          const { code, price, description } = this.parseTitle(rawTitle);
          row.code = code; row.price = price; row.description = description;
        }
      }

      if (!row.thumb) {
        $(el).find('img').each((__, img) => {
          if (row.thumb) return;
          let u = $(img).attr('data-src') || $(img).attr('data-origin-src') || $(img).attr('src') || '';
          if (u.startsWith('//')) u = 'https:' + u;
          // Only a REAL product photo — skip the lazy 1x1 data: placeholder and site assets.
          if (/photo\.yupoo\.com/i.test(u)) {
            row.thumb = u.replace(/\/(small|thumb)\.(jpe?g)/i, '/medium.$2'); // sharper card
          }
        });
      }

      byAlbum.set(clean, row);
    });
    const items = [...byAlbum.values()].filter((r) => r.code);
    // A full page (Yupoo returns ~120) implies there's likely a next page.
    // The pager's "next" button carries an href only when there is a next page (共29页);
    // a full page (Yupoo returns ~120) is the fallback signal for markup without it.
    const next = $('a.pagination__button[title="后一页"]').attr('href');
    return { items, hasMore: !!next || items.length >= 100 };
  }
}
