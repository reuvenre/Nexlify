import { applyWordPolicy, violatesWordPolicy } from './word-policy';

describe('the owner vocabulary policy', () => {
  describe('the word itself', () => {
    it('replaces it standing alone', () => {
      expect(applyWordPolicy('ציד')).toBe('טקטי');
    });

    it('replaces it in the compound it almost always appears in', () => {
      expect(applyWordPolicy('סכין ציד מתקפלת')).toBe('סכין טקטי מתקפלת');
      expect(applyWordPolicy('ציוד ציד לשטח')).toBe('ציוד טקטי לשטח');
    });

    it('replaces the hunter forms too', () => {
      expect(applyWordPolicy('צייד')).toBe('טקטי');
      expect(applyWordPolicy('ציידים')).toBe('טקטיים');
    });

    it('keeps the Hebrew prefix rather than swallowing it', () => {
      expect(applyWordPolicy('הציד')).toBe('הטקטי');
      expect(applyWordPolicy('ציוד לציד')).toBe('ציוד לטקטי');
      expect(applyWordPolicy('וציד')).toBe('וטקטי');
    });

    it('replaces every occurrence, not only the first', () => {
      expect(applyWordPolicy('ציד ועוד ציד')).toBe('טקטי ועוד טקטי');
    });

    it('works at the end of a sentence and against punctuation', () => {
      expect(applyWordPolicy('פנס ציד.')).toBe('פנס טקטי.');
      expect(applyWordPolicy('פנס ציד!')).toBe('פנס טקטי!');
      expect(applyWordPolicy('פנס ציד, חזק מאוד')).toBe('פנס טקטי, חזק מאוד');
    });
  });

  describe('words that merely CONTAIN those letters — the corruption this must not cause', () => {
    // "צד" (side) inflects into all of these. A substring replace turns real copy to gibberish.
    it.each([
      ['צידו', 'הכיס בצידו של התיק'],
      ['צידה', 'משקפת עם תאורה בצידה'],
      ['מצידי', 'מצידי שיקנו שניים'],
      ['הצידה', 'מזיז את המכשול הצידה'],
      ['לצידו', 'נרתיק שנצמד לצידו'],
      ['צידי', 'כיס צידי נוסף'],
    ])('leaves %s untouched', (_word, sentence) => {
      expect(applyWordPolicy(sentence)).toBe(sentence);
    });

    it('rewrites the real word in a sentence that also holds a lookalike', () => {
      expect(applyWordPolicy('סכין ציד עם נדן בצידו'))
        .toBe('סכין טקטי עם נדן בצידו');
    });
  });

  describe('links and markup — breaking one costs a commission', () => {
    it('does not rewrite inside a URL', () => {
      const text = 'קנו עכשיו 🔗 https://s.click.aliexpress.com/e/_hunting-knife-9912';
      expect(applyWordPolicy(text)).toBe(text);
    });

    it('rewrites the prose around a URL it left alone', () => {
      expect(applyWordPolicy('סכין ציד 🔗 https://x.co/hunting-1'))
        .toBe('סכין טקטי 🔗 https://x.co/hunting-1');
    });

    it('does not rewrite inside an HTML attribute', () => {
      const text = '<a href="https://x.co/hunter">לרכישה</a>';
      expect(applyWordPolicy(text)).toBe(text);
    });

    it('rewrites anchor TEXT while leaving its href alone', () => {
      expect(applyWordPolicy('<a href="https://x.co/hunter">ציד עכשיו</a>'))
        .toBe('<a href="https://x.co/hunter">טקטי עכשיו</a>');
    });

    it('keeps bold markup around a replaced word', () => {
      expect(applyWordPolicy('<b>סכין ציד</b>')).toBe('<b>סכין טקטי</b>');
    });
  });

  describe('English copy, for the Pinterest and English campaigns', () => {
    it('replaces the word and its forms', () => {
      expect(applyWordPolicy('Hunting knife')).toBe('tactical knife');
      expect(applyWordPolicy('a hunter favourite')).toBe('a tactical favourite');
    });

    it('does not match it inside a longer word', () => {
      expect(applyWordPolicy('Huntington gear')).toBe('Huntington gear');
    });
  });

  describe('leaving ordinary copy alone', () => {
    it.each([
      'סכין טקטית מתקפלת — 30 ש"ח בלבד',
      'פנס צבאי עוצמתי לשטח',
      '',
    ])('returns %p unchanged', (text) => {
      expect(applyWordPolicy(text)).toBe(text);
    });

    it('survives null and undefined rather than throwing mid-publish', () => {
      expect(applyWordPolicy(null as any)).toBeNull();
      expect(applyWordPolicy(undefined as any)).toBeUndefined();
    });

    it('is idempotent — running it twice changes nothing more', () => {
      const once = applyWordPolicy('סכין ציד וציוד ציד');
      expect(applyWordPolicy(once)).toBe(once);
    });
  });

  describe('reporting a violation', () => {
    it('is true only when the text would actually change', () => {
      expect(violatesWordPolicy('סכין ציד')).toBe(true);
      expect(violatesWordPolicy('סכין טקטית')).toBe(false);
      expect(violatesWordPolicy('הכיס בצידו')).toBe(false);
      expect(violatesWordPolicy('')).toBe(false);
    });
  });

  it('cleans a whole post body end to end', () => {
    const body = [
      '<b>🔥 סכין ציד מקצועית</b>',
      '',
      'להב פלדה עם נרתיק שנצמד לצידו של החגור — ציוד ציד אמין לכל יציאה.',
      '',
      '🔗 https://s.click.aliexpress.com/e/_hunting-9912',
    ].join('\n');

    expect(applyWordPolicy(body)).toBe([
      '<b>🔥 סכין טקטי מקצועית</b>',
      '',
      'להב פלדה עם נרתיק שנצמד לצידו של החגור — ציוד טקטי אמין לכל יציאה.',
      '',
      '🔗 https://s.click.aliexpress.com/e/_hunting-9912',
    ].join('\n'));
  });
});
