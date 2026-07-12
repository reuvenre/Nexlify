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

  /** Parse "LUN1526 $56.99 COACH" → { code, price, description }. */
  private parseTitle(raw: string): { code: string; price: number; description: string } {
    const title = (raw || '').replace(/\s+/g, ' ').trim();
    const m = title.match(/^(\S+)\s+\$?\s*([\d.]+)\s*(.*)$/);
    if (m) return { code: m[1], price: parseFloat(m[2]) || 0, description: (m[3] || '').trim() };
    // No price in the title — take the first token as the code.
    const [code, ...rest] = title.split(' ');
    return { code: code || title, price: 0, description: rest.join(' ') };
  }

  private base(url: string): string {
    try { const u = new URL(url); return `${u.protocol}//${u.host}`; } catch { return url; }
  }

  private async get(url: string, referer: string): Promise<string> {
    const res = await axios.get(url, {
      headers: { ...BROWSER_HEADERS, Referer: referer },
      timeout: 12000, maxRedirects: 5, maxContentLength: 5 * 1024 * 1024,
      validateStatus: () => true,
    });
    if (res.status !== 200 || typeof res.data !== 'string') {
      throw new BadRequestException(`Yupoo לא נגיש (HTTP ${res.status}) — ייתכן חסימת אנטי-בוט`);
    }
    return res.data;
  }

  /** Fetch a single album page → the product content. */
  async fetchAlbum(albumUrl: string): Promise<YupooItem> {
    const base = this.base(albumUrl);
    const html = await this.get(albumUrl, base + '/');
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

  /** List every album in a store (for bulk browse/import) → light metadata. */
  async fetchStore(store: string): Promise<Array<{ code: string; price: number; description: string; album_url: string; thumb?: string }>> {
    const base = `https://${store}.x.yupoo.com`;
    const html = await this.get(`${base}/albums`, base + '/');
    const $ = cheerio.load(html);
    const out: Array<{ code: string; price: number; description: string; album_url: string; thumb?: string }> = [];
    const seen = new Set<string>();
    $('a[href*="/albums/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!/\/albums\/\d+/.test(href) || seen.has(href)) return;
      seen.add(href);
      const rawTitle = ($(el).attr('title') || $(el).text() || '').trim();
      if (!rawTitle) return;
      const { code, price, description } = this.parseTitle(rawTitle);
      let thumb = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || undefined;
      if (thumb && thumb.startsWith('//')) thumb = 'https:' + thumb;
      out.push({ code, price, description, album_url: href.startsWith('http') ? href : base + href, thumb });
    });
    return out;
  }
}
