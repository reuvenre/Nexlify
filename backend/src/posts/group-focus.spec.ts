import {
  FOCUS_REJECT_TTL_MS, flylinkFitItem, focusApplies, openTargets, focusHash, focusLabel, focusMemoryKey,
  liveRejections, mergeRejections, normalizeFocus,
} from './group-focus';
import {
  GROUP_FOCUS_SYSTEM, buildProductFitPrompt, isStrictFit, parseProductFitVerdicts,
} from './product-relevance';

const TACTICAL = { channelId: '-100', name: 'טקטי בקליק', focus: 'ציוד טקטי ואיירסופט: נרתיקים, אפודים, מסילות פיקטיני' };

describe('group focus', () => {
  it('stores the focus trimmed and capped, and blank clears it', () => {
    expect(normalizeFocus('  ציוד   טקטי \n ')).toBe('ציוד טקטי');
    expect(normalizeFocus('   ')).toBeNull();
    expect(normalizeFocus(null)).toBeNull();
    expect(normalizeFocus('x'.repeat(900))).toHaveLength(400);
  });

  it('remembers rejections per focus text, so a rewritten focus starts fresh', () => {
    const other = { ...TACTICAL, focus: 'ציוד טקטי בלבד' };
    expect(focusHash([TACTICAL])).not.toBe(focusHash([other]));
    expect(focusHash([TACTICAL, other])).toBe(focusHash([other, TACTICAL]));
    expect(focusMemoryKey('u1', [TACTICAL])).toBe(`group_focus_rejected:u1:${focusHash([TACTICAL])}`);
  });

  it('merges new rejections into the memory and lets old ones expire', () => {
    const now = 10 * FOCUS_REJECT_TTL_MS;
    const stored = { old: now - FOCUS_REJECT_TTL_MS - 1, recent: now - 1000 };
    expect([...liveRejections(stored, now)]).toEqual(['recent']);
    expect(mergeRejections(stored, ['new'], now)).toEqual({ recent: now - 1000, new: now });
    // An empty answer adds nothing and keeps what is live.
    expect(mergeRejections(stored, [], now)).toEqual({ recent: now - 1000 });
    expect(liveRejections(null, now).size).toBe(0);
  });

  it('names the group in the run note', () => {
    expect(focusLabel([TACTICAL])).toBe('מיקוד הקבוצה (טקטי בקליק)');
    expect(focusLabel([])).toBe('מיקוד הקבוצה');
  });

  it('judges a FLYLINK item by what the enrichment wrote, and skips a bare code', () => {
    expect(flylinkFitItem({ sku: 'LUN1526', title: 'LUN1526', description: '' })).toBeNull();
    expect(flylinkFitItem({
      sku: 'LUN1526', title: 'LUN1526', description: 'COACH',
      store_name: 'תיק צד', store_brand: 'Coach', store_category: 'תיקים',
    })).toEqual({ id: 'LUN1526', keyword: 'FLYLINK', title: 'תיק צד (Coach) — COACH', category: 'תיקים' });
    expect(flylinkFitItem({ id: 'p1', title: 'XT-5', store_category: 'נרתיקים' }))
      .toEqual({ id: 'p1', keyword: 'FLYLINK', title: 'XT-5', category: 'נרתיקים' });
  });
});

describe('the strict relevance question', () => {
  const ctx = { campaign: 'טקטי - אלי', channels: ['טקטי בקליק'], keywords: ['פנס'], focus: [TACTICAL] };

  it('applies only when a focus is declared', () => {
    expect(isStrictFit(ctx)).toBe(true);
    expect(isStrictFit({ ...ctx, focus: [] })).toBe(false);
    expect(isStrictFit({ ...ctx, focus: undefined })).toBe(false);
  });

  it('puts the focus in the brief and asks the strict question', () => {
    const prompt = buildProductFitPrompt(ctx, [{ keyword: 'פנס', title: 'LED flashlight' }]);
    expect(prompt).toContain('CORE FOCUS of "טקטי בקליק": ציוד טקטי ואיירסופט');
    expect(prompt).toContain('clearly sits inside the core focus');
    expect(GROUP_FOCUS_SYSTEM).toContain('When unsure, reject');
    const lenient = buildProductFitPrompt({ ...ctx, focus: [] }, [{ keyword: 'פנס', title: 'x' }]);
    expect(lenient).not.toContain('CORE FOCUS');
  });

  it('a product passes only on an explicit yes', () => {
    const v = parseProductFitVerdicts('[{"i":1,"fits":true},{"i":2,"fits":false,"reason":"פנס רגיל"}]', 3, true);
    expect(v[0]).toEqual({ fits: true, reason: '' });
    expect(v[1]).toEqual({ fits: false, reason: 'פנס רגיל' });
    expect(v[2].fits).toBe(false); // skipped by the judge: not shown to be inside
    // "fits": "yes" is not an explicit true.
    expect(parseProductFitVerdicts('[{"i":1,"fits":"yes"}]', 1, true)[0].fits).toBe(false);
  });

  it('an unreadable answer still accepts — a broken judge never silences the group', () => {
    expect(parseProductFitVerdicts('sorry, I cannot', 2, true)).toEqual([
      { fits: true, reason: '' }, { fits: true, reason: '' },
    ]);
    expect(parseProductFitVerdicts('{"i":1}', 1, true)[0].fits).toBe(true);
  });

  it('the lenient guard is unchanged: a skipped product still passes', () => {
    const v = parseProductFitVerdicts('[{"i":2,"fits":false,"reason":"x"}]', 2);
    expect(v.map((x) => x.fits)).toEqual([true, false]);
  });
});

