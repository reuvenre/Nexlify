/**
 * Which FAILED posts go back to the queue by themselves.
 *
 * A post that failed on every channel used to stay `failed` for good. network-partial.ts
 * only retries posts that reached SOME channel (`sent` with an error), so a lone Telegram
 * post that met a connection drop or a 502 lost its product, and the owner asked why it
 * never came back for another try (20.11.2026).
 *
 * Only failures where the platform provably did not publish qualify, because a second
 * send of anything else can put the same product in the group twice:
 * - the sender's connect-phase tag (NET_SAFE_TAG): the request never left;
 * - Telegram answering 429 "Too Many Requests" (it refused, nothing went out);
 * - Telegram answering 502 "Bad Gateway" (its front door could not reach the Bot API).
 * Not a timeout on an open socket, not "server may have restarted during send" (the post
 * may already be live), not a refused token, a missing chat or empty credits: those fail
 * the same way again, or need the owner.
 */
import { isProvablyUnpublished } from './network-partial';

/**
 * Where a send stands, written into a `pending` row's error_message (every outcome rewrites
 * it). PREPARING: the send started and no platform was called yet. SENDING: a platform may
 * now publish. A server that dies on a PREPARING row lost nothing, so the stuck-post cleanup
 * sends it again; one that dies on a SENDING row may have published, so that stays failed.
 */
export const PREPARING_MARK = '⏳ בהכנה לשליחה';
export const SENDING_MARK = '⏳ בשליחה';

/** How many times one post goes back to the queue. */
export const MAX_REQUEUES = 3;
/** A failure older than this is history; a product posted hours late reads as noise. */
export const REQUEUE_WINDOW_MS = 6 * 3600_000;
/** Spaced attempts: the 1st after 5 minutes, then 15, then 45. */
export const REQUEUE_DELAYS_MIN = [5, 15, 45];

export function isRequeueableFailure(errorMessage: string | null | undefined): boolean {
  const text = String(errorMessage || '').trim();
  if (!text) return false;
  const segments = text.split('|').map((s) => s.trim()).filter(Boolean);
  if (!segments.length) return false;
  // Every failed channel must be safe: a mixed failure would resend the safe half and
  // repeat the half that needs the owner.
  return segments.every((seg) => isProvablyUnpublished(seg));
}

/** When the n-th requeue (0-based) sends again, or null when the post has had them all. */
export function requeueAt(attempt: number, nowMs: number): Date | null {
  if (attempt < 0 || attempt >= MAX_REQUEUES) return null;
  return new Date(nowMs + REQUEUE_DELAYS_MIN[Math.min(attempt, REQUEUE_DELAYS_MIN.length - 1)] * 60_000);
}
