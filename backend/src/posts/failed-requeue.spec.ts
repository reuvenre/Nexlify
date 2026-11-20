import { MAX_REQUEUES, isRequeueableFailure, requeueAt } from './failed-requeue';
import { isRetryableNetworkPartial } from './network-partial';

describe('failed post requeue', () => {
  it('requeues only failures the platform provably did not publish', () => {
    expect(isRequeueableFailure('Telegram: Bad Gateway')).toBe(true);
    expect(isRequeueableFailure('Telegram: [טקטי בקליק] Too Many Requests: retry after 7')).toBe(true);
    expect(isRequeueableFailure('Telegram: שגיאת חיבור לטלגרם (ECONNRESET) [net]')).toBe(true);
    expect(isRequeueableFailure('Telegram: Bad Gateway | Facebook: שגיאת רשת [net]')).toBe(true);
  });

  it('never requeues what may already be live or needs the owner', () => {
    expect(isRequeueableFailure('Timed out — server may have restarted during send')).toBe(false);
    expect(isRequeueableFailure('Telegram: timeout of 30000ms exceeded')).toBe(false);
    expect(isRequeueableFailure('Telegram: Bad Request: chat not found')).toBe(false);
    expect(isRequeueableFailure('נגמרו הקרדיטים בתוכנית שלך — שדרג תוכנית בהגדרות ← מנוי')).toBe(false);
    expect(isRequeueableFailure('Pinterest: Sorry we could not fetch the image.')).toBe(false);
    // A mixed failure: the unsafe half would fail again, or publish twice.
    expect(isRequeueableFailure('Telegram: Bad Gateway | Instagram: token expired')).toBe(false);
    expect(isRequeueableFailure('')).toBe(false);
  });

  it('spaces the attempts and stops after the last one', () => {
    const now = Date.UTC(2026, 10, 20, 10, 0);
    expect(requeueAt(0, now)!.getTime() - now).toBe(5 * 60_000);
    expect(requeueAt(1, now)!.getTime() - now).toBe(15 * 60_000);
    expect(requeueAt(2, now)!.getTime() - now).toBe(45 * 60_000);
    expect(requeueAt(MAX_REQUEUES, now)).toBeNull();
  });

  it('lets the partial-publish retry take a Telegram 502 too', () => {
    // 19.11.2026: a post reached its other channel and lost Telegram to a 502, with no retry.
    expect(isRetryableNetworkPartial('Telegram: Bad Gateway')).toBe(true);
    expect(isRetryableNetworkPartial('Telegram: [קבוצה] Bad Gateway · נוסה שוב אוטומטית · נוסה שוב אוטומטית · נוסה שוב אוטומטית')).toBe(false);
  });
});

describe('send-stage marks', () => {
  it('are never mistaken for a requeueable failure', () => {
    const { PREPARING_MARK, SENDING_MARK } = require('./failed-requeue');
    expect(isRequeueableFailure(PREPARING_MARK)).toBe(false);
    expect(isRequeueableFailure(SENDING_MARK)).toBe(false);
    expect(PREPARING_MARK).not.toBe(SENDING_MARK);
  });
});
