import { promptSafeTitle } from './ai-clip';

/**
 * The second AI opening for a Reel: the product photo brought to life on fal.ai — pure parts.
 *
 * Wan 3.0 image-to-video takes a first AND a last frame. Both are the product photo, so the
 * clip opens on the real product and closes on it, moving only in between (a push-in, a turn,
 * light sweeping across). That keeps what the viewer sees anchored to the listing's own photo,
 * where the Gemini clip invents a whole unboxing scene around it.
 *
 * It runs beside Gemini, not instead of it: with both keys on the account the Reels alternate
 * (`pickClipProvider`), and each Reel records which engine opened it (`clip_provider`), so the
 * owner can compare them. The request schema is fal's own (verified 2026-10-03, as OpenMontage
 * pins it); fal prices it per second of video, and the daily cap is the Gemini one.
 */

export const FAL_CLIP_ENDPOINT = 'alibaba/wan-3.0/image-to-video';
export const FAL_QUEUE = 'https://queue.fal.run';
/** Seconds of video asked for: the Reel's opening, before the price (longer scenes hold the last frame). */
export const FAL_CLIP_SECONDS = 6;

export type ClipProvider = 'gemini' | 'fal';
export const CLIP_PROVIDER_LABEL: Record<ClipProvider, string> = { gemini: 'Gemini', fal: 'Wan 3.0 דרך fal' };

/**
 * Which engine opens this Reel. REELS_AI_PROVIDER=gemini|fal forces one (when its key is
 * there); otherwise both keys alternate with the last AI clip, and one key is that engine.
 */
export function pickClipProvider(o: { setting?: string; hasGemini: boolean; hasFal: boolean; last?: string | null }): ClipProvider | null {
  const setting = String(o.setting || '').trim().toLowerCase();
  if (setting === 'gemini') return o.hasGemini ? 'gemini' : null;
  if (setting === 'fal') return o.hasFal ? 'fal' : null;
  if (o.hasGemini && o.hasFal) return o.last === 'fal' ? 'gemini' : 'fal';
  return o.hasFal ? 'fal' : o.hasGemini ? 'gemini' : null;
}

export function falClipPrompt(title: string | null | undefined): string {
  const product = promptSafeTitle(title) || 'the product in the image';
  return [
    'Bring this product photo to life for a short vertical product ad, photorealistic.',
    'The camera slowly pushes in and gently orbits while soft studio light sweeps across the product, revealing its shape, texture and details,',
    'then eases back so the last frame matches the first frame exactly.',
    'The product must stay identical to the image: same shape, colors, proportions, parts and printing. Do not add, remove or change any detail, accessory or feature.',
    'No people, no hands, no text, no captions, no added logos, no added objects.',
    `The product is: ${product}.`,
  ].join(' ');
}

/** The queue request: the photo as both the first and the last frame, silent, 720p. */
export function falClipRequest(imageDataUri: string, title: string | null | undefined) {
  return {
    prompt: falClipPrompt(title),
    start_image_url: imageDataUri,
    end_image_url: imageDataUri,
    // The photo's own shape: a square listing photo stays square, shown in the Reel's card.
    aspect_ratio: 'adaptive',
    resolution: '720p',
    duration: FAL_CLIP_SECONDS,
    audio: false,
    enable_prompt_expansion: true,
  };
}

/** fal's status and result links, only when they are fal's own queue (never a URL from elsewhere). */
export function falJobLinks(body: any): { status: string; response: string } | null {
  const ok = (u: unknown) => {
    try {
      const url = new URL(String(u));
      return url.protocol === 'https:' && url.hostname === 'queue.fal.run';
    } catch { return false; }
  };
  return ok(body?.status_url) && ok(body?.response_url) ? { status: String(body.status_url), response: String(body.response_url) } : null;
}

/** A status answer: still going, done, or failed with the reason. */
export function falStatus(body: any): 'pending' | 'done' | { failed: string } {
  const status = String(body?.status || '').toUpperCase();
  if (status === 'COMPLETED') return body?.error ? { failed: String(body.error).slice(0, 200) } : 'done';
  if (status === 'IN_QUEUE' || status === 'IN_PROGRESS') return 'pending';
  return { failed: status ? `status ${status}` : 'no status' };
}

/** The finished video's link in a result body, https only. */
export function falVideoUrl(body: any): string | null {
  const url = body?.video?.url;
  return typeof url === 'string' && /^https:\/\//i.test(url) ? url : null;
}
