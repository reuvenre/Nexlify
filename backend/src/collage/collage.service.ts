import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import sharp, { OverlayOptions } from 'sharp';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * Composes many product photos into a few grid "sheets" so an unlimited number of
 * images can be published inside a single Telegram album (which is hard-capped at 10
 * media). Each sheet is a clean grid on a white background; N images with `cells`
 * per sheet → ceil(N / cells) sheets.
 */
@Injectable()
export class CollageService {
  private readonly logger = new Logger(CollageService.name);

  /** Compose image URLs into JPEG grid sheets. `cells` per sheet: 4 (2×2), 6 (2×3) or 9 (3×3). */
  async compose(urls: string[], cells = 6): Promise<Buffer[]> {
    const perSheet = [4, 6, 9].includes(cells) ? cells : 6;
    const cols = perSheet >= 9 ? 3 : 2;
    const sheets: Buffer[] = [];
    // Diagnostics so a silent failure (Render sharp/binary or a blocked fetch) surfaces
    // in the post's error_message instead of quietly falling back to a plain album.
    const diag = { fetched: 0, fetchFail: 0, sharpFail: 0, firstErr: '' };
    const note = (e: any) => { if (!diag.firstErr) diag.firstErr = String(e?.message || e).slice(0, 200); };

    // Telegram albums cap at 10 — never emit more than 10 sheets.
    for (let i = 0; i < urls.length && sheets.length < 10; i += perSheet) {
      const sheet = await this.buildSheet(urls.slice(i, i + perSheet), cols, diag, note);
      if (sheet) sheets.push(sheet);
    }

    if (!sheets.length) {
      throw new Error(
        `collage produced 0 sheets — fetched ${diag.fetched}/${urls.length}, fetchFail ${diag.fetchFail}, sharpFail ${diag.sharpFail}${diag.firstErr ? ` — ${diag.firstErr}` : ''}`,
      );
    }
    return sheets;
  }

  private async buildSheet(
    urls: string[], cols: number,
    diag: { fetched: number; fetchFail: number; sharpFail: number; firstErr: string },
    note: (e: any) => void,
  ): Promise<Buffer | null> {
    const W = 1080, pad = 18, gap = 14, bg = '#ffffff';
    const rows = Math.ceil(urls.length / cols);
    const cellW = Math.floor((W - pad * 2 - gap * (cols - 1)) / cols);
    const cellH = Math.round((cellW * 5) / 4); // 4:5 portrait cells
    const H = pad * 2 + rows * cellH + gap * (rows - 1);

    const composites: OverlayOptions[] = [];
    for (let idx = 0; idx < urls.length; idx++) {
      const buf = await this.fetchImage(urls[idx]);
      if (!buf) { diag.fetchFail++; continue; }
      diag.fetched++;
      try {
        const cell = await sharp(buf)
          .resize(cellW, cellH, { fit: 'cover', position: 'centre' })
          .jpeg({ quality: 85 })
          .toBuffer();
        const r = Math.floor(idx / cols), c = idx % cols;
        composites.push({ input: cell, left: pad + c * (cellW + gap), top: pad + r * (cellH + gap) });
      } catch (e: any) {
        diag.sharpFail++; note(e);
        this.logger.warn(`collage cell failed: ${e?.message}`);
      }
    }
    if (!composites.length) return null;
    try {
      return await sharp({ create: { width: W, height: H, channels: 3, background: bg } })
        .composite(composites)
        .jpeg({ quality: 82 })
        .toBuffer();
    } catch (e: any) {
      diag.sharpFail++; note(e);
      this.logger.warn(`collage sheet composite failed: ${e?.message}`);
      return null;
    }
  }

  /**
   * Fetch image bytes. If the URL is our own /suppliers/image proxy, extract the raw
   * target and send the Yupoo Referer directly (avoids a self-request and the hotlink
   * block). Any yupoo.com URL also gets the Referer.
   */
  private async fetchImage(url: string): Promise<Buffer | null> {
    let target = url;
    let referer: string | undefined;
    const m = url.match(/[?&]url=([^&]+)/);
    if (/\/suppliers\/image/.test(url) && m) {
      target = decodeURIComponent(m[1]);
      referer = 'https://x.yupoo.com/';
    } else if (/yupoo\.com/i.test(url)) {
      referer = 'https://x.yupoo.com/';
    }
    try {
      const res = await axios.get(target, {
        responseType: 'arraybuffer',
        headers: { 'User-Agent': UA, ...(referer ? { Referer: referer } : {}) },
        timeout: 12000, maxContentLength: 8 * 1024 * 1024, validateStatus: () => true,
      });
      if (res.status !== 200) return null;
      return Buffer.from(res.data);
    } catch {
      return null;
    }
  }
}
