/**
 * Whether the seasonal calendar did anything on this run, in one line the owner can read.
 *
 * Three switches have to be on before a single seasonal keyword enters a campaign's
 * rotation — the account switch (Settings → Scheduling), the plan's `seasonal_calendar`
 * entitlement, and the campaign's own 🗓️ toggle — and a fourth condition has to hold: an
 * event window open for the campaign's LANGUAGE, since Halloween and Christmas are US
 * events that a Hebrew campaign never sees.
 *
 * Every one of those failing looks identical from the outside: the campaign publishes
 * normally, and nothing holiday-shaped comes out. The owner asked why his Pinterest board
 * had no Halloween pins in the middle of an open Halloween window, and the honest answer was
 * that nothing in the product could tell him — not the campaign screen, not the run note,
 * which records posts queued and skipped and failed and never once mentions the calendar.
 *
 * There is a fifth way to get the same silence, and it is the one no switch explains: the
 * keywords ARE in the rotation, the runner searches them, and the search comes back EMPTY.
 * The slot then quietly borrows a product from another keyword, and the run looks perfectly
 * healthy. So the note does not stop at "seasonal is on" — it reports how many posts this
 * run actually CAME from a seasonal keyword. Zero, against an open window, is the finding.
 *
 * What empties the search is NOT the rating or discount filter: the pool's fallback tiers
 * relax both automatically, so any keyword whose search returned something is never
 * silenced by them. It is the filters sent to the API, which nothing relaxes — the
 * campaign's category and its price range. The run note's own dry-keyword line
 * ("החיפוש לא החזיר מוצרים כלל") confirms which keyword came back empty.
 */

export interface SeasonalStatus {
  /** Which gate the run got to. */
  state: 'account-off' | 'plan-off' | 'campaign-off' | 'active';
  /** Event names active for this campaign's language right now, used or not. */
  events: string[];
  /** Seasonal search keywords actually added to the rotation. */
  keywords: string[];
}

/** Keeps the note inside the run-note budget when several events overlap. */
function list(items: string[], max = 3): string {
  const head = items.slice(0, max).join(', ');
  return items.length > max ? `${head} ועוד ${items.length - max}` : head;
}

/**
 * The line for `last_run_note`, or null when the calendar has nothing to report.
 *
 * Null when no window is open for this language: a quiet calendar is the normal state for
 * most of the year, and a line saying so on every run would train the owner to skip the
 * field — which is where the real line has to be noticed.
 *
 * @param postsFromSeasonal posts in THIS run whose product came from a seasonal keyword.
 */
export function seasonalRunNote(status: SeasonalStatus, postsFromSeasonal: number): string | null {
  const { state, events, keywords } = status;
  if (!events.length) return null;
  const open = `חלון פתוח: ${list(events)}`;

  // A switch is off while a window is open — name the switch AND where it lives, because
  // "seasonal is off" sends the owner hunting through three screens for which one.
  if (state === 'account-off') return `🗓️ ${open} — העונתיות כבויה בהגדרות ← תזמון`;
  if (state === 'plan-off') return `🗓️ ${open} — לוח השנה העונתי לא כלול בתוכנית`;
  if (state === 'campaign-off') return `🗓️ ${open} — המתג העונתי כבוי בקמפיין הזה`;

  // Everything is on, but this language has no search terms for the open events (a
  // sale-season event like Black Friday carries none by design — it angles the copy and
  // says nothing about WHAT to sell).
  if (!keywords.length) return `🗓️ ${open} — הקשר לכתיבה בלבד, בלי מילות חיפוש לשפה זו`;

  // The line that answers the question. `0 פוסטים` here means the keywords were searched and
  // came back EMPTY — a category or price range the holiday stock does not fit, not a switch
  // and not the rating/discount bar (the fallback tiers relax those on their own).
  return `🗓️ ${open} · ${list(keywords)} · ${postsFromSeasonal} פוסטים מהן`;
}
