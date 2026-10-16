import {
  FLYLINK_LEGACY_MARKS, FLYLINK_TRUST_MARK, flylinkTrustBlock,
  hasFlylinkTrustBlock, isFlylinkPost, stripReplicaWord, compactHiddenProductNotice, HIDDEN_PRODUCT_NOTICE,
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

  it('never says «רפליקה», on any platform (the owner asked for the word to go)', () => {
    for (const p of ['telegram', 'whatsapp', 'facebook', 'instagram', 'pinterest', undefined] as const) {
      expect(flylinkTrustBlock(p)).not.toContain('רפליקה');
    }
  });

  it('is the same block on every platform', () => {
    expect(flylinkTrustBlock('telegram')).toBe(flylinkTrustBlock('facebook'));
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

  it('adds nothing when the template already says it all', () => {
    expect(flylinkTrustBlock('telegram', TEMPLATE_BODY)).toBe('');
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

describe('compactHiddenProductNotice', () => {
  it('turns the template\'s three-line notice into the owner\'s one line', () => {
    const body = [
      '✔️ שילוב חומרים איכותיים',
      '',
      '⚠️שימו לב מוצר מוסתר - בעמוד המוצר יופיע פריט אחר.',
      'יש לבחור צבע לפי הקוד בתמונות.',
      'ומידה לפי טבלת המידות.',
      '',
      '‏💰 ₪203',
    ].join('\n');
    expect(compactHiddenProductNotice(body)).toBe([
      '✔️ שילוב חומרים איכותיים',
      '',
      HIDDEN_PRODUCT_NOTICE,
      '',
      '‏💰 ₪203',
    ].join('\n'));
  });

  it('is idempotent and leaves posts without the notice alone', () => {
    expect(compactHiddenProductNotice(HIDDEN_PRODUCT_NOTICE)).toBe(HIDDEN_PRODUCT_NOTICE);
    expect(compactHiddenProductNotice('סתם פוסט')).toBe('סתם פוסט');
  });
});

describe('stripReplicaWord', () => {
  it('drops the retired trailer line from an already-queued post', () => {
    const body = 'שורה ראשונה\n🏷️ המוצר הינו רפליקה של המקור באיכות גבוהה\n📦 מספר מעקב';
    expect(stripReplicaWord(body)).toBe('שורה ראשונה\n📦 מספר מעקב');
  });

  it('catches the word with a prefix, in the plural, and in English', () => {
    expect(stripReplicaWord('א\nזו הרפליקה הכי טובה\nב')).toBe('א\nב');
    expect(stripReplicaWord('א\nרפליקות במחיר מעולה\nב')).toBe('א\nב');
    expect(stripReplicaWord('א\nTop Replica quality\nב')).toBe('א\nב');
  });

  it('leaves a word that only contains the letters alone', () => {
    // A boundary that is not checked would eat any word with "רפליק" inside it.
    expect(stripReplicaWord('ארפליקציה')).toBe('ארפליקציה');
    expect(stripReplicaWord('replicate the look')).toBe('replicate the look');
  });

  it('never drops a line because its link happens to contain the word', () => {
    const line = '🛒 לרכישה: https://s.flylinking.com/replica-watch-123';
    expect(stripReplicaWord(line)).toBe(line);
    const html = '<a href="https://x.example/replica">לרכישה</a>';
    expect(stripReplicaWord(html)).toBe(html);
  });

  it('does not leave a gap of blank lines behind', () => {
    expect(stripReplicaWord('א\n\nרפליקה\n\nב')).toBe('א\n\nב');
  });
});
