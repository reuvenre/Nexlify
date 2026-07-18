import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';

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
   * Parse an album title into { code, price, description }. Stores format titles very
   * differently, e.g.:
   *   "LUN1526 $56.99 COACH"   (space-separated)
   *   "MM-68SM2606-$45"        (hyphen, no space, price stuck to the code)
   *   "MM-148A0B-$99.86 ADA"
   * So we find the price by its `$` anchor ANYWHERE (either side), strip it out, and
   * treat the first remaining token as the code and the rest as the description.
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
      const [codeRaw, ...descParts] = rest.split(' ');
      // Strip a separator left dangling on the code token (e.g. "MM-148A0B-" → "MM-148A0B");
      // internal hyphens are kept.
      const code = (codeRaw || '').replace(/^[$\-–—]+|[$\-–—]+$/g, '');
      return { code: code || title, price, description: descParts.join(' ').trim() };
    }

    // Legacy "CODE PRICE DESC" with no "$" (space-separated).
    const m = title.match(/^(\S+)\s+(\d+(?:[.,]\d+)?)\s+(.*)$/);
    if (m) return { code: m[1], price: parseFloat(m[2].replace(',', '.')) || 0, description: (m[3] || '').trim() };

    // No price in the title — first token is the code.
    const [code, ...rest] = title.split(' ');
    return { code: code || title, price: 0, description: rest.join(' ') };
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
          timeout: 14000, maxRedirects: 5, maxContentLength: 5 * 1024 * 1024,
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
    const uniqImages = [...new Set(images)];

    if (!code) throw new BadRequestException('לא נמצא קוד מוצר בכותרת האלבום ב-Yupoo');
    return {
      code, price, currency: 'USD', description,
      title: rawTitle, images: uniqImages, album_url: albumUrl,
    };
  }

  /** The brand categories of a store — for in-system browsing. */
  async fetchCategories(store: string, password?: string): Promise<Array<{ id: string; name: string }>> {
    const base = this.storeBase(store);
    const html = await this.get(`${base}/albums`, base + '/', password);
    const $ = cheerio.load(html);
    const out: Array<{ id: string; name: string }> = [];
    const seen = new Set<string>();
    $('a[href*="/categories/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const m = href.match(/\/categories\/(\d+)/);
      if (!m || seen.has(m[1])) return;
      const name = ($(el).text() || '').replace(/\s+/g, ' ').trim();
      if (!name) return;
      seen.add(m[1]);
      out.push({ id: m[1], name });
    });
    return out;
  }

  /**
   * Browse a store's albums (optionally within a category), paginated — so the whole
   * catalog is browsable from inside the app without visiting Yupoo. 120 albums/page.
   */
  async fetchStore(
    store: string,
    opts: { page?: number; categoryId?: string; password?: string } = {},
  ): Promise<{ items: Array<{ code: string; price: number; description: string; album_url: string; thumb?: string }>; hasMore: boolean }> {
    const base = this.storeBase(store);
    const page = Math.max(1, opts.page || 1);
    const path = opts.categoryId ? `/categories/${opts.categoryId}` : '/albums';
    const html = await this.get(`${base}${path}?page=${page}`, base + '/', opts.password);
    if (this.isLocked(html)) {
      throw new BadRequestException('החנות מוגנת בסיסמה — הגדר/תקן את סיסמת הקטלוג (Yupoo).');
    }
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
            row.thumb = u.replace(/\/(small|thumb)\.jpg/i, '/medium.jpg'); // sharper card
          }
        });
      }

      byAlbum.set(clean, row);
    });
    const items = [...byAlbum.values()].filter((r) => r.code);
    // A full page (Yupoo returns ~120) implies there's likely a next page.
    return { items, hasMore: items.length >= 100 };
  }
}
