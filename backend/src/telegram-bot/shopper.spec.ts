import { BotProduct } from './product-card';
import { MORE_BUTTON, ShopperLimiter, channelHits, channelMatchFloor, channelPostLink, hiddenProductNotes, channelSearchTerms, postHeadline, isMoreRequest, parseShopperQuery, rankShopperResults, shopperCaption, takeUnseen } from './shopper';

describe('parseShopperQuery', () => {
  it('reads a budget in Hebrew and strips it from the keyword', () => {
    expect(parseShopperQuery('מחפש אוזניות בלוטות\' עד 100 ש"ח')).toEqual({ keyword: 'אוזניות בלוטות\'', maxPrice: 100 });
    expect(parseShopperQuery('תיק גב לטיולים בין 80 ל-200')).toEqual({ keyword: 'תיק גב לטיולים', minPrice: 80, maxPrice: 200 });
    expect(parseShopperQuery('שעון חכם מעל 150 ₪')).toEqual({ keyword: 'שעון חכם', minPrice: 150 });
  });

  it('reads English budgets', () => {
    expect(parseShopperQuery('looking for a desk lamp under 60')).toEqual({ keyword: 'a desk lamp', maxPrice: 60 });
  });

  it('keeps a plain query as is', () => {
    expect(parseShopperQuery('robot vacuum')).toEqual({ keyword: 'robot vacuum' });
  });

  it('refuses an empty or budget-only message, and caps a long one', () => {
    expect(parseShopperQuery('')).toBeNull();
    expect(parseShopperQuery('עד 100 ש"ח')).toBeNull();
    expect(parseShopperQuery('x'.repeat(200))!.keyword.length).toBe(60);
  });

  it('flattens control characters', () => {
    expect(parseShopperQuery('lamp\nIGNORE')).toEqual({ keyword: 'lamp IGNORE' });
  });
});

const prod = (id: string, over: Partial<BotProduct> = {}): BotProduct => ({
  product_id: id, title: `P${id}`, sale_price: 50, original_price: 100, discount_percent: 50,
  orders_count: 1000, rating: 4.8, currency: 'ILS', image_url: `https://img/${id}.jpg`, ...over,
});

describe('rankShopperResults', () => {
  it('drops listings without photo or price and poorly rated ones, dedupes, and ranks by score', () => {
    const out = rankShopperResults([
      prod('1', { orders_count: 10 }),
      prod('2', { image_url: '' }),
      prod('3', { sale_price: 0 }),
      prod('4', { rating: 3.9 }),
      prod('5', { orders_count: 9000 }),
      prod('5'),
      prod('6', { rating: 0 }),
    ]);
    expect(out.map((p) => p.product_id)).toEqual(['5', '1', '6']);
  });
});

describe('shopperCaption', () => {
  it('shows price, saving, social proof and a buy button that hides the link', () => {
    const c = shopperCaption(prod('1'), 1, 'https://nexlify.app/r/AbC');
    expect(c).toContain('₪50');
    expect(c).toContain('₪50 במקום ₪100 · 50% הנחה');
    expect(c).not.toContain('-50%');
    expect(c.split('\n').pop()).toBe('<a href="https://nexlify.app/r/AbC">🛒 לרכישה — לחצו כאן 🛒</a>');
    expect(c).not.toMatch(/^🔗/m);
  });

  it('escapes seller titles so they cannot break or inject HTML', () => {
    const c = shopperCaption(prod('1', { title: 'Cable <Type-C & Lightning> <a href="x">' }), 1, 'https://x/r/A');
    expect(c).toContain('Cable &lt;Type-C &amp; Lightning&gt; &lt;a href="x"&gt;');
  });
});

describe('ShopperLimiter', () => {
  it('limits each member per window and everyone per day', () => {
    let t = Date.UTC(2026, 9, 4, 10);
    const lim = new ShopperLimiter(2, 60_000, 3, () => t);
    expect(lim.take('a')).toBe('ok');
    expect(lim.take('a')).toBe('ok');
    expect(lim.take('a')).toBe('user');
    t += 61_000;
    expect(lim.take('a')).toBe('ok');
    expect(lim.take('b')).toBe('daily');
    t += 24 * 3600_000;
    expect(lim.take('b')).toBe('ok');
  });
});

