import { ReelSpec } from './reel-spec';

/**
 * The finished Reel as a file for the platforms we cannot publish to — pure parts.
 *
 * TikTok's posting API needs an audited app, and YouTube keeps an unverified app's uploads
 * private, so neither can be published to directly. The owner gets the MP4 in his Telegram
 * chat instead (one 9:16 render fits Reels, TikTok and Shorts alike), with the text ready to
 * paste: save the video, open the app, paste, post.
 *
 * Not Pinterest: the board is the US audience's, in English, and these Reels are Hebrew.
 */

/** The hashtags every shared Reel carries, unless REELS_HASHTAGS replaces them. */
export const DEFAULT_HASHTAGS = ['#אליאקספרס', '#דילים', '#מוצרים_מומלצים'];
/** Telegram caps a media caption at 1024 characters. */
export const TELEGRAM_CAPTION_MAX = 1024;
/** The AI clip must be disclosed on TikTok too — with its own switch at upload. */
export const AI_UPLOAD_NOTE = '⚠️ הסרטון פותח בקליק AI: בהעלאה לטיקטוק הפעל «תוכן שנוצר ב-AI», וב-YouTube סמן «תוכן משונה או סינתטי».';

/** A hashtag from a name: spaces become underscores, anything but letters and digits goes. */
export function toHashtag(name: string | null | undefined): string {
  const tag = String(name || '').trim().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_]/gu, '');
  return tag.length >= 2 ? `#${tag}` : '';
}

/** REELS_HASHTAGS ("#a #b", or "a, b"), else the defaults. */
export function hashtagsFrom(env: string | undefined): string[] {
  const own = String(env || '').split(/[\s,]+/).map((t) => toHashtag(t.replace(/^#/, ''))).filter(Boolean);
  return own.length ? own : DEFAULT_HASHTAGS;
}

/**
 * The text to paste under the video on TikTok and Shorts: the hook, the reason, the price,
 * where the link is, the hashtags (the group's name first). The Shorts title is the hook
 * plus #shorts, within YouTube's 100 characters.
 */
export function shareText(spec: Pick<ReelSpec, 'headline' | 'reason' | 'price' | 'was' | 'cta' | 'brand'>, tags: string[], ai = false): { caption: string; shortsTitle: string } {
  const head = spec.headline.replace(/…$/, '').trim();
  const price = spec.was ? `${spec.price} במקום ${spec.was}` : spec.price;
  const hashtags = [...new Set([toHashtag(spec.brand), ...tags].filter(Boolean))].join(' ');
  const body = [head, spec.reason, `💰 ${price}`, spec.cta].filter(Boolean).join('\n');
  const caption = [body, hashtags, ai ? '🤖 הסרטון נוצר באמצעות AI להמחשה בלבד.' : ''].filter(Boolean).join('\n\n');
  const room = 100 - ' #shorts'.length;
  const shortsTitle = `${head.length > room ? `${head.slice(0, room - 1).trim()}…` : head} #shorts`;
  return { caption, shortsTitle };
}

/** The message under the video in the owner's chat: what happened, then how to reuse it. */
export function ownerVideoCaption(status: string, ai: boolean): string {
  const how = '📲 לטיקטוק ול-YouTube Shorts: שמור את הסרטון, והדבק את הטקסט מההודעה הבאה.';
  const text = [status, '', how, ...(ai ? [AI_UPLOAD_NOTE] : [])].join('\n');
  return text.length > TELEGRAM_CAPTION_MAX ? `${text.slice(0, TELEGRAM_CAPTION_MAX - 1)}…` : text;
}
