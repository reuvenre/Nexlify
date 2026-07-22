/**
 * Built-in commercial calendar. Pure data + date math — no DB, no setup: events recur
 * yearly by Gregorian windows (Hebrew-calendar holidays get windows wide enough to cover
 * their year-to-year drift). Each event contributes PRODUCT-SEARCH keywords (what shoppers
 * buy for the occasion — not the event's name) and a copy hint for the AI.
 *
 * Windows open EARLY on purpose: Pinterest searches start 30–60 days before a holiday,
 * and pins need lead time to accumulate reach.
 */

export type SeasonalAudience = 'il' | 'us' | 'global';

export interface SeasonalEvent {
  key: string;
  /** Display name (Hebrew UI). */
  name: string;
  emoji: string;
  audience: SeasonalAudience;
  /** Window start/end, recurring yearly. A window may cross the year boundary. */
  start: { m: number; d: number };
  end: { m: number; d: number };
  /** Product-search keywords injected into the campaign rotation (by campaign language). */
  keywords_he: string[];
  keywords_en: string[];
  /** One-line context appended to the copywriter prompt. */
  hint_he: string;
  hint_en: string;
}

export const SEASONAL_EVENTS: SeasonalEvent[] = [
  {
    key: 'back_to_school_us', name: 'חזרה ללימודים (ארה"ב)', emoji: '🎒', audience: 'us',
    start: { m: 7, d: 15 }, end: { m: 8, d: 25 },
    keywords_he: [],
    keywords_en: ['school supplies', 'dorm room essentials', 'kids backpack'],
    hint_he: '',
    hint_en: 'Context: back-to-school season in the US — when relevant, frame the product as a smart school/dorm pick. Never invent discounts.',
  },
  {
    key: 'back_to_school_il', name: 'חזרה ללימודים', emoji: '🎒', audience: 'il',
    start: { m: 8, d: 1 }, end: { m: 9, d: 1 },
    keywords_he: ['ציוד לבית ספר', 'קלמרים ותיקים לילדים'],
    keywords_en: [],
    hint_he: 'הקשר: עונת החזרה ללימודים — כשזה רלוונטי, מסגר את המוצר כפתרון חכם לשנת הלימודים. אל תמציא הנחות.',
    hint_en: '',
  },
  {
    key: 'tishrei', name: 'חגי תשרי', emoji: '🍎', audience: 'il',
    start: { m: 8, d: 25 }, end: { m: 10, d: 10 },
    keywords_he: ['מתנות לחג', 'כלי הגשה לשולחן חג', 'ארגון המטבח לחג'],
    keywords_en: [],
    hint_he: 'הקשר: חגי תשרי מתקרבים — כשזה מתאים, חבר את המוצר לאירוח, לשולחן החג או למתנה לחג. אל תמציא הנחות.',
    hint_en: '',
  },
  {
    key: 'halloween', name: 'האלווין (ארה"ב)', emoji: '🎃', audience: 'us',
    start: { m: 9, d: 15 }, end: { m: 10, d: 31 },
    keywords_he: [],
    keywords_en: ['halloween decorations', 'halloween party supplies'],
    hint_he: '',
    hint_en: 'Context: Halloween season — when relevant, angle the product for spooky decor, costumes or parties. Never invent discounts.',
  },
  {
    key: 'sale_1111', name: 'מגה-סייל 11.11', emoji: '🛒', audience: 'global',
    start: { m: 10, d: 28 }, end: { m: 11, d: 11 },
    keywords_he: [],
    keywords_en: [],
    hint_he: 'הקשר: עונת מבצעי 11.11 של אלי אקספרס — מסגר את הדיל כהזדמנות של תקופת הסייל. אל תמציא אחוזי הנחה שלא קיבלת.',
    hint_en: "Context: AliExpress 11.11 mega-sale season — frame the deal as a sale-season catch. Never invent discount numbers.",
  },
  {
    key: 'black_friday', name: 'Black Friday', emoji: '🖤', audience: 'global',
    start: { m: 11, d: 15 }, end: { m: 12, d: 2 },
    keywords_he: [],
    keywords_en: [],
    hint_he: 'הקשר: עונת בלאק פריידיי — מסגר את הדיל בהתאם (מחיר שווה של העונה). אל תמציא אחוזי הנחה.',
    hint_en: 'Context: Black Friday season — frame the price as a season steal. Never invent discount numbers.',
  },
  {
    key: 'christmas', name: 'קריסמס (ארה"ב)', emoji: '🎄', audience: 'us',
    start: { m: 9, d: 20 }, end: { m: 12, d: 18 },
    keywords_he: [],
    keywords_en: ['christmas gifts', 'stocking stuffers', 'christmas decorations'],
    hint_he: '',
    hint_en: 'Context: holiday-gifting season — when relevant, frame the product as a gift idea (for her/him/kids). Never invent discounts.',
  },
  {
    key: 'hanukkah', name: 'חנוכה', emoji: '🕎', audience: 'il',
    start: { m: 11, d: 20 }, end: { m: 12, d: 30 },
    keywords_he: ['מתנות לילדים', 'מתנות לחנוכה'],
    keywords_en: [],
    hint_he: 'הקשר: חנוכה מתקרב — כשזה מתאים, הצג את המוצר כמתנה לחג. אל תמציא הנחות.',
    hint_en: '',
  },
  {
    key: 'valentines', name: 'ולנטיין', emoji: '💘', audience: 'global',
    start: { m: 1, d: 10 }, end: { m: 2, d: 14 },
    keywords_he: ['מתנות רומנטיות'],
    keywords_en: ['valentines day gifts', 'gifts for her'],
    hint_he: 'הקשר: עונת ולנטיין — כשזה מתאים, זווית רומנטית/מתנה לבן או בת זוג. אל תמציא הנחות.',
    hint_en: 'Context: Valentine\'s season — when relevant, angle the product as a gift for a partner. Never invent discounts.',
  },
  {
    key: 'passover_spring', name: 'פסח וניקיון אביב', emoji: '🌸', audience: 'il',
    start: { m: 3, d: 10 }, end: { m: 4, d: 25 },
    keywords_he: ['אביזרי ניקיון לבית', 'ארגון וסדר לבית'],
    keywords_en: [],
    hint_he: 'הקשר: עונת פסח וניקיון האביב — כשזה מתאים, חבר את המוצר לניקיון, סדר או אירוח החג. אל תמציא הנחות.',
    hint_en: '',
  },
  {
    key: 'mothers_day_us', name: 'יום האם (ארה"ב)', emoji: '💐', audience: 'us',
    start: { m: 4, d: 10 }, end: { m: 5, d: 12 },
    keywords_he: [],
    keywords_en: ['gifts for mom', 'mothers day gifts'],
    hint_he: '',
    hint_en: 'Context: Mother\'s Day season — when relevant, frame the product as a gift for mom. Never invent discounts.',
  },
  {
    key: 'summer', name: 'קיץ', emoji: '☀️', audience: 'global',
    start: { m: 6, d: 1 }, end: { m: 8, d: 15 },
    keywords_he: ['אביזרי ים ובריכה'],
    keywords_en: ['beach essentials', 'summer gadgets'],
    hint_he: 'הקשר: שיא הקיץ — כשזה מתאים, זווית של חופשה, ים ובילוי בחוץ.',
    hint_en: 'Context: peak summer — when relevant, angle for vacations, beach and the outdoors.',
  },
];

