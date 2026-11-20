/**
 * Which "published partially" failures are safe for the system to retry BY ITSELF.
 *
 * A post that reached Telegram and lost Facebook stays `sent` with an error_message, so
 * nothing else notices it — the watchdog raises an issue and the owner presses retry by
 * hand. For one failure family that hand is pure ceremony: a connection that died at the
 * wire. Nothing reached the platform, so re-sending cannot duplicate, and the fix is
 * simply to try again once the network is back.
 *
 * The verdict is NOT read out of the wording. "שגיאת חיבור לטלגרם (ETIMEDOUT)" is produced
 * both by a connect-phase failure (safe) and by a timeout on an open socket (unsafe — the
 * post may already be live). Only the sender, holding the error object, can tell those
 * apart, so it stamps NET_SAFE_TAG at failure time and this module trusts nothing else.
 */

/** Stamped by telegramErrorText / facebookErrorText on a provable connect-phase failure. */
export const NET_SAFE_TAG = '[net]';

/** Appended once per automatic attempt — the counter that stops the loop. */
export const AUTO_RETRY_MARK = ' · נוסה שוב אוטומטית';

/**
 * A blip can outlast one attempt, and every attempt here is provably safe, so a few are
 * allowed. Spaced by the scheduler's 5-minute tick this covers roughly a quarter hour —
 * long enough for a routing wobble, short enough that a real outage stops being retried.
 */
export const MAX_AUTO_RETRIES = 3;

/** Rows written before the tag existed still carry this Meta-only wording. */
const LEGACY_META_PHRASE = /נכשל ברמת הרשת/;

/** How many automatic attempts this post has already had. */
export function autoRetryCount(errorMessage: string | null | undefined): number {
  return String(errorMessage || '').split(AUTO_RETRY_MARK).length - 1;
}

export function isRetryableNetworkPartial(errorMessage: string | null | undefined): boolean {
  const text = String(errorMessage || '').trim();
  if (!text) return false;
  if (autoRetryCount(text) >= MAX_AUTO_RETRIES) return false;

  // EVERY failed platform must be wire-safe. A mixed error ("Telegram: network |
  // Instagram: token expired") would spend an attempt on a half that fails identically,
  // and bury the half the owner needs to read.
  const segments = text.split(AUTO_RETRY_MARK)[0].split('|').map((s) => s.trim()).filter(Boolean);
  if (!segments.length) return false;
  return segments.every((seg) => isProvablyUnpublished(seg) || LEGACY_META_PHRASE.test(seg));
}

/**
 * Telegram answered and refused: 429 "Too Many Requests" or 502 "Bad Gateway" (its front
 * door could not reach the Bot API). Either way nothing was published, so a resend cannot
 * duplicate. The 19.11.2026 post that lost one group to a 502 had no retry for this.
 * The label is the optional "[group] " a multi-group post adds.
 */
const TELEGRAM_REFUSED = /^Telegram:\s*(?:\[[^\]]*\]\s*)?(?:Too Many Requests|Bad Gateway)\b/i;

/** One failed channel's text, where the platform provably did not publish. */
export function isProvablyUnpublished(segment: string): boolean {
  const seg = String(segment || '').trim();
  return seg.includes(NET_SAFE_TAG) || TELEGRAM_REFUSED.test(seg);
}
