/**
 * The AI opening clip, for a product with no seller video — pure parts.
 *
 * Gemini Omni Flash (Gemini API, Interactions endpoint) turns the product photo and a
 * description into a short vertical clip: hands unboxing the product. Paid tier only,
 * about $0.10 per second of 720p video, so it is opt-in (REELS_AI_VIDEO=1) and capped per day.
 *
 * The clip must not promise more than the product is. The prompt pins the product to the
 * reference photo, keeps people out of it except hands, and asks for no text, logos or speech;
 * the Reel labels it on screen and in the caption as an AI demonstration.
 */

export const AI_CLIP_MODEL_DEFAULT = 'gemini-omni-1.1-flash';
/** AI clips per day, across the account — each costs real money. */
export const DEFAULT_AI_CLIPS_PER_DAY = 2;
/** The line added to a caption when the Reel opens with an AI clip. */
export const AI_CAPTION_NOTE = '🤖 הסרטון נוצר באמצעות AI להמחשה בלבד — המוצר עצמו כפי שבתמונות.';

/** The seller's title as plain words for the prompt — it is a stranger's text. */
export function promptSafeTitle(title: string | null | undefined): string {
  return String(title || '')
    .replace(/[^\p{L}\p{N}\s.,'-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export function aiClipPrompt(title: string | null | undefined): string {
  const product = promptSafeTitle(title) || 'the product in the reference image';
  return [
    'Vertical 9:16 product video for a social media ad, about 7 seconds, photorealistic.',
    'Only hands are visible (no face, no full person). The hands open a plain brown cardboard shipping box on a clean wooden table,',
    'lift out exactly the product shown in the reference image, and slowly turn it toward the camera.',
    'The product must stay identical to the reference image: same shape, colors, proportions and parts. Do not add, remove or change any detail, accessory or feature.',
    'Soft natural daylight, shallow depth of field, steady close-up camera.',
    'No text, no captions, no logos, no brand names, no speech, no music.',
    `The product is: ${product}.`,
  ].join(' ');
}

/** The Interactions request: the photo, then the prompt, vertical 720p video out. */
export function aiClipRequest(model: string, imageBase64: string, mime: string, title: string | null | undefined) {
  return {
    model,
    input: [
      { type: 'image', data: imageBase64, mime_type: mime },
      { type: 'text', text: aiClipPrompt(title) },
    ],
    response_format: { type: 'video', aspect_ratio: '9:16', resolution: '720p' },
  };
}

/**
 * The video out of a REST Interactions answer: steps[].content[] of type "video", base64.
 * Null with the reason when there is none (blocked, failed, still running).
 */
export function readInteractionVideo(body: any): { video: Buffer | null; reason?: string } {
  for (const step of Array.isArray(body?.steps) ? body.steps : []) {
    for (const part of Array.isArray(step?.content) ? step.content : []) {
      if (part?.type === 'video' && typeof part.data === 'string' && part.data.length > 100) {
        return { video: Buffer.from(part.data, 'base64') };
      }
    }
  }
  const status = body?.status ? `status ${body.status}` : 'no video in the answer';
  const why = body?.error?.message || body?.steps?.find?.((s: any) => s?.type === 'model_output')?.content?.find?.((c: any) => c?.type === 'text')?.text;
  return { video: null, reason: why ? `${status}: ${String(why).slice(0, 200)}` : status };
}
