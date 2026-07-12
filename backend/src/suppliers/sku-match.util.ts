import { SkuMatchMode } from './entities/supplier-catalog.entity';

/**
 * Normalize a raw product code to its canonical form for matching/storage,
 * per the catalog's chosen mode. Two codes "match" iff their canonical forms
 * are equal.
 *
 *  - exact:      trim + uppercase (e.g. "abc123 " → "ABC123")
 *  - numeric:    digits only       (e.g. "LUN1526" → "1526", "LN1526" → "1526")
 *  - prefix_map: strip a known prefix from either side, compare the remainder
 *                config: { source_prefix, affiliate_prefix }
 *  - regex:      first capture group of config.pattern (fallback: exact)
 */
export function normalizeSku(
  raw: string | undefined | null,
  mode: SkuMatchMode = 'numeric',
  config: Record<string, any> = {},
): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  switch (mode) {
    case 'exact':
      return s.toUpperCase();
    case 'numeric': {
      const digits = s.replace(/\D/g, '');
      return digits || s.toUpperCase();
    }
    case 'prefix_map': {
      // Remove either configured prefix (case-insensitive), then normalize.
      const prefixes = [config.source_prefix, config.affiliate_prefix]
        .filter(Boolean)
        .map((p: string) => String(p).toUpperCase());
      let up = s.toUpperCase();
      for (const p of prefixes) {
        if (up.startsWith(p)) { up = up.slice(p.length); break; }
      }
      return up;
    }
    case 'regex': {
      try {
        const m = s.match(new RegExp(config.pattern, 'i'));
        return (m?.[1] ?? m?.[0] ?? s).toUpperCase();
      } catch {
        return s.toUpperCase();
      }
    }
    default:
      return s.toUpperCase();
  }
}

/** Suggest a match mode from a sample code (used when the user adds a catalog). */
export function suggestSkuMode(sample: string): SkuMatchMode {
  const s = String(sample || '').trim();
  if (/^[A-Za-z]+\d+$/.test(s)) return 'numeric'; // letters+digits like LUN1526
  return 'exact';
}
