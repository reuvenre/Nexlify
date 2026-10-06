import { UNTRUSTED_DATA_RULE, fenceUntrusted } from '../common/untrusted';
import { channelMatchFloor, channelSearchTerms, normaliseHebrew } from './shopper';
import { normaliseSearch } from './search-stats';

/**
 * The readers' search, when the reader's own words find nothing — pure parts.
 *
 * AliExpress does not understand the Hebrew a reader writes: «ידיות הסתערות», «מד חום
 * לבשר» come back empty or as unrelated items, and the reader leaves. A small model turns
 * those words into the English trade name a seller puts in a listing title («tactical
 * foregrip», «meat thermometer»), and the server searches again.
 *
 * The model only rewrites the SEARCH. It never sees a product and never picks one: the
 * results come from the same strict search and the same fixed ranking as any other.
 */

/** Small and cheap: the task is a translation of a few words. */
export const REWRITE_MODEL = 'claude-haiku-4-5';

/** Kept stable (no per-search values) so every call sends the same system prompt. */
export const REWRITE_SYSTEM = [
  'You turn a shopper\'s product search, often written in Hebrew or in slang, into AliExpress search queries.',
  'Answer with JSON only, in this shape: {"queries": ["...", "..."]}.',
  'Give 1 to 3 short English queries of 2 to 5 words each, using the common English trade name a seller would put in a listing title (for example "tactical foregrip", "meat thermometer").',
  'Most specific first. Keep any model name, size or brand the shopper wrote; never add a brand they did not name.',
  'If the text is not a search for a product, answer {"queries": []}.',
  UNTRUSTED_DATA_RULE,
].join('\n');

/** The user turn: the reader's words, fenced — they are a stranger's text. */
export function rewritePrompt(keyword: string): string {
  return `Shopper's search: ${fenceUntrusted(keyword, 80)}`;
}

/** Where a search's rewrites are remembered (persistent_values), so a repeat costs nothing. */
export function rewriteKey(keyword: string): string {
  return `shopper_rewrite:${normaliseSearch(keyword)}`;
}

/** A rewrite that worked is kept a month; "nothing to rewrite" only a day, in case it was a blip. */
export const REWRITE_TTL_MS = 30 * 24 * 3600_000;
export const REWRITE_EMPTY_TTL_MS = 24 * 3600_000;

/**
 * The model's answer as search queries: at most 3, plain English words only (a link or
 * markup drops the query), 2–60 characters and at most 6 words each, never
 * the reader's own words again. Anything unreadable is no rewrite at all.
 */
export function parseRewrites(text: string, original: string): string[] {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(match[0]);
  } catch {
    return [];
  }
  const list = Array.isArray((raw as any)?.queries) ? (raw as any).queries : [];
  const own = normaliseSearch(original);
  const out: string[] = [];
  for (const q of list) {
    if (typeof q !== 'string' || /https?:|www\.|[<>]/i.test(q)) continue;
    const clean = q.toLowerCase().replace(/[^a-z0-9\s'&.+-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (clean.length < 2 || clean.length > 60 || clean.split(' ').length > 6) continue;
    if (clean === own || out.includes(clean)) continue;
    out.push(clean);
    if (out.length >= 3) break;
  }
  return out;
}

const HEBREW_PREFIX = /^[הובלמשכ]/;

/**
 * Is this (Hebrew) title about what a Hebrew search asked for? It must cover most of the
 * search — CHANNEL_MATCH_SHARE of its letters, the bar a channel post meets — not one word:
 * «מתפס לטלפון» shares «מתפס» with «מתפס פיקטיני» and is still a phone clamp. A stem also
 * counts without its one-letter prefix («לבשר» finds «בשר»).
 *
 * An English search is answered with Hebrew titles, and comparing the two would call every
 * result unrelated — so only a Hebrew search is judged; anything else counts as related.
 */
export function titleMatchesSearch(keyword: string, title: string): boolean {
  if (!/[\u0590-\u05FF]/.test(keyword)) return true;
  const stems = channelSearchTerms(keyword);
  if (!stems.length) return true;
  const hay = normaliseHebrew(String(title || '').toLowerCase());
  const covered = stems.reduce((n, s) => {
    const hit = hay.includes(s) || (s.length >= 4 && HEBREW_PREFIX.test(s) && hay.includes(s.slice(1)));
    return hit ? n + s.length : n;
  }, 0);
  return covered >= channelMatchFloor(stems);
}

/** None of the titles is about a Hebrew search (titleMatchesSearch) — the search needs rewriting. */
export function looksUnrelated(keyword: string, titles: string[]): boolean {
  if (!/[\u0590-\u05FF]/.test(keyword) || !titles.length) return false;
  return !titles.some((t) => titleMatchesSearch(keyword, t));
}
