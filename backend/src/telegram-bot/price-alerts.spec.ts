import {
  ALERT_STOP, ALERT_WATCH, isPriceDrop, isStopAlerts, parseAlertCallback, priceDropCaption, watchButton, watchable,
  watchingText,
} from './price-alerts';
import { SHOPPER_BUY_TEXT } from './shopper';

describe('price alerts', () => {
  describe('watchable', () => {
    it('takes an AliExpress product id', () => {
      expect(watchable({ product_id: '1005006123456789' })).toBe(true);
    });

    it('skips a channel post and an id the price API cannot read', () => {
      expect(watchable({ product_id: '1005006123456789', post_url: 'https://t.me/c/1' })).toBe(false);
      expect(watchable({ product_id: 'flylink-xt5' })).toBe(false);
      expect(watchable({ product_id: '' })).toBe(false);
    });
  });

  describe('buttons', () => {
    it('round-trips a watch and a stop tap', () => {
      const watch = watchButton('1005006123456789');
      const stop = watchButton('1005006123456789', true);
      expect(watch.callback_data).toBe(`${ALERT_WATCH}:1005006123456789`);
      expect(stop.callback_data).toBe(`${ALERT_STOP}:1005006123456789`);
      expect(parseAlertCallback(watch.callback_data)).toEqual({ action: 'watch', productId: '1005006123456789' });
      expect(parseAlertCallback(stop.callback_data)).toEqual({ action: 'stop', productId: '1005006123456789' });
      // Telegram caps callback_data at 64 bytes.
      expect(Buffer.byteLength(watch.callback_data)).toBeLessThanOrEqual(64);
    });

    it('ignores the owner bot\'s other buttons and tampered payloads', () => {
      expect(parseAlertCallback('rs:all')).toBeNull();
      expect(parseAlertCallback('pw:abc')).toBeNull();
      expect(parseAlertCallback('pw:1005006123456789; drop')).toBeNull();
      expect(parseAlertCallback('')).toBeNull();
    });
  });

  describe('isPriceDrop', () => {
    it('fires on a real drop', () => {
      expect(isPriceDrop(100, 90)).toBe(true);
      expect(isPriceDrop(100, 95)).toBe(true); // exactly 5 % and ₪5
    });

    it('stays quiet on noise: under 5 %, or under ₪2', () => {
      expect(isPriceDrop(100, 96)).toBe(false);
      expect(isPriceDrop(20, 18.5)).toBe(false); // 7.5 % but only ₪1.5
      expect(isPriceDrop(100, 100)).toBe(false);
      expect(isPriceDrop(100, 120)).toBe(false);
    });

    it('never fires on a missing or broken price', () => {
      expect(isPriceDrop(100, 0)).toBe(false);
      expect(isPriceDrop(100, NaN)).toBe(false);
      expect(isPriceDrop(0, 50)).toBe(false);
    });
  });

  describe('priceDropCaption', () => {
    const caption = priceDropCaption(
      { title: 'Tactical <foregrip> for hunting', price_ils: 80, currency: 'ILS' },
      { sale_price: 60, currency: 'ILS' },
      'https://nexlify.example/l/abc"x',
    );

    it('says how much, from what, and links to buy', () => {
      expect(caption).toContain('🔻 המחיר ירד!');
      expect(caption).toContain('₪60 במקום ₪80');
      expect(caption).toContain('ירד ב-25%');
      expect(caption).toContain(SHOPPER_BUY_TEXT);
    });

    it('escapes the seller\'s title and the link, and applies the word policy', () => {
      expect(caption).toContain('&lt;foregrip&gt;');
      expect(caption).not.toContain('<foregrip>');
      expect(caption).not.toMatch(/hunting/i);
      expect(caption).toContain('href="https://nexlify.example/l/abc&quot;x"');
    });

    it('never writes a leading minus (drawn backwards in RTL)', () => {
      expect(caption).not.toMatch(/(^|[\s(])-\d/m);
    });
  });

  it('tells the reader what they are waiting for', () => {
    expect(watchingText('מתפס פיקטיני', 49.9)).toBe('🔔 אעדכן אותך כשהמחיר של «מתפס פיקטיני» ירד מתחת ל-₪49.90.');
  });

  describe('isStopAlerts', () => {
    it.each(['/stop', '/stop@DealsBot', 'בטל התראות', 'בטל את כל ההתראות', 'הפסק התראות'])('reads %s', (t) => {
      expect(isStopAlerts(t)).toBe(true);
    });

    it.each(['stop', 'בטל', 'התראות', 'שעון עצר', 'בטל התראות של הטלפון'])('leaves %s as a search', (t) => {
      expect(isStopAlerts(t)).toBe(false);
    });
  });
});
