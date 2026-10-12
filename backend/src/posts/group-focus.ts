import { createHash } from 'crypto';

/**
 * A group's CORE FOCUS — the strict side of the relevance guard.
 *
 * product-relevance.ts was built to catch a clear misfit (a military belt headed for the
 * mothers' group) and to accept anything plausible. That is right for a general group and
 * wrong for a niche one: טקטי בקליק kept receiving an ordinary flashlight or general camping
 * gear, because they are "plausible". With a focus written on the group, every automatic
 * route into it — the AliExpress campaign, FLYLINK, the agents and sales recovery — asks the
 * judge the strict question instead: is this clearly inside the focus? Unsure is no.
 *
 * Still fail-open where it counts: no AI key, an unreachable judge or an unreadable answer
 * changes nothing, so a judge outage can never silence a group.
 */

export interface GroupFocus {
  /** The Telegram chat id the group is saved under (what a campaign targets). */
  channelId: string;
  /** The group's name, as the owner saved it. */
  name: string;
  /** The focus in the owner's words. */
  focus: string;
  /** Share (%) of the group's posts that must be inside the focus (focusShare). Absent = 100. */
  share?: number;
}

export const MAX_FOCUS_LENGTH = 400;

/** The focus as stored: whitespace collapsed, capped; blank clears it. */
export function normalizeFocus(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_FOCUS_LENGTH);
  return s || null;
}

/**
 * A short hash of the focus texts. Rejections are remembered per focus, so rewriting the
 * focus gives every product a fresh hearing.
 */
export function focusHash(foci: GroupFocus[]): string {
  const text = foci.map((f) => f.focus).sort().join('\n');
  return createHash('sha1').update(text).digest('hex').slice(0, 10);
}

/** persistent_values key of the products a focus has already rejected. */
export function focusMemoryKey(userId: string, foci: GroupFocus[]): string {
  return `group_focus_rejected:${userId}:${focusHash(foci)}`;
}

/**
 * How long a rejection is remembered. A FLYLINK rotation keeps a rejected item at the head
 * of its queue (it never posts, so its cursor never moves), and a keyword search returns the
 * same off-focus items run after run: without the memory each would be judged again on
 * every run, and enough of them would crowd out the products that fit.
 */
export const FOCUS_REJECT_TTL_MS = 14 * 86_400_000;

/** Product key → when it was rejected (ms). */
export type FocusMemory = Record<string, number>;

/** Keys still inside the window. */
export function liveRejections(memory: FocusMemory | null | undefined, now: number): Set<string> {
  const out = new Set<string>();
  for (const [k, at] of Object.entries(memory || {})) {
    if (typeof at === 'number' && now - at < FOCUS_REJECT_TTL_MS) out.add(k);
  }
  return out;
}

/** The stored memory plus new rejections, expired entries dropped. Merges, never assigns. */
export function mergeRejections(memory: FocusMemory | null | undefined, keys: string[], now: number): FocusMemory {
  const out: FocusMemory = {};
  for (const [k, at] of Object.entries(memory || {})) {
    if (typeof at === 'number' && now - at < FOCUS_REJECT_TTL_MS) out[k] = at;
  }
  for (const k of keys) if (k) out[k] = now;
  return out;
}

/** The reason shown for a product rejected from memory rather than by a fresh judgement. */
export const REMEMBERED_REASON = 'מחוץ למיקוד (נבדק כבר)';

/** The run-note label for a focused group's rejections, naming the group(s). */
export function focusLabel(foci: GroupFocus[]): string {
  const names = foci.map((f) => f.name).filter(Boolean);
  return names.length ? `מיקוד הקבוצה (${names.join(', ')})` : 'מיקוד הקבוצה';
}

/**
 * How many keywords' pools a focused group draws a replacement from. Each is one call over
 * three candidates; past four, a run that still found nothing inside the focus skips the
 * slot and says so in the run note.
 */
export const FOCUS_MAX_DONORS = 4;

/**
 * A FLYLINK catalog item as the focus judge sees it, or null when there is nothing to judge.
 * Its title is the supplier's code («LUN1526 $56.99»), so the judge reads what the enrichment
 * agent wrote (name, brand, category) and the supplier's description. An item with none of
 * those would be rejected as "unsure" on a code alone, so it is not asked about at all.
 */