/** Day-of-year style comparison that handles windows crossing the year boundary. */
function inWindow(now: Date, ev: SeasonalEvent): boolean {
  const cur = (now.getMonth() + 1) * 100 + now.getDate();
  const s = ev.start.m * 100 + ev.start.d;
  const e = ev.end.m * 100 + ev.end.d;
  return s <= e ? cur >= s && cur <= e : cur >= s || cur <= e;
}

/** The audiences a campaign language belongs to: Hebrew → Israeli events, English → US. */
function audiencesFor(language: string): SeasonalAudience[] {
  if (language === 'en') return ['us', 'global'];
  if (language === 'he') return ['il', 'global'];
  return ['global'];
}

/** Events active right now for a campaign language. */
export function activeSeasonalEvents(language: string, now = new Date()): SeasonalEvent[] {
  const aud = audiencesFor(language);
  return SEASONAL_EVENTS.filter((ev) => aud.includes(ev.audience) && inWindow(now, ev));
}

/** Seasonal product-search keywords for the language (capped so they never swamp the
 *  campaign's own list). */
export function seasonalKeywords(language: string, now = new Date(), cap = 3): string[] {
  const out: string[] = [];
  for (const ev of activeSeasonalEvents(language, now)) {
    for (const kw of (language === 'en' ? ev.keywords_en : ev.keywords_he)) {
      if (out.length >= cap) return out;
      if (!out.includes(kw)) out.push(kw);
    }
  }
  return out;
}

/** One combined copy hint (first active event with a hint wins — one context line, not a lecture). */
export function seasonalHint(language: string, now = new Date()): string | null {
  for (const ev of activeSeasonalEvents(language, now)) {
    const hint = language === 'en' ? ev.hint_en : ev.hint_he;
    if (hint) return hint;
  }
  return null;
}

/** Active + soon-to-open events (any audience) for the dashboard strip. */
export function seasonalOverview(now = new Date()): {
  active: Array<{ key: string; name: string; emoji: string; audience: SeasonalAudience }>;
  upcoming: Array<{ key: string; name: string; emoji: string; audience: SeasonalAudience; opens_in_days: number }>;
} {
  const active = SEASONAL_EVENTS.filter((ev) => inWindow(now, ev))
    .map(({ key, name, emoji, audience }) => ({ key, name, emoji, audience }));
  const upcoming: Array<{ key: string; name: string; emoji: string; audience: SeasonalAudience; opens_in_days: number }> = [];
  for (const ev of SEASONAL_EVENTS) {
    if (inWindow(now, ev)) continue;
    const startThisYear = new Date(now.getFullYear(), ev.start.m - 1, ev.start.d);
    const start = startThisYear >= now ? startThisYear : new Date(now.getFullYear() + 1, ev.start.m - 1, ev.start.d);
    const days = Math.ceil((start.getTime() - now.getTime()) / 86_400_000);
    if (days <= 30) upcoming.push({ key: ev.key, name: ev.name, emoji: ev.emoji, audience: ev.audience, opens_in_days: days });
  }
  upcoming.sort((a, b) => a.opens_in_days - b.opens_in_days);
  return { active, upcoming };
}
