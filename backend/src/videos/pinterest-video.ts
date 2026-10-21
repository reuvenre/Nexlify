/**
 * The English Reel as a Pinterest video pin — pure parts.
 *
 * Pinterest takes a video in three steps (API v5): register a media upload (`POST /v5/media`,
 * `media_type: video`), send the file to the upload URL it returns with every one of its
 * `upload_parameters` as form fields, wait for `GET /v5/media/<id>` to say `succeeded`, then
 * create the pin with `media_source: { source_type: 'video_id', media_id, cover_image_url }`.
 * Unlike a Reel, a pin carries a real link, so the video's call is «Tap to shop».
 */

/** Pinterest caps: title ≤ 100 characters, description ≤ 500. */
export const PIN_TITLE_MAX = 100;
export const PIN_DESCRIPTION_MAX = 500;
/** Said in the pin when the video opens with an AI clip, as the Reels' captions say it. */
export const AI_PIN_NOTE = '🤖 Video created with AI for illustration only — the product itself is as shown in the photos.';

const URL_LINE = /(https?:\/\/|www\.|t\.me\/|s\.click\.|aliexpress\.|bit\.ly\/)/i;

/**
 * The pin's title and description from the post's own pin copy (line one the title, the rest
 * the description, links dropped — the pin's `link` carries the destination).
 */
export function videoPinText(generatedText: string | null | undefined, productTitle: string | null | undefined, ai = false): { title: string; description: string } {
  const lines = String(generatedText || '').replace(/<\/?[^>]+>/g, '').split('\n')
    .map((l) => l.trim()).filter((l) => !URL_LINE.test(l));
  const nonEmpty = lines.filter(Boolean);
  const title = (nonEmpty[0] || String(productTitle || '') || 'Product').slice(0, PIN_TITLE_MAX);
  let description = nonEmpty.slice(1).join('\n').trim();
  if (ai) {
    const room = PIN_DESCRIPTION_MAX - AI_PIN_NOTE.length - 2;
    description = `${description.slice(0, Math.max(0, room)).trim()}\n\n${AI_PIN_NOTE}`.trim();
  }
  return { title, description: description.slice(0, PIN_DESCRIPTION_MAX) };
}

/** The registered upload: where to send the file, and the form fields to send with it. */
export function uploadTarget(body: any): { mediaId: string; url: string; fields: Record<string, string> } | null {
  const mediaId = body?.media_id ? String(body.media_id) : '';
  let url = '';
  try {
    const u = new URL(String(body?.upload_url || ''));
    if (u.protocol === 'https:') url = u.toString();
  } catch { /* not a URL */ }
  const params = body?.upload_parameters;
  if (!mediaId || !url || !params || typeof params !== 'object') return null;
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) if (typeof v === 'string' || typeof v === 'number') fields[k] = String(v);
  return { mediaId, url, fields };
}

/** A media status answer: still processing, ready, or failed. */
export function mediaState(body: any): 'pending' | 'done' | { failed: string } {
  const status = String(body?.status || '').toLowerCase();
  if (status === 'succeeded') return 'done';
  if (status === 'registered' || status === 'processing') return 'pending';
  return { failed: status ? `Pinterest media ${status}` : 'no media status' };
}
