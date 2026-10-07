import { REEL_CTA, buildReelSpec, plainLine, reelImages } from './reel-spec';

const post = {
  generated_text: [
    '🔥 <b>ידית אחיזה טקטית למסילת פיקטיני</b> 🔥',
    'אחיזה יציבה לציד ולשטח, עשויה ניילון מחוזק',
    '💰 מחיר: ₪89 במקום ₪149',
    '<a href="https://x.app/r/AbC">🛒 לרכישה — לחצו כאן 🛒</a>',
  ].join('\n'),
  product_title: 'Tactical Foregrip Picatinny',
  product_image: 'https://ae01.alicdn.com/kf/Smain111111111.jpg_.webp',
  gallery_json: JSON.stringify(['https://ae01.alicdn.com/kf/Sgal2222222222.jpg', 'https://ae01.alicdn.com/kf/Smain111111111.jpg']),
  price_ils: 89.4,
  sale_price_usd: 24,
  original_price_usd: 40,
};

describe('buildReelSpec', () => {
  it('takes the headline and the reason from our own copy, and the numbers from the post', () => {
    expect(buildReelSpec(post, 'טקטי בקליק')).toEqual({
      headline: 'ידית אחיזה טקטית למסילת פיקטיני',
      // the word policy applies — the text is burned into the video, past every filter
      reason: 'אחיזה יציבה לטקטי ולשטח, עשויה ניילון מחוזק',
      price: '₪89',
      was: '₪149',
      discount: 40,
      cta: REEL_CTA,
      brand: 'טקטי בקליק',
      images: ['https://ae01.alicdn.com/kf/Sgal2222222222.jpg', 'https://ae01.alicdn.com/kf/Smain111111111.jpg'],
    });
  });

  it('no image or no price — no video', () => {
    expect(buildReelSpec({ ...post, product_image: '', gallery_json: '[]' })).toBeNull();
    expect(buildReelSpec({ ...post, price_ils: 0 })).toBeNull();
  });

  it('falls back to the title, and leaves out a discount too small to show', () => {
    const s = buildReelSpec({ ...post, generated_text: '', original_price_usd: 24.5 })!;
    expect(s.headline).toBe('Tactical Foregrip Picatinny');
    expect(s.was).toBeUndefined();
    expect(s.discount).toBeUndefined();
  });

  it('cuts a long headline on a word', () => {
    const long = 'מנורת ראש טקטית נטענת עם עשרה מצבי תאורה ועמידות מלאה למים ולאבק לשטח';
    const s = buildReelSpec({ ...post, generated_text: long })!;
    expect(s.headline.length).toBeLessThanOrEqual(61);
    expect(s.headline.endsWith('…')).toBe(true);
  });
});

it('plainLine strips markup, emoji and fence marks', () => {
  expect(plainLine('🔥 <b>פנס &amp; סוללה</b> ⟦x⟧')).toBe('פנס & סוללה x');
});

it('reelImages: JPEG instead of the WebP variant, no duplicates, at most three', () => {
  expect(reelImages({ product_image: 'https://a/kf/S1.jpg_.webp', gallery_json: '["https://a/kf/S1.jpg","https://a/2.png","https://a/3.jpg","https://a/4.jpg"]' }))
    .toEqual(['https://a/kf/S1.jpg', 'https://a/2.png', 'https://a/3.jpg']);
});
