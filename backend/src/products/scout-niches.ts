/**
 * Searching the high-commission products of one niche the owner picks from a list
 * (CommissionScoutService.startNicheScan). Three kinds of niche, each with its own id:
 *  - `kw:<keyword>`  one of his own campaign keywords (results keep origin `niche`, so quick
 *                    post can route the product to that campaign's group);
 *  - `preset:<key>`  a ready niche below, searched by its English trade keywords;
 *  - `cat:<id>`      one of AliExpress's top-level categories (getCategories).
 * The list is the only input: an id that is not on it is refused, so a search can never be
 * steered to arbitrary text.
 *
 * Kept free of Nest so the parsing can be unit tested.
 */

export interface PresetNiche {
  key: string;
  label: string;
  /** English: AliExpress is indexed in English. */
  keywords: string[];
}

export const PRESET_NICHES: PresetNiche[] = [
  { key: 'tactical', label: 'ציוד טקטי ושטח', keywords: ['tactical gear', 'tactical flashlight', 'molle pouch', 'tactical backpack', 'outdoor knife'] },
  { key: 'camping', label: 'קמפינג וטיולים', keywords: ['camping gear', 'camping lantern', 'hiking backpack', 'portable camping stove'] },
  { key: 'kitchen', label: 'מטבח', keywords: ['kitchen gadgets', 'kitchen organizer', 'silicone kitchen utensils', 'knife sharpener'] },
  { key: 'home', label: 'בית וארגון', keywords: ['home organizer', 'storage box', 'led strip lights', 'cleaning tools'] },
  { key: 'beauty', label: 'יופי וטיפוח', keywords: ['skincare tools', 'hair styling tool', 'makeup brush set', 'nail art'] },
  { key: 'car', label: 'רכב', keywords: ['car accessories', 'car phone holder', 'car vacuum cleaner', 'dash cam'] },
  { key: 'phone', label: 'אביזרי טלפון', keywords: ['phone case', 'wireless charger', 'phone holder', 'usb c cable'] },
  { key: 'gadgets', label: 'גאדג׳טים', keywords: ['smart gadgets', 'mini projector', 'smart watch', 'electric gadgets'] },
  { key: 'audio', label: 'אוזניות ושמע', keywords: ['wireless earbuds', 'bluetooth speaker', 'headphones'] },
  { key: 'pets', label: 'חיות מחמד', keywords: ['pet supplies', 'dog toys', 'cat toys', 'pet grooming'] },
  { key: 'kids', label: 'ילדים ותינוקות', keywords: ['baby products', 'kids toys', 'educational toys'] },
  { key: 'fitness', label: 'כושר וספורט', keywords: ['fitness equipment', 'resistance bands', 'yoga mat', 'sports bottle'] },
  { key: 'tools', label: 'כלי עבודה', keywords: ['power tools', 'cordless drill', 'tool set', 'multimeter'] },
  { key: 'fashion', label: 'אופנה ותכשיטים', keywords: ['women jewelry', 'men watch', 'sunglasses', 'handbag'] },
  { key: 'gaming', label: 'גיימינג', keywords: ['gaming accessories', 'gaming mouse', 'gaming headset', 'game controller'] },
  { key: 'garden', label: 'גינה', keywords: ['garden tools', 'solar garden lights', 'plant pots'] },
];

/** AliExpress's top-level category names, in Hebrew for the list. An unknown name stays as it is. */
export const CATEGORY_HE: Record<string, string> = {
  'Consumer Electronics': 'מוצרי חשמל ואלקטרוניקה',
  'Phones & Telecommunications': 'טלפונים ותקשורת',
  'Computer & Office': 'מחשבים ומשרד',
  'Home & Garden': 'בית וגן',
  'Home Improvement': 'שיפוצים וכלי בית',
  'Home Appliances': 'מכשירי חשמל לבית',
  'Beauty & Health': 'יופי ובריאות',
  'Sports & Entertainment': 'ספורט ופנאי',
  'Toys & Hobbies': 'צעצועים ותחביבים',
  'Mother & Kids': 'אמא וילד',
  'Automobiles, Parts & Accessories': 'רכב וחלקים',
  'Automobiles & Motorcycles': 'רכב ואופנועים',
  'Jewelry & Accessories': 'תכשיטים ואקססוריז',
  'Watches': 'שעונים',
  'Shoes': 'נעליים',
  "Women's Clothing": 'ביגוד נשים',
  "Men's Clothing": 'ביגוד גברים',
  'Luggage & Bags': 'תיקים ומזוודות',
  'Lights & Lighting': 'תאורה',
  'Tools': 'כלי עבודה',
  'Pet Products': 'מוצרים לחיות מחמד',
  'Furniture': 'רהיטים',
  'Office & School Supplies': 'ציוד משרדי ולימודים',
  'Security & Protection': 'אבטחה והגנה',
  'Electronic Components & Supplies': 'רכיבים אלקטרוניים',
  'Hair Extensions & Wigs': 'תוספות שיער ופאות',
  'Novelty & Special Use': 'מוצרים מיוחדים',
  'Weddings & Events': 'חתונות ואירועים',
  'Food': 'מזון',
};

export function categoryLabel(name: string): string {
  return CATEGORY_HE[name] || name;
}

export type NicheId =
  | { kind: 'kw'; value: string }
  | { kind: 'preset'; value: string }
  | { kind: 'cat'; value: string };

export function parseNicheId(id: unknown): NicheId | null {
  const m = /^(kw|preset|cat):(.{1,80})$/.exec(String(id || '').trim());
  if (!m) return null;
  return { kind: m[1] as NicheId['kind'], value: m[2].trim() };
}

/** Pages per niche source: a niche is narrow, so it reads deeper than the daily scan does. */
export const NICHE_KEYWORD_HOT_PAGES = 3;
export const NICHE_KEYWORD_SEARCH_PAGES = 2;
export const NICHE_CATEGORY_HOT_PAGES = 8;
export const NICHE_CATEGORY_SEARCH_PAGES = 4;
/** API calls one niche search may spend (≈ 1 minute at 1.1 s apart). */
export const NICHE_MAX_CALLS = 60;
/** A niche's result is kept this long, and searched again no sooner than the cooldown. */
export const NICHE_TTL_MS = 24 * 3600_000;
export const NICHE_COOLDOWN_MS = 5 * 60_000;
