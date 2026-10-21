import { AI_UPLOAD_NOTE, DEFAULT_HASHTAGS, TELEGRAM_CAPTION_MAX, hashtagsFrom, ownerVideoCaption, shareText, toHashtag } from './reel-share';
import { REEL_CTA } from './reel-spec';

const spec = { headline: 'ידית אחיזה טקטית למסילת פיקטיני', reason: 'אחיזה יציבה לשטח', price: '₪89', was: '₪149', cta: REEL_CTA, brand: 'טקטי בקליק' };

describe('reel share', () => {
  it('writes the paste-ready text: hook, reason, price, where the link is, the group first in the hashtags', () => {
    const { caption, shortsTitle } = shareText(spec, DEFAULT_HASHTAGS);
    expect(caption).toBe([
      'ידית אחיזה טקטית למסילת פיקטיני', 'אחיזה יציבה לשטח', '💰 ₪89 במקום ₪149', REEL_CTA,
      '', '#טקטי_בקליק #אליאקספרס #דילים #מוצרים_מומלצים',
    ].join('\n'));
    expect(shortsTitle).toBe('ידית אחיזה טקטית למסילת פיקטיני #shorts');
  });

  it('says so when the Reel opens with an AI clip, and keeps a long title inside YouTube\'s 100', () => {
    const { caption, shortsTitle } = shareText({ ...spec, reason: undefined, was: undefined, headline: 'א'.repeat(120) }, ['#x1'], true);
    expect(caption).toMatch(/💰 ₪89\n/);
    expect(caption).toMatch(/AI להמחשה בלבד\.$/);
    expect(shortsTitle.length).toBeLessThanOrEqual(100);
    expect(shortsTitle).toMatch(/… #shorts$/);
  });

  it('makes hashtags from names and from REELS_HASHTAGS', () => {
    expect(toHashtag('מאמא מותגים!')).toBe('#מאמא_מותגים');
    expect(toHashtag(' ')).toBe('');
    expect(hashtagsFrom('#טקטי, ציוד  #outdoor')).toEqual(['#טקטי', '#ציוד', '#outdoor']);
    expect(hashtagsFrom(undefined)).toEqual(DEFAULT_HASHTAGS);
  });

  it('captions the file with what happened and how to reuse it, within Telegram\'s limit', () => {
    expect(ownerVideoCaption('🎬 פורסם', false)).toMatch(/^🎬 פורסם\n\n📲 לטיקטוק/);
    expect(ownerVideoCaption('🎬', true)).toContain(AI_UPLOAD_NOTE);
    expect(ownerVideoCaption('x'.repeat(2000), false).length).toBe(TELEGRAM_CAPTION_MAX);
  });
});