export function flylinkFitItem(p: {
  id?: string; sku?: string | null; title?: string | null; description?: string | null;
  store_name?: string | null; store_brand?: string | null; store_category?: string | null;
}): { id: string; keyword: string; title: string; category?: string } | null {
  const name = String(p.store_name || '').trim();
  const brand = String(p.store_brand || '').trim();
  const category = String(p.store_category || '').trim();
  const description = String(p.description || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (!name && !category && !description) return null;
  const title = [name || String(p.title || '').trim(), brand && `(${brand})`, description && `— ${description}`]
    .filter(Boolean).join(' ');
  return { id: String(p.sku || p.id || ''), keyword: 'FLYLINK', title, category: category || undefined };
}

/** The platforms on which a post reaches the group itself (its chat, its Page, its Instagram). */
const GROUP_PLATFORMS = ['telegram', 'facebook', 'instagram', 'whatsapp'];

/**
 * Whether a group's focus applies to a campaign publishing on `platforms` (null = every
 * platform, the legacy default). A Pinterest-only campaign never reaches the group, so the
 * group's focus has nothing to guard there. Without this, a pin campaign with no target
 * group was checked against the default group's focus and lost every product: the US
 * Halloween and Christmas pins all failed the tactical group's focus (#101).
 */
export function focusApplies(platforms: Set<string> | null | undefined): boolean {
  if (!platforms || !platforms.size) return true;
  return GROUP_PLATFORMS.some((p) => platforms.has(p));
}

/**
 * The campaign's targets that no focus speaks for. A product a focus turns down may still go
 * to these: the focus decides what reaches ITS group, never what a sister group gets.
 */
export function openTargets(targets: string[], foci: GroupFocus[]): string[] {
  const focused = new Set(foci.map((f) => f.channelId));
  return targets.filter((t) => !focused.has(t));
}

// ── The mix: how much of the group must be inside the focus ──────────────────────────────
//
// A 100 % focus turned down everything outside it, and the campaign's other keywords stopped
// mattering: the owner wanted the tactical group MOSTLY tactical (60-70 %), with the rest
// still coming from his other keywords. So a product the focus turns down may still go out
// when the group's recent posts leave room for one more from outside the focus. It must
// still pass the lenient relevance guard: "outside the focus" is allowed, "wrong audience"
// never is.

/** The stored share, clamped to 50-100; null or anything unreadable is 100 (strict). */
export function focusShare(raw: number | null | undefined): number {
  const n = Number(raw);
  if (raw === null || raw === undefined || !Number.isFinite(n)) return 100;
  return Math.min(100, Math.max(50, Math.round(n)));
}

/** One of the group's recent automatic posts: when, and whether it was outside the focus. */
export interface MixEntry { at: number; off: boolean }

/** How many recent posts the share is measured over. */
export const MIX_WINDOW = 20;
/** Older posts drop out of the mix, so a quiet week does not carry over a stale ratio. */
export const MIX_TTL_MS = 14 * 86_400_000;

/** persistent_values key of a group's recent mix. */
export function focusMixKey(userId: string, channelId: string): string {
  return `group_focus_mix:${userId}:${channelId}`;
}

/** The live part of a stored mix, newest last, at most MIX_WINDOW. */
export function liveMix(entries: MixEntry[] | null | undefined, now: number): MixEntry[] {
  return (Array.isArray(entries) ? entries : [])
    .filter((e) => e && typeof e.at === 'number' && now - e.at < MIX_TTL_MS)
    .slice(-MIX_WINDOW);
}

/**
 * Whether one more post from outside the focus keeps the group at its share. Counted with
 * that post included, so an empty history starts inside the focus and the first outside post
 * comes once the inside ones make room for it.
 */
export function mixAllowsOff(entries: MixEntry[], sharePct: number): boolean {
  const share = focusShare(sharePct);
  if (share >= 100) return false;
  const recent = entries.slice(-(MIX_WINDOW - 1));
  const off = recent.filter((e) => e.off).length + 1;
  return off / (recent.length + 1) <= (100 - share) / 100;
}

/** The mix with one more post. */
export function pushMix(entries: MixEntry[], off: boolean, now: number): MixEntry[] {
  return liveMix([...entries, { at: now, off }], now);
}

/** The run-note line for a product that went out under the outside-the-focus share. */
export function offFocusNote(label: string, title: string, sharePct: number): string {
  return `${label}: "${title}" מחוץ למיקוד, עבר במכסת ${100 - focusShare(sharePct)}% של מילות המפתח האחרות`;
}
