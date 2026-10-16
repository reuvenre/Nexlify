/**
 * The videos of a Yupoo album.
 *
 * An album mixes photos and videos in one gallery. A video entry is an <img> whose
 * `data-type="video"`: its src is only the cover frame (on uvd.yupoo.com, not
 * photo.yupoo.com), and the clip itself is named by two attributes Yupoo's own player
 * reads (s.yupoo.com common.js, VIDEO_ORIGIN = '//uvd.yupoo.com'):
 *
 *   data-path="/minkang/13591294.mp4"          the uploaded file
 *   data-videoformats="v1080p,v720p,v480p"     transcoded renditions, or "transcoding" /
 *                                              "retrying" / "fail" / "" while not ready
 *
 * The player builds `//uvd.yupoo.com/<format without its "v">/<path>` per rendition —
 * e.g. https://uvd.yupoo.com/720p/minkang/13591294.mp4. Verified live: those files are
 * plain mp4 with range support and, unlike the photos, are not hotlink-protected.
 *
 * The scraper read only photo.yupoo.com images, so a video entry fell out entirely: the
 * owner saw videos on Yupoo and none of them in the system.
 */

export interface YupooVideo {
  /** A playable mp4 (a transcoded rendition when one exists). */
  url: string;
  /** The cover frame, for a poster. */
  thumb: string;
}

const ORIGIN = 'https://uvd.yupoo.com';

/**
 * Telegram fetches a video by URL only up to 20 MB, and a feed shows it small anyway, so
 * 720p is the first choice and 1080p the last.
 */
const PREFERRED = ['720p', '480p', '1080p', '360p'];

const absolute = (u: string) => (u.startsWith('//') ? `https:${u}` : u);

/**
 * The mp4 to play for one video entry, or null when there is nothing playable yet.
 * `path` is the album's data-path, `formats` its data-videoformats.
 */
export function yupooVideoUrl(path: string | undefined | null, formats: string | undefined | null): string | null {
  const p = String(path || '').trim();
  if (!p || /^https?:/i.test(p) || p.includes('..')) return null;
  const file = (p.startsWith('/') ? p : `/${p}`).replace(/\.\w+$/, '.mp4');

  const available = String(formats || '')
    .split(',')
    .map((f) => f.trim().replace(/^\/+|\/+$/g, '').replace(/^v/i, ''))
    .filter((f) => /^\d{3,4}p$/i.test(f));
  if (available.length) {
    const pick = PREFERRED.find((f) => available.includes(f)) || available[0];
    return `${ORIGIN}/${pick}${file}`;
  }
  // Not transcoded (yet). The upload itself plays only when it already is an mp4 — a .mov
  // would download instead of playing in a browser and Telegram rejects it.
  return /\.mp4$/i.test(p) ? `${ORIGIN}${p.startsWith('/') ? p : `/${p}`}` : null;
}

/** A minimal cheerio-like surface, so this stays testable without a page. */
type Attr = (name: string) => string | undefined;

/**
 * Every playable video of an album, in gallery order, one per uploaded file. Accepts the
 * attribute readers of the album's video <img> elements.
 */
export function collectYupooVideos(entries: Attr[]): YupooVideo[] {
  const out: YupooVideo[] = [];
  const seen = new Set<string>();
  for (const attr of entries) {
    const path = attr('data-path');
    // The page renders each video twice (gallery + viewer strip); only the gallery entry
    // carries data-path, and the path is the identity.
    if (!path || seen.has(path)) continue;
    const url = yupooVideoUrl(path, attr('data-videoformats'));
    if (!url) continue;
    seen.add(path);
    const thumb = absolute(attr('data-src') || attr('data-origin-src') || attr('src') || '');
    out.push({ url, thumb: /^https:\/\/[^/]*yupoo\.com\//i.test(thumb) ? thumb : '' });
  }
  return out;
}

/** Parse a stored `videos_json` column; tolerant of null and junk. */
export function parseVideos(json: string | null | undefined): YupooVideo[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v)
      ? v.filter((x) => x && typeof x.url === 'string' && /^https:\/\/uvd\.yupoo\.com\//i.test(x.url))
        .map((x) => ({ url: x.url, thumb: typeof x.thumb === 'string' ? x.thumb : '' }))
      : [];
  } catch {
    return [];
  }
}

/** Is this a video we read from Yupoo (and so safe to publish as the post's clip)? */
export function isYupooVideoUrl(url: string | null | undefined): boolean {
  return /^https:\/\/uvd\.yupoo\.com\/[\w/.-]+\.mp4$/i.test(String(url || ''));
}
