import {
  THROTTLE_MEMORY_KEY, THROTTLE_MS, deserializeThrottle, forgetOldThrottles, mergeThrottle,
  serializeThrottle, throttled,
} from './throttle-memory';

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;

describe('the watchdog throttle memory', () => {
  it('names one key, so two processes read the same memory', () => {
    expect(THROTTLE_MEMORY_KEY).toBe('watchdog:throttle');
  });

  it('holds a key for six hours', () => {
    expect(THROTTLE_MS).toBe(6 * HOUR);
  });

  describe('deciding whether a key may speak', () => {
    it('suppresses a key reported a minute ago', () => {
      const reported = new Map([['failure_spike', NOW - MIN]]);
      expect(throttled(reported, 'failure_spike', NOW)).toBe(true);
    });

    it('releases a key once the window has passed', () => {
      const reported = new Map([['failure_spike', NOW - THROTTLE_MS - MIN]]);
      expect(throttled(reported, 'failure_spike', NOW)).toBe(false);
    });

    it('releases a key exactly on the boundary rather than a tick later', () => {
      const reported = new Map([['failure_spike', NOW - THROTTLE_MS]]);
      expect(throttled(reported, 'failure_spike', NOW)).toBe(false);
    });

    it('lets a key nobody has reported through', () => {
      expect(throttled(new Map(), 'failure_spike', NOW)).toBe(false);
    });
  });

  describe('a round trip through the store', () => {
    it('brings every key back', () => {
      const reported = new Map([['failure_spike', NOW - MIN], ['dead_campaigns:a,b', NOW - 2 * MIN]]);
      const back = deserializeThrottle(serializeThrottle(reported), NOW);
      expect(back.get('failure_spike')).toBe(NOW - MIN);
      expect(back.get('dead_campaigns:a,b')).toBe(NOW - 2 * MIN);
    });

    it('survives a key with Hebrew and punctuation in it', () => {
      const key = 'partial_publish:Instagram,Facebook · "מאמא מותגים"';
      const back = deserializeThrottle(serializeThrottle(new Map([[key, NOW - MIN]])), NOW);
      expect(back.get(key)).toBe(NOW - MIN);
    });

    it('drops a key whose throttle expired while the process was down', () => {
      const stored = { fresh: NOW - HOUR, stale: NOW - THROTTLE_MS - MIN };
      const back = deserializeThrottle(stored, NOW);
      expect(back.has('fresh')).toBe(true);
      expect(back.has('stale')).toBe(false);
    });
  });

  describe('restoring from something unreadable', () => {
    it.each([
      ['nothing at all', null],
      ['an absent key', undefined],
      ['an array from an older shape', [1, 2, 3]],
      ['a bare string', 'watchdog:throttle'],
    ])('yields an empty memory for %s instead of throwing', (_label, raw) => {
      expect(deserializeThrottle(raw as unknown, NOW).size).toBe(0);
    });

    it('keeps the readable entries and skips the rest', () => {
      const back = deserializeThrottle(
        { good: NOW - MIN, notANumber: 'soon', infinite: Infinity }, NOW,
      );
      expect(back.size).toBe(1);
      expect(back.get('good')).toBe(NOW - MIN);
    });
  });

  describe('merging another process\'s memory', () => {
    it('adds keys this process never saw', () => {
      const own = new Map([['mine', NOW - MIN]]);
      mergeThrottle(own, new Map([['theirs', NOW - 2 * MIN]]));
      expect(own.get('theirs')).toBe(NOW - 2 * MIN);
      expect(own.get('mine')).toBe(NOW - MIN);
    });

    it('keeps the LATEST report of a shared key, so the throttle is not released early', () => {
      const own = new Map([['shared', NOW - 5 * HOUR]]);
      mergeThrottle(own, new Map([['shared', NOW - MIN]]));
      expect(own.get('shared')).toBe(NOW - MIN);
      expect(throttled(own, 'shared', NOW)).toBe(true);
    });

    it('does not let an older stamp reopen a key this process just reported', () => {
      const own = new Map([['shared', NOW - MIN]]);
      mergeThrottle(own, new Map([['shared', NOW - 5 * HOUR]]));
      expect(own.get('shared')).toBe(NOW - MIN);
    });

    it('leaves the live memory untouched when the store answers empty — the #78 mistake', () => {
      const own = new Map([['mine', NOW - MIN]]);
      mergeThrottle(own, deserializeThrottle(null, NOW));
      expect(own.get('mine')).toBe(NOW - MIN);
      expect(throttled(own, 'mine', NOW)).toBe(true);
    });
  });

  describe('forgetting', () => {
    it('drops keys past the window and keeps the rest', () => {
      const reported = new Map([['fresh', NOW - HOUR], ['stale', NOW - THROTTLE_MS - MIN]]);
      forgetOldThrottles(reported, NOW);
      expect([...reported.keys()]).toEqual(['fresh']);
    });

    it('leaves a memory with nothing stale in it alone', () => {
      const reported = new Map([['a', NOW - MIN], ['b', NOW - HOUR]]);
      forgetOldThrottles(reported, NOW);
      expect(reported.size).toBe(2);
    });
  });

  it('keeps a key suppressed across a deploy that lands mid-window', () => {
    // What actually happens on Render: report, deploy, fresh process, next tick.
    const before = new Map<string, number>();
    before.set('ctr_regression:ali4you', NOW);
    const stored = serializeThrottle(before);

    const afterDeploy = new Map<string, number>(); // the new process knows nothing
    mergeThrottle(afterDeploy, deserializeThrottle(stored, NOW + 15 * MIN));

    expect(throttled(afterDeploy, 'ctr_regression:ali4you', NOW + 15 * MIN)).toBe(true);
  });
});
