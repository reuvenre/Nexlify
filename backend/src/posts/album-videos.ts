/**
 * Videos picked into a post's album, alongside its photos.
 *
 * The owner picks photos and videos in one gallery, in one order (the numbers on the
 * thumbnails). Only Telegram can publish a mixed album, so the videos are NOT stored in
 * gallery_json: every other reader of the gallery (Facebook, Instagram, Pinterest, the
 * store, the Reels, the similarity de-dup) expects photos only. They live beside it in
 * `posts.album_videos` as `[{ url, at }]`, where `at` is the video's position in the
 * owner's selection, and the Telegram sender weaves them back in at those positions.
 *
 * Nothing is picked by default: a post carries a video only when the owner chose one.
 */

export interface AlbumVideo {
  url: string;
  /** Position in the owner's combined selection (0 = first in the album). */
  at: number;
}

/** Telegram's limit for one media group. */
export const MAX_ALBUM_ITEMS = 10;

/**
 * Split a combined selection into photos and videos. A URL counts as a video only when it
 * is one of `ownVideos` (the product's own album videos); anything else is left to the
 * photo validation, so a client cannot slip a foreign file in as a "video".
 */
export function splitSelection(selection: string[] | undefined, ownVideos: string[]): { photos: string[]; videos: AlbumVideo[] } {
  const own = new Set(ownVideos);
  const photos: string[] = [];
  const videos: AlbumVideo[] = [];
  const seen = new Set<string>();
  (selection || []).forEach((raw) => {
    const url = String(raw || '').trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    if (own.has(url)) videos.push({ url, at: photos.length + videos.length });
    else photos.push(url);
  });
  return { photos, videos };
}

/**
 * The album in the owner's order: photos in their own order, each video inserted at its
 * recorded position (clamped to the end), capped at Telegram's ten.
 */
export function mergeAlbum<T>(photos: T[], videos: AlbumVideo[], asVideo: (url: string) => T): T[] {
  const out = [...photos];
  [...videos].sort((a, b) => a.at - b.at).forEach((v) => {
    out.splice(Math.min(Math.max(0, v.at), out.length), 0, asVideo(v.url));
  });
  return out.slice(0, MAX_ALBUM_ITEMS);
}

/** Parse the stored column; tolerant of null and junk. */
export function parseAlbumVideos(json: string | null | undefined): AlbumVideo[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v)
      ? v.filter((x) => x && typeof x.url === 'string' && Number.isFinite(x.at)).map((x) => ({ url: x.url, at: Number(x.at) }))
      : [];
  } catch {
    return [];
  }
}