describe('PostsService.groupFocusCheck', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PostsService } = require('./posts.service');

  function service(answer: string | (() => never), foci: any[] = [TACTICAL]) {
    const store = new Map<string, any>();
    const generate = jest.fn(async () => {
      if (typeof answer === 'function') answer();
      return { text: answer };
    });
    const svc: any = Object.create(PostsService.prototype);
    svc.ai = { hasAnyKey: () => true, generate };
    svc.channels = { getFocus: jest.fn(async () => foci) };
    svc.memory = {
      load: async (k: string) => store.get(k) ?? null,
      save: async (k: string, v: any) => { store.set(k, v); },
    };
    return { svc, generate, store };
  }
  const creds: any = { user_id: 'u1', telegram_channel_id: '-100' };
  const items = [
    { id: 'p1', keyword: 'פנס', title: 'LED camping flashlight' },
    { id: 'p2', keyword: 'נרתיק', title: 'Kydex holster' },
  ];

  it('asks the strict question, and remembers a rejection so it is not asked again', async () => {
    const { svc, generate, store } = service('[{"i":1,"fits":false,"reason":"פנס רגיל"},{"i":2,"fits":true}]');
    const first = await svc.groupFocusCheck('u1', creds, ['-100'], items, 'טקטי');
    expect(first.verdicts.map((v: any) => v.fits)).toEqual([false, true]);
    expect((generate.mock.calls[0] as any[])[1].system).toContain('CORE FOCUS');
    expect(Object.keys(store.get(focusMemoryKey('u1', [TACTICAL])))).toEqual(['p1']);

    generate.mockClear();
    const again = await svc.groupFocusCheck('u1', creds, ['-100'], [items[0]], 'טקטי');
    expect(again.verdicts[0]).toEqual({ fits: false, reason: 'מחוץ למיקוד (נבדק כבר)' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('a group without a focus asks nothing and passes everything', async () => {
    const { svc, generate } = service('[]', []);
    const r = await svc.groupFocusCheck('u1', creds, ['-100'], items);
    expect(r.verdicts.every((v: any) => v.fits)).toBe(true);
    expect(generate).not.toHaveBeenCalled();
  });

  it('a judge that fails passes everything and remembers nothing', async () => {
    const { svc, store } = service(() => { throw new Error('timeout'); });
    const r = await svc.groupFocusCheck('u1', creds, ['-100'], items);
    expect(r.verdicts.every((v: any) => v.fits)).toBe(true);
    expect(store.size).toBe(0);
  });

  it('a campaign on the default channel is checked against that group', async () => {
    const { svc } = service('[{"i":1,"fits":true},{"i":2,"fits":true}]');
    await svc.groupFocusCheck('u1', creds, [], items);
    expect(svc.channels.getFocus).toHaveBeenCalledWith('u1', ['-100']);
  });
});

describe('a campaign that never reaches the group (#101)', () => {
  it('the focus applies to every platform that reaches the group, not to Pinterest alone', () => {
    expect(focusApplies(null)).toBe(true);
    expect(focusApplies(new Set())).toBe(true);
    expect(focusApplies(new Set(['telegram']))).toBe(true);
    expect(focusApplies(new Set(['pinterest', 'facebook']))).toBe(true);
    expect(focusApplies(new Set(['pinterest']))).toBe(false);
  });

  it('a Pinterest-only campaign is not judged by the default group\'s focus', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PostsService } = require('./posts.service');
    const svc: any = Object.create(PostsService.prototype);
    const generate = jest.fn();
    svc.ai = { hasAnyKey: () => true, generate };
    svc.channels = { getFocus: jest.fn(async () => [TACTICAL]) };
    svc.memory = { load: async () => null, save: async () => undefined };
    const r = await svc.groupFocusCheck('u1', { user_id: 'u1', telegram_channel_id: '-100' }, [],
      [{ id: 'p1', keyword: 'halloween decorations', title: 'Halloween door wreath' }], 'קמפיין Pinterest', '["pinterest"]');
    expect(r.foci).toEqual([]);
    expect(r.verdicts[0].fits).toBe(true);
    expect(generate).not.toHaveBeenCalled();
    expect(svc.channels.getFocus).not.toHaveBeenCalled();
  });
});

describe('one group\'s focus never decides for its sister groups', () => {
  const MAMA = '-100888';
  it('the targets no focus speaks for stay open to a turned-down product', () => {
    expect(openTargets(['-100', MAMA], [TACTICAL])).toEqual([MAMA]);
    expect(openTargets(['-100'], [TACTICAL])).toEqual([]);
    expect(openTargets([MAMA], [])).toEqual([MAMA]);
  });

  it('groupFocusCheck reports which targets a rejected product may still go to', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PostsService } = require('./posts.service');
    const svc: any = Object.create(PostsService.prototype);
    svc.ai = { hasAnyKey: () => true, generate: async () => ({ text: '[{"i":1,"fits":false,"reason":"מוצר לבית"}]' }) };
    svc.channels = { getFocus: async () => [TACTICAL] };
    svc.memory = { load: async () => null, save: async () => undefined };
    const r = await svc.groupFocusCheck('u1', { user_id: 'u1' }, ['-100', MAMA],
      [{ id: 'p1', keyword: 'מארגן', title: 'Kitchen organizer' }]);
    expect(r.verdicts[0].fits).toBe(false);
    expect(r.open).toEqual([MAMA]);
  });
});
