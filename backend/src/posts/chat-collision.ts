import { normalizeTelegramChatId } from '../common/crypto';

/**
 * "Two posts went into the group together."
 *
 * A group is fed by two clocks: campaign posts book a scheduled_at and are released by
 * `sendScheduledPosts`, and the manual queue drips by the group's `schedule_last_sent_at`
 * in `processQueue`. Both crons fire at second 0 of every minute and neither sees the
 * other's send until it has finished. On an ordinary slot the few seconds a send takes
 * kept them apart by accident; but when the group's clock is old — the window opening at
 * 09:00 after a quiet night — both are due at once and both publish in the same minute.
 * A post fanned out to several groups, or a default-channel post whose channel is also a
 * saved group, can meet a group post the same way.
 *
 * So every paced send claims its post only if no other post reached the same Telegram
 * chat in the last few minutes, and the claim runs under a per-account lock so two crons
 * cannot both pass the check before either has written.
 */

/** The longest a paced post waits behind another one in the same chat. */
export const CHAT_GAP_MAX_MINUTES = 15;

/**
 * How close two paced posts to one chat may land. Half the group's interval, at most
 * 15 minutes: wide enough to separate a same-minute pair, narrow enough that a slot
 * booked a few seconds short of a full interval is never held.
 */
export function chatGapMinutes(intervalMinutes: number | null | undefined): number {
  const interval = Number(intervalMinutes) > 0 ? Number(intervalMinutes) : 60;
  return Math.max(1, Math.min(CHAT_GAP_MAX_MINUTES, Math.floor(interval / 2)));
}

/** The Telegram chats a post lands in: its groups, or the account's default channel. */
export function postChats(targets: (string | null | undefined)[], defaultChat: string | null | undefined): string[] {
  const groups = targets.filter((t): t is string => !!t);
  const raw = groups.length ? groups : [defaultChat];
  return Array.from(new Set(raw.map((c) => (c ? normalizeTelegramChatId(c) : '')).filter(Boolean) as string[]));
}

export interface RecentChatSend {
  chats: string[];
  at: Date;
}

/**
 * The latest recent send that shares a chat with `chats` within `gapMinutes` of `now`,
 * or null when the post may go.
 */
export function chatCollision(
  chats: string[],
  recent: RecentChatSend[],
  now: Date,
  gapMinutes: number,
): Date | null {
  const since = now.getTime() - gapMinutes * 60_000;
  const mine = new Set(chats);
  let latest: Date | null = null;
  for (const r of recent) {
    const t = new Date(r.at).getTime();
    if (!Number.isFinite(t) || t <= since) continue;
    if (!r.chats.some((c) => mine.has(c))) continue;
    if (!latest || t > latest.getTime()) latest = new Date(t);
  }
  return latest;
}