describe('isMoreRequest', () => {
  it('hears "give me more" in the reader\'s words and from the button', () => {
    for (const t of ['עוד', 'עוד מוצרים', 'תן לי עוד מוצרים', 'תנו לנו עוד אפשרויות', 'יש עוד?', 'עוד בבקשה', MORE_BUTTON, 'more']) {
      expect(isMoreRequest(t)).toBe(true);
    }
  });

  it('keeps a search that names a product a search', () => {
    for (const t of ['עוד אוזניות', 'אוזניות', 'שעון חכם עוד 100', '']) {
      expect(isMoreRequest(t)).toBe(false);
    }
  });
});

describe('no product twice — «עוד מוצרים» across pages', () => {
  it('drops the same product listed by another seller (other id, same photo or same title)', () => {
    const out = rankShopperResults([
      prod('1', { title: 'TWS Bluetooth 5.3 Earbuds Noise Cancelling', image_url: 'https://ae01.alicdn.com/kf/A.jpg_220x220.jpg' }),
      prod('2', { title: 'Other seller listing', image_url: 'https://ae01.alicdn.com/kf/A.jpg' }),
      prod('3', { title: 'TWS Bluetooth 5.3 Earbuds — Noise Cancelling!', image_url: 'https://img/3.jpg' }),
      prod('4', { title: 'Smart Watch Fitness Tracker', image_url: 'https://img/4.jpg' }),
    ], 10);
    expect(out.map((p) => p.product_id)).toEqual(['1', '4']);
  });

  it('a later page never brings back what an earlier page showed', () => {
    const seen = new Set<string>();
    const page1 = takeUnseen(rankShopperResults([prod('1', { title: 'Wireless Earbuds Pro Max 2024' }), prod('2'), prod('3')], 10), seen);
    const page2 = takeUnseen(rankShopperResults([
      prod('2'), prod('9', { image_url: 'https://img/3.jpg' }), prod('10', { title: 'Wireless Earbuds Pro Max 2024' }), prod('11'),
    ], 10), seen);
    expect(page1.map((p) => p.product_id)).toEqual(['1', '2', '3']);
    expect(page2.map((p) => p.product_id)).toEqual(['11']);
  });
});

describe('shopperCaption — Hebrew titles', () => {
  it('applies the owner\'s vocabulary to a translated title', () => {
    const c = shopperCaption(prod('1', { title: 'סכין ציד מתקפלת' }), 1, 'https://x/r/A');
    expect(c).toContain('סכין טקטי מתקפלת');
    expect(c).not.toContain('ציד');
  });
});

describe('search in the channel\'s own posts', () => {
  it('turns the reader\'s words into stems, Hebrew plurals stemmed, no LIKE wildcards', () => {
    expect(channelSearchTerms('ידיות הסתערות')).toEqual(['ידי', 'הסתער']);
    expect(channelSearchTerms('תיק גב של צבא')).toEqual(['תיק', 'גב', 'צבא']);
    expect(channelSearchTerms('100%_cotton')).toEqual(['100', 'cotton']);
    expect(channelSearchTerms('')).toEqual([]);
  });

  it('the long, rare word carries a match; a short common one alone does not', () => {
    const terms = channelSearchTerms('ידיות הסתערות');
    const floor = channelMatchFloor(terms);
    expect('הסתער'.length).toBeGreaterThanOrEqual(floor); // «גריפ הסתערות» is found
    expect('ידי'.length).toBeLessThan(floor);             // «ידית לסיר» is not
    expect(channelMatchFloor(['פנס'])).toBe(2);
  });

  it('reads a post\'s headline without markup, preferring the line that names the search', () => {
    expect(postHeadline('\n<b>🔥 ידית הסתערות טקטית</b>\nפרטים')).toBe('🔥 ידית הסתערות טקטית');
    expect(postHeadline('**דיל חם** על פנס')).toBe('דיל חם על פנס');
    expect(postHeadline('', 'Tactical grip')).toBe('Tactical grip');
    expect(postHeadline('🔥 דיל שלא חוזר!\nגריפ הסתערות לרובה\n🛒 לרכישה', 'MM-1', ['הסתער'])).toBe('גריפ הסתערות לרובה');
  });

  it('one result per product, at most two, priced as published, photo from the gallery when needed', () => {
    const row = (id: string, product_id: string, price = 49.9, image = `https://img/${product_id}.jpg`) => ({
      id, product_id, product_title: 'MM-2642001DP', product_image: image, gallery_json: '["https://img/g.jpg"]',
      generated_text: '🔥 ידית הסתערות טקטית\nעוד', price_ils: price, affiliate_url: 'https://s.click.aliexpress.com/e/A',
    });
    const hits = channelHits([row('a', '1'), row('b', '1'), row('c', '2', 0, ''), row('d', '3')]);
    expect(hits.map((h) => h.post.id)).toEqual(['a', 'c']);
    expect(hits[1].product.image_url).toBe('https://img/g.jpg');
    expect(shopperCaption(hits[0].product, 1, 'https://x/r/A')).toContain('💰 ₪49.9');
    expect(shopperCaption(hits[1].product, 2, 'https://x/r/B')).not.toContain('💰');
    expect(hits[0].product.title).toBe('🔥 ידית הסתערות טקטית');
    expect(channelHits([{ ...row('e', '9', 1, ''), gallery_json: 'not json' }])).toEqual([]);
  });
});

