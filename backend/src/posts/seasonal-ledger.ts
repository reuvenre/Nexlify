/**
 * What happened to a campaign's SEASONAL slots, run by run, over the last few days.
 *
 * The seasonal-gap alert kept arriving with one run's note attached, and one run is the wrong
 * unit: a run with no seasonal slot is normal (the rotation had not come round), so "0 posts
 * from seasonal" on the last run says nothing about why 106 posts over three days had none.
 * Every hypothesis so far — a dry search, a starved cursor, a manager pause, the relevance
 * guard — predicts a different split of the same slots, and only the split over the whole
 * window can tell them apart. This is that split.
 *
 * Diagnostic and re-derivable, so it lives in PersistentValueStore: losing it costs one window
 * of evidence, never a post.
 */

export const SEASONAL_LEDGER_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export const seasonalLedgerKey = (campaignId: string) => `seasonal_ledger:${campaignId}`;

/** One run. Short keys: this is stored per run, per campaign. */
export interface SeasonalLedgerEntry {
  /** Run time, ms. */
  t: number;
  /** Seasonal slots the rotation handed this run. */
  s: number;
  /** Seasonal posts actually queued. */
  q: number;
  /** Seasonal slots skipped by pacing (group or campaign already booked). */
  k: number;
  /** Seasonal slots whose search came back empty (the slot borrowed from another keyword). */
  d: number;
  /** Seasonal products the relevance guard rejected and replaced from an ordinary keyword. */
  w: number;
}

export interface SeasonalLedgerTotals {
  runs: number;
  slots: number;
  queued: number;
  skipped: number;
  dry: number;
  swapped: number;
}

/** The stored list with this run appended and anything older than the window dropped. */
export function appendSeasonalRun(
  stored: SeasonalLedgerEntry[] | null | undefined, entry: SeasonalLedgerEntry,
  windowMs = SEASONAL_LEDGER_WINDOW_MS,
): SeasonalLedgerEntry[] {
  const cutoff = entry.t - windowMs;
  const kept = (Array.isArray(stored) ? stored : []).filter((e) => e && Number(e.t) >= cutoff);
  return [...kept, entry];
}

export function sumSeasonalRuns(
  stored: SeasonalLedgerEntry[] | null | undefined, now: number, windowMs = SEASONAL_LEDGER_WINDOW_MS,
): SeasonalLedgerTotals {
  const out: SeasonalLedgerTotals = { runs: 0, slots: 0, queued: 0, skipped: 0, dry: 0, swapped: 0 };
  for (const e of Array.isArray(stored) ? stored : []) {
    if (!e || Number(e.t) < now - windowMs) continue;
    out.runs++;
    out.slots += Number(e.s) || 0;
    out.queued += Number(e.q) || 0;
    out.skipped += Number(e.k) || 0;
    out.dry += Number(e.d) || 0;
    out.swapped += Number(e.w) || 0;
  }
  return out;
}

/** The owner-facing line, or null when there is no evidence yet. */
export function seasonalLedgerLine(t: SeasonalLedgerTotals): string | null {
  if (!t.runs) return null;
  if (!t.slots) return `${t.runs} הרצות, אף מקום עונתי לא הגיע לתורו בסבב`;
  const parts = [`${t.runs} הרצות · ${t.slots} מקומות עונתיים`, `${t.queued} פורסמו`];
  if (t.skipped) parts.push(`${t.skipped} דולגו (הקבוצה תפוסה)`);
  if (t.dry) parts.push(`${t.dry} חיפוש ריק`);
  if (t.swapped) parts.push(`${t.swapped} הוחלפו ע"י שומר הרלוונטיות`);
  return parts.join(' · ');
}
