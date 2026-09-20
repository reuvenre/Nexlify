import { CtrRegression } from './regression';
import {
  REGRESSION_MEMORY_MS, RENOTIFY_DEEPER_BY, ReportedDrop, deserializeRegressions,
  forgetOldRegressions, mergeRegressions, rememberRegressions, serializeRegressions,
  unreportedRegressions,
} from './regression-memory';

/**
 * Watchdog #80 → #81: the same campaign, six hours apart, 592 clicks and then 593.
 *
 * A regression is a CONDITION measured over a 7-day rolling window, so once a campaign falls
 * it keeps answering the detector's query — with numbers that barely move — every 15 minutes
 * for a week. The 6h key throttle was never built for that: it turned one finding into an
 * issue every six hours, each one carrying a diagnosis that had already been written, read
 * and closed.
 *
 * The memory has to be matched to the WINDOW, not to the tick. But unlike a partial publish,
 * a condition can deteriorate — and a floor that falls further is news even while the first
 * fall is still remembered. Hence a memory that holds the DEPTH, not just the date.
 */
const reg = (campaignId: string, dropPercent: number): CtrRegression => ({
  campaignId,
  campaignName: `campaign ${campaignId}`,
  userId: 'u1',
  recentRate: 2.5,
  baselineRate: 4.3,
  dropPercent,
  recentPosts: 232,
  recentClicks: 592,
  baselinePosts: 498,
  baselineClicks: 2139,
});

describe('unreportedRegressions', () => {
  const NOW = Date.UTC(2026, 8, 20, 2, 30, 0);

  it('reports a fall the first time it is seen', () => {
    expect(unreportedRegressions([reg('a', 41)], new Map())).toHaveLength(1);
  });

  it('stays SILENT on the same fall six hours later — the #81 replay', () => {
    // 41% then 40%: one click of new information. The owner already has the diagnosis.
    const reported = new Map<string, ReportedDrop>([['a', { at: NOW - 6 * 3600_000, drop: 41 }]]);
    expect(unreportedRegressions([reg('a', 40)], reported)).toEqual([]);
  });

  it('speaks again when the floor falls FURTHER', () => {
    // A condition can deteriorate, and that is genuinely new. 41% → 60% is not the same
    // finding measured again; it is the thing getting worse.
    const reported = new Map<string, ReportedDrop>([['a', { at: NOW - 3600_000, drop: 41 }]]);
    expect(unreportedRegressions([reg('a', 41 + RENOTIFY_DEEPER_BY)], reported)).toHaveLength(1);
  });

  it('does not treat ordinary drift as a deterioration', () => {
    const reported = new Map<string, ReportedDrop>([['a', { at: NOW, drop: 41 }]]);
    expect(unreportedRegressions([reg('a', 41 + RENOTIFY_DEEPER_BY - 1)], reported)).toEqual([]);
  });

  it('still reports a DIFFERENT campaign that falls while the first is remembered', () => {
    // The whole point of remembering per campaign: a second group collapsing is its own news.
    const reported = new Map<string, ReportedDrop>([['a', { at: NOW, drop: 41 }]]);
    expect(unreportedRegressions([reg('a', 41), reg('b', 45)], reported).map((r) => r.campaignId))
      .toEqual(['b']);
  });

  it('does not write to the memory — that happens when the alert actually goes out', () => {
    // The key throttle can still drop a composed alert. Marking it here would silence a
    // campaign for a week that was never reported at all.
    const reported = new Map<string, ReportedDrop>();
    unreportedRegressions([reg('a', 41)], reported);
    expect(reported.size).toBe(0);
  });
});