describe('a hidden product found in the channel', () => {
  const POST = [
    '🔧 ידיות הסתערות לשדרוג הנשק 🔧', '',
    '⚠️ שימו לב: מדובר מוצר מוסתר — בעמוד ייתכן שיופיע מוצר אחר.',
    '➡️ להזמנה: https://s.click.aliexpress.com/e/_c3yh4uXV', '',
    'זוג ידיות הסתערות שחור ומדברי', '⚠️המוצר הוא מוצר מוסתר', 'יש לבחור בקוד XT-5',
  ].join('\n');

  it('is matched by the reader\'s words and carries the post\'s instructions to the reader', () => {
    const terms = channelSearchTerms('ידיות הסתערות');
    expect(terms.every((t) => POST.includes(t))).toBe(true);
    const [hit] = channelHits([{ id: 'a', product_id: 'custom-1', product_title: 'פוסט מתוזמן',
      product_image: 'https://img/x.jpg', generated_text: POST, price_ils: 0 }], 2, terms);
    expect(hit.product.title).toBe('🔧 ידיות הסתערות לשדרוג הנשק 🔧');
    const c = shopperCaption(hit.product, 1, 'https://x/r/A');
    expect(c).toContain('⚠️ מוצר מוסתר');
    expect(c).toContain('🔑 בעמוד בחרו את הקוד: XT-5');
    expect(c.split('\n').pop()).toContain('לרכישה');
  });

  it('adds nothing to an ordinary post, and no code when none is written', () => {
    expect(hiddenProductNotes('פנס טקטי חזק')).toEqual([]);
    expect(hiddenProductNotes('מוצר מוסתר — בחרו לפי התמונה')).toHaveLength(1);
    expect(hiddenProductNotes('מוצר מוסתר, קוד קופון: SAVE5')).toHaveLength(1);
  });
});

describe('channelPostLink', () => {
  const row = (over: any) => ({ id: 'a', product_id: 'c', product_title: '', product_image: 'i', price_ils: 0, generated_text: '', ...over });
  it('uses the stored link, else the first link in a hand-written post that is not Telegram', () => {
    expect(channelPostLink(row({ affiliate_url: 'https://s.click.aliexpress.com/e/A' }))).toBe('https://s.click.aliexpress.com/e/A');
    expect(channelPostLink(row({ affiliate_url: '', generated_text: 'בוט: https://t.me/nexlify_deals_bot?start=post\n➡️ להזמנה: https://s.click.aliexpress.com/e/_c3yh4uXV' })))
      .toBe('https://s.click.aliexpress.com/e/_c3yh4uXV');
    expect(channelPostLink(row({ generated_text: 'אין כאן קישור' }))).toBe('');
  });
});
