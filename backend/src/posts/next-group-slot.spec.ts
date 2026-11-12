import { PostsService } from './posts.service';

/**
 * Regression tests for nextGroupSlot's pacing gate.
 *
 * Both cases below caused the same production symptom — an hourly campaign publishing
 * roughly every 2 hours, or going silent for hours — and neither raised an error, which is
 * exactly why they need locking down here rather than being left to the watchdog.
 */
describe('PostsService.nextGroupSlot', () => {
  const GROUP = '-1002382502297';
  const MINE = '788c076d-a31a-4c22-a932-dffadd51186b';
  const SIBLING = 'f0000000-0000-4000-8000-000000000000';
  const MIN = 60_000;

  // These cases read the real clock, and a live sale day halves the group interval
  // (sale-calendar.ts). Run on 11.11 they saw 30 minutes where they expect 60.
  beforeAll(() => { process.env.SALE_PEAK_BOOST_DISABLED = '1'; });
  afterAll(() => { delete process.env.SALE_PEAK_BOOST_DISABLED; });

  /** Build a service with only the collaborators nextGroupSlot actually touches. */
  function serviceWith(rows: any[], intervalMin = 60) {
    const qb: any = new Proxy({}, {
      get: (_t, prop) => (prop === 'getRawMany' ? async () => rows : () => qb),
    });
    const repo: any = { createQueryBuilder: () => qb };
    const channels: any = {
      getIntervalMinutes: async () => intervalMin,
      // Window wide open, so these tests isolate the pacing decision from the send window.
      getScheduleWindow: async () => ({ startHour: 0, endHour: 24 }),
    };
    const credentials: any = { getRaw: async () => null };

    return new PostsService(
      repo, null as any, null as any, null as any,
      null as any, // uploadedImages — slot booking never touches it
      credentials, null as any, null as any, null as any,
      channels, null as any, null as any, null as any, null as any,
      null as any, // pinterest — slot booking never touches it
      null as any, // incentive — slot booking never touches it
    );
  }

  const iso = (ms: number) => new Date(ms).toISOString();

  it('lets the campaign post when a manual post landed just before it', async () => {
    // The reported bug: a manual post sent 32s before the campaign's own post made the
    // campaign yield its next run to a "sibling" with no cadence, halving its rate.
    const now = Date.now();
    const svc = serviceWith([
      { campaign_id: MINE, pending: null, sent: iso(now - 59 * MIN) },
      { campaign_id: null, pending: null, sent: iso(now - 59 * MIN - 32_000) },
    ]);

    const { skip } = await svc.nextGroupSlot('u1', GROUP, new Date(now), MINE);
    expect(skip).toBe(false);
  });

  it('ignores a post scheduled far beyond the current interval', async () => {
    // A manual announcement queued for tonight must not mark the group busy all afternoon.
    const now = Date.now();
    const svc = serviceWith([
      { campaign_id: null, pending: iso(now + 4 * 60 * MIN), sent: null },
    ]);

    const { skip } = await svc.nextGroupSlot('u1', GROUP, new Date(now), MINE);
    expect(skip).toBe(false);
  });

  it('still treats a post booked inside the interval as busy', async () => {
    // Back-pressure must survive the horizon fix: re-spaced backlog lands one interval out.
    const now = Date.now();
    const svc = serviceWith([
      { campaign_id: null, pending: iso(now + 30 * MIN), sent: null },
    ]);

    const { skip } = await svc.nextGroupSlot('u1', GROUP, new Date(now), MINE);
    expect(skip).toBe(true);
  });

  it('still yields the slot to a campaign that is further behind', async () => {
    // Fair-share between real campaigns is the behaviour we want to keep.
    const now = Date.now();
    const svc = serviceWith([
      { campaign_id: MINE, pending: null, sent: iso(now - 59 * MIN) },
      { campaign_id: SIBLING, pending: null, sent: iso(now - 3 * 60 * MIN) },
    ]);

    const { skip } = await svc.nextGroupSlot('u1', GROUP, new Date(now), MINE);
    expect(skip).toBe(true);
  });

  it('queues behind a sibling campaign instead of skipping the run', async () => {
    // Watchdog #26: the 3-hourly FLYLINK campaign fires the same minute as the hourly
    // campaign sharing its group. The hourly one books first, and treating ANY booking as
    // "group busy" skipped FLYLINK on every single run — 13 hours silent while the sibling
    // published hourly. It must take the NEXT slot, not lose the run.
    const now = Date.now();
    const siblingSlot = now + 2 * MIN;
    const svc = serviceWith([
      { campaign_id: SIBLING, pending: iso(siblingSlot), sent: null },
    ]);

    const { slot, skip } = await svc.nextGroupSlot('u1', GROUP, new Date(now), MINE);
    expect(skip).toBe(false);
    // One full interval after the sibling's post — the group still publishes 1/hour.
    expect(slot.getTime()).toBe(siblingSlot + 60 * MIN);
  });

  it('does not stack a second post when this campaign is already booked', async () => {
    // The anti-pile-up invariant: at most ONE booked post per campaign per group, which is
    // what keeps the queue depth bounded now that a sibling's booking no longer blocks.
    const now = Date.now();
    const svc = serviceWith([
      { campaign_id: MINE, pending: iso(now + 20 * MIN), sent: null },
    ]);

    const { skip } = await svc.nextGroupSlot('u1', GROUP, new Date(now), MINE);
    expect(skip).toBe(true);
  });

  it('is not fooled by a far booking shadowing a near one (manual re-timing)', async () => {
    // The owner spread pasted products manually across the evening. The raw MAX pending
    // is the FURTHEST one — past the horizon — and it used to shadow the near booking:
    // the group looked free and the scheduler stacked a post next to the owner's 16:00.
    // The query now also reports the horizon-bounded booking (pending_near); occupancy
    // must read it and skip.
    const now = Date.now();
    const svc = serviceWith([
      { campaign_id: MINE, pending: iso(now + 4 * 60 * MIN), pending_near: iso(now + 20 * MIN), sent: null },
    ]);

    const { skip } = await svc.nextGroupSlot('u1', GROUP, new Date(now), MINE);
    expect(skip).toBe(true);
  });

  it('skips when this campaign itself published within the interval', async () => {
    // Its own cadence is already satisfied — this is the halving guard, and it must not be
    // loosened by the sibling fix above.
    const now = Date.now();
    const svc = serviceWith([
      { campaign_id: MINE, pending: null, sent: iso(now - 10 * MIN) },
    ]);

    const { skip } = await svc.nextGroupSlot('u1', GROUP, new Date(now), MINE);
    expect(skip).toBe(true);
  });
});