describe('forgetOldRegressions', () => {
  const NOW = Date.UTC(2026, 8, 20, 2, 30, 0);

  it('keeps a campaign while its fall is still inside the window', () => {
    const reported = new Map<string, ReportedDrop>([['a', { at: NOW - 6 * 86400_000, drop: 41 }]]);
    forgetOldRegressions(reported, NOW);
    expect(reported.has('a')).toBe(true);
  });

  it('forgets once the fall can no longer be detected, so a NEW fall is reportable', () => {
    const reported = new Map<string, ReportedDrop>([['a', { at: NOW - REGRESSION_MEMORY_MS - 1, drop: 41 }]]);
    forgetOldRegressions(reported, NOW);
    expect(reported.size).toBe(0);
  });

  it('remembers for exactly as long as the detector can still see the drop', () => {
    // Shorter would re-report a finding already read; longer would hide a fresh fall.
    expect(REGRESSION_MEMORY_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('surviving a restart', () => {
  const NOW = Date.UTC(2026, 8, 20, 2, 30, 0);

  it('round-trips through the cache', () => {
    const before = new Map<string, ReportedDrop>([['a', { at: NOW - 3600_000, drop: 41 }]]);
    const after = deserializeRegressions(serializeRegressions(before), NOW);
    expect(unreportedRegressions([reg('a', 41)], after)).toEqual([]);
  });

  it('prunes on the way IN, so a restart cannot resurrect a forgotten campaign', () => {
    const stored = { fresh: { at: NOW - 3600_000, drop: 41 }, stale: { at: NOW - REGRESSION_MEMORY_MS - 1, drop: 41 } };
    const restored = deserializeRegressions(stored, NOW);
    expect(restored.has('fresh')).toBe(true);
    expect(restored.has('stale')).toBe(false);
  });

  it('forgets rather than throws on anything unreadable', () => {
    for (const junk of [undefined, null, '', 'not json', 0, [], [1], { a: 'nope' }, { a: { at: NaN, drop: 1 } }]) {
      expect(deserializeRegressions(junk, NOW).size).toBe(0);
    }
  });
});

describe('mergeRegressions', () => {
  const NOW = Date.UTC(2026, 8, 20, 2, 30, 0);

  it('leaves this process\'s memory ALONE when the cache answers empty', () => {
    // The mergePartials lesson (watchdog #78): assigning an empty cache answer over the live
    // memory clears it at the top of every tick, which is worse than no cache at all.
    const own = new Map<string, ReportedDrop>([['a', { at: NOW, drop: 41 }]]);
    mergeRegressions(own, deserializeRegressions(undefined, NOW));
    expect(own.has('a')).toBe(true);
  });

  it('adds what another process reported', () => {
    const own = new Map<string, ReportedDrop>([['a', { at: NOW, drop: 41 }]]);
    mergeRegressions(own, new Map([['b', { at: NOW, drop: 45 }]]));
    expect([...own.keys()].sort()).toEqual(['a', 'b']);
  });

  it('keeps the EARLIEST sighting, so a merge cannot reset the forget clock', () => {
    const first = NOW - 5 * 86400_000;
    const own = new Map<string, ReportedDrop>([['a', { at: first, drop: 41 }]]);
    mergeRegressions(own, new Map([['a', { at: NOW, drop: 41 }]]));
    expect(own.get('a')!.at).toBe(first);
  });

  it('keeps the DEEPER drop, so a merge can never silence a deterioration', () => {
    // If the cache remembered a shallower fall than this process reported, taking the
    // cache's number would make the next deeper reading look like news twice over.
    const own = new Map<string, ReportedDrop>([['a', { at: NOW, drop: 60 }]]);
    mergeRegressions(own, new Map([['a', { at: NOW, drop: 41 }]]));
    expect(own.get('a')!.drop).toBe(60);
  });
});

describe('the full cycle', () => {
  const NOW = Date.UTC(2026, 8, 20, 2, 30, 0);

  it('reports once, then holds its peace for the week — what #80/#81 should have done', () => {
    const memory = new Map<string, ReportedDrop>();

    const first = unreportedRegressions([reg('788c076d', 41)], memory);
    expect(first).toHaveLength(1);
    rememberRegressions(first, memory, NOW);

    // Six hours later, one extra click.
    expect(unreportedRegressions([reg('788c076d', 40)], memory)).toEqual([]);

    // A deploy restarts the process; the memory comes back from the cache.
    const afterRestart = deserializeRegressions(serializeRegressions(memory), NOW + 6 * 3600_000);
    expect(unreportedRegressions([reg('788c076d', 40)], afterRestart)).toEqual([]);

    // Eight days on, the drop has aged out and a fresh fall is news again.
    const later = NOW + 8 * 86400_000;
    forgetOldRegressions(afterRestart, later);
    expect(unreportedRegressions([reg('788c076d', 41)], afterRestart)).toHaveLength(1);
  });
});
