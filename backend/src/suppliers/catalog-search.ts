/**
 * Manual search across the owner's FLYLINK catalogs — the pure parts.
 *
 * The search itself is Yupoo's own store search (`YupooService.searchStore`); what lives
 * here is how its answer meets what the owner already has: a result whose album is
 * already linked as a product is marked, so he opens the saved product instead of
 * linking the same album twice.
 */

/** The numeric album id inside a Yupoo album URL, or null. */
export function albumIdOf(url: string | null | undefined): string | null {
  const m = String(url || '').match(/\/albums\/(\d+)/);
  return m ? m[1] : null;
}

/**
 * The words sent to Yupoo: spaces collapsed, trimmed, capped. Returns '' for a search
 * too short to mean anything (a single character matches half the store).
 */
export function normalizeCatalogQuery(raw: string | null | undefined): string {
  const q = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return q.length >= 2 ? q : '';
}

/** True when the search has Hebrew letters — supplier titles never do. */
export function isHebrewQuery(q: string): boolean {
  return /[֐-׿]/.test(q);
}
