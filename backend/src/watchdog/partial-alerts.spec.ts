import {
  PARTIAL_MEMORY_MS, deserializePartials, forgetOldPartials, serializePartials, unreportedPartials,
} from './partial-alerts';

/**
 * Watchdog #68 → #69 → #70: three issues for two failures.
 *
 * One Instagram post failed at 04:32 and one Telegram post at 06:01. Both were reported,
 * fixed and closed — and then reported again, because the scan is a rolling 6h window and
 * the throttle key is built from the platforms that happen to be IN that window. As the
 * Instagram post aged out, the key went `Instagram` → `Instagram,Telegram` → `Telegram`,
 * and each new key looked untouched to the throttle.
 *
 * The memory has to be per POST for that reason: a failure is an event, and an event is
 * only news once.
 */
describe('unreportedPartials', () => {
  const NOW = Date.UTC(2026, 8, 8, 10, 45);
  const ig = { id: 'b8e43316', error_message: 'Instagram: unexpected error' };
  const tg = { id: '2f9201c9', error_message: 'Telegram: ETIMEDOUT' };

  it('reports a failure the first time it is seen', () => {
    expect(unreportedPartials([ig, tg], new Map())).toEqual([ig, tg]);
  });

  it('never reports the same post twice, whatever the key does around it', () => {
    // The exact #70 replay: the Telegram post alone in the window, under a key nothing has
    // ever seen. The key is new; the post is not.
    const reported = new Map([['b8e43316', NOW - 6 * 3600_000], ['2f9201c9', NOW - 4 * 3600_000]]);
    expect(unreportedPartials([tg], reported)).toEqual([]);
  });

  it('still reports a NEW post that shares the window with an old one', () => {
    // The point of remembering posts rather than muting the platform: a second Instagram
    // failure is real news even while the first is still in the window.
    const reported = new Map([['b8e43316', NOW - 3600_000]]);
    const second = { id: 'c0ffee', error_message: 'Instagram: unexpected error' };
    expect(unreportedPartials([ig, second], reported)).toEqual([second]);
  });

  it('does not write to the memory — that happens when the alert actually goes out', () => {
    // An alert can still be dropped by the key throttle after being composed. Marking the
    // posts here would bury them: silenced without ever having been reported.
    const reported = new Map<string, number>();
    unreportedPartials([ig, tg], reported);
    expect(reported.size).toBe(0);
  });
});

describe('forgetOldPartials', () => {
  const NOW = Date.UTC(2026, 8, 8, 10, 45);

  it('keeps ids the 6h scan window can still return', () => {
    const reported = new Map([['recent', NOW - 5 * 3600_000]]);
    forgetOldPartials(reported, NOW);
    expect(reported.has('recent')).toBe(true);
  });

  it('drops ids the query can no longer surface, so the memory stays bounded', () => {
    const reported = new Map([['ancient', NOW - PARTIAL_MEMORY_MS - 1]]);
    forgetOldPartials(reported, NOW);
    expect(reported.size).toBe(0);
  });

  it('forgets only well AFTER the post has left the scan window', () => {
    // Forgetting inside the window would re-report the very post it just forgot.
    expect(PARTIAL_MEMORY_MS).toBeGreaterThan(6 * 3600_000);
  });
});

/**
 * The memory has to outlive the process, or "reported once, never again" is only a promise
 * about the current uptime.
 *
 * Watchdog #74 is what that costs: two posts whose issues had been fixed and closed that same
 * hour were re-raised minutes after a deploy, in the middle of an incident, reading as "the
 * fixes didn't work". The scan window is six hours and a busy morning has more deploys than
 * that — so in-process memory was, in practice, no memory at all.
 */
describe('remembering across a restart', () => {
  const NOW = Date.UTC(2026, 8, 14, 9, 0, 0);
  const recent = NOW - 60_000;

  it('survives the round trip', () => {
    const before = new Map([['post-a', recent], ['post-b', recent]]);
    const after = deserializePartials(serializePartials(before), NOW);
    expect([...after.keys()].sort()).toEqual(['post-a', 'post-b']);
    expect(unreportedPartials([{ id: 'post-a' }, { id: 'post-c' }], after)).toEqual([{ id: 'post-c' }]);
  });

  it('prunes on the way IN, so a restart cannot resurrect a forgotten id', () => {
    // The running process drops ids past the window; a restore that ignored age would put
    // them back and mute a post that has since failed again.
    const stored = { fresh: recent, stale: NOW - PARTIAL_MEMORY_MS - 1 };
    const restored = deserializePartials(stored, NOW);
    expect(restored.has('fresh')).toBe(true);
    expect(restored.has('stale')).toBe(false);
  });

  it('keeps an id sitting exactly ON the boundary', () => {
    expect(deserializePartials({ edge: NOW - PARTIAL_MEMORY_MS }, NOW).has('edge')).toBe(true);
  });

  it('forgets rather than throws on anything unreadable', () => {
    // A dead cache, a half-written value, a shape from an older deploy. The cost of
    // forgetting is one duplicate alert; the cost of throwing is a watchdog that stops.
    for (const junk of [undefined, null, '', 'not json', 0, [], [1, 2], { id: 'nope' }, { id: NaN }]) {
      expect(deserializePartials(junk, NOW).size).toBe(0);
    }
  });

  it('round-trips an EMPTY memory without inventing anything', () => {
    expect(deserializePartials(serializePartials(new Map()), NOW).size).toBe(0);
  });
});
