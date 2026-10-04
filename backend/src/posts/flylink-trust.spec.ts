import {
  FLYLINK_LEGACY_MARKS, FLYLINK_REPLICA_LINE, FLYLINK_TRUST_MARK, flylinkTrustBlock,
  hasFlylinkTrustBlock, isFlylinkPost, showsReplicaLine,
} from './flylink-trust';

describe('flylink trust trailer', () => {
  it('identifies FLYLINK posts by their link, like the coupon filter does', () => {
    expect(isFlylinkPost('https://www.flylink.io/p/abc123')).toBe(true);
    expect(isFlylinkPost('https://s.click.aliexpress.com/e/_x')).toBe(false);
    expect(isFlylinkPost('')).toBe(false);
    expect(isFlylinkPost(null)).toBe(false);
  });

  it('opens with the stable dedup marker', () => {
    expect(flylinkTrustBlock().startsWith(FLYLINK_TRUST_MARK)).toBe(true);
  });

  it('says out loud what the product is, on the owner\'s own channels', () => {
    expect(flylinkTrustBlock('telegram')).toContain(FLYLINK_REPLICA_LINE);
    expect(flylinkTrustBlock('whatsapp')).toContain(FLYLINK_REPLICA_LINE);
  });

  it('keeps the word off the platforms that ban replicas outright', () => {
    // Meta and Pinterest prohibit replica goods, and "רפליקה" in plain Hebrew is the
    // easiest possible match for their enforcement — the line that protects the buyer
    // would be the thing that costs the owner his page.
    for (const p of ['facebook', 'instagram', 'pinterest'] as const) {
      expect(flylinkTrustBlock(p)).not.toContain('רפליקה');
    }
    // Unknown platform is treated the same way: we cannot tell where this is going.
    expect(flylinkTrustBlock()).not.toContain('רפליקה');
    expect(showsReplicaLine(undefined)).toBe(false);
  });

  it('keeps the rest of the block identical on every platform', () => {
    const groups = flylinkTrustBlock('telegram').split('\n').filter((l) => l !== FLYLINK_REPLICA_LINE);
    expect(groups).toEqual(flylinkTrustBlock('facebook').split('\n'));
  });

  it('never over-promises — no delivery times, no authenticity claims', () => {
    const block = flylinkTrustBlock('telegram');
    // The one defect this block must never develop: a number or claim we can't stand
    // behind. Days-to-deliver and "מקורי"/"זהה" claims are the two ways that happens.
    expect(block).not.toMatch(/\d+\s*ימים/);
    expect(block).not.toMatch(/מקורי|זהה למקור|100%/);
  });

  it('states the deal, then why the photo can be trusted', () => {
    // The two lines that do the work, in this order: what you get, and the reason to
    // believe it. The second is the asset — "מה שרואים זה מה שמגיע" alone is the sentence
    // every dropshipper writes, and it convinces nobody by itself.
    const lines = flylinkTrustBlock('telegram').split('\n');
    expect(lines[0]).toContain('מה שבתמונה = מה שבקופסה');
    expect(lines[1]).toContain('צילומי המחסן של הפריט הזה');
  });

  it('claims only the photos, never their provenance beyond the warehouse', () => {
    // The warehouse may well be the manufacturer's, so "לא מהיצרן" is a claim we cannot
    // stand behind; and a post can carry a single photo, so a count would be a lie on it.
    const block = flylinkTrustBlock('telegram');
    expect(block).not.toMatch(/לא מהיצרן|מהיצרן/);
    expect(block).not.toMatch(/\d+\s*תמונות/);
  });
});

/**
 * The first line IS the "does this body already have a trailer" test, so rewording the
 * block breaks that test for every post carrying the previous wording — and a verbatim
 * re-post gets a second trailer stacked on the first. This is the guard.
 */
describe('hasFlylinkTrustBlock', () => {
  it('recognises the current block', () => {
    expect(hasFlylinkTrustBlock(`טקסט\n\n${flylinkTrustBlock('telegram')}`)).toBe(true);
  });

  it('still recognises every wording it ever shipped', () => {
    expect(FLYLINK_LEGACY_MARKS.length).toBeGreaterThan(0);
    for (const mark of FLYLINK_LEGACY_MARKS) {
      expect(hasFlylinkTrustBlock(`טקסט\n\n${mark} — מה שרואים בתמונות זה מה שמגיע`)).toBe(true);
    }
  });

  it('says no on a body that has none', () => {
    expect(hasFlylinkTrustBlock('סתם פוסט עם מחיר')).toBe(false);
    expect(hasFlylinkTrustBlock('')).toBe(false);
  });

  it('a retired mark is kept, never deleted', () => {
    // If someone reworded the block again and dropped the old mark instead of adding it
    // here, this is the test that fails.
    expect([...FLYLINK_LEGACY_MARKS]).toContain('📸 מהמפעל ישירות לצרכן');
  });
});

describe('flylinkTrustBlock against a post that already makes its points', () => {
  // The owner's FLYLINK template, as it went out (שלחו הודעה לפרטי, מספר מעקב, מהמפעל…).
  const TEMPLATE_BODY = [
    '🔥 נעלי ספורט אייקוניות בסגנון קלאסי ויוקרתי!',
    '‏💰 ₪203',
    '📸 כל מוצר מהמפעל ישירות לצרכן — מה שרואים בתמונות זה מה שמגיע',
    '📦 קבלת מספר מעקב ישירות למייל ומשלוח מהיר',
    '💬 מתלבטים? שלחו הודעה לפרטי לפני ההזמנה ונסייע בשמחה',
    '‏🛒 לרכישה — לחצו כאן 🛒',
  ].join('\n');

  it('adds only what the template does not say — the replica line', () => {
    expect(flylinkTrustBlock('telegram', TEMPLATE_BODY)).toBe(FLYLINK_REPLICA_LINE);
  });

  it('adds nothing on a platform without the replica line', () => {
    expect(flylinkTrustBlock('facebook', TEMPLATE_BODY)).toBe('');
  });

  it('never stacks a second trailer on a body that already carries one', () => {
    const once = `טקסט\n\n${flylinkTrustBlock('telegram')}`;
    expect(flylinkTrustBlock('telegram', once)).toBe('');
  });

  it('a bare post still gets the whole block', () => {
    expect(flylinkTrustBlock('telegram', 'סתם פוסט')).toBe(flylinkTrustBlock('telegram'));
  });
});
