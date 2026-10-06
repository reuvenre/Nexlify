import { START_SOURCES, parseStartSource, startsReport } from './bot-start';

describe('parseStartSource', () => {
  it.each([
    ['/start inv_alert', 'inv_alert'],
    ['/start@DealsBot inv_words', 'inv_words'],
    ['/start PIN', 'pin'],
    ['/start post', 'post'],
    ['/start', 'direct'],
    ['/start <script>', 'other'],
    ['/start somebody_elses_code', 'other'],
  ])('%s → %s', (text, source) => {
    expect(parseStartSource(text)).toBe(source);
  });

  it('is null for anything but /start', () => {
    expect(parseStartSource('פנס טקטי')).toBeNull();
    expect(parseStartSource('/stop')).toBeNull();
    expect(parseStartSource('/starts inv_alert')).toBeNull();
  });

  it('every source fits the column', () => {
    for (const k of [...Object.keys(START_SOURCES), 'direct', 'other']) expect(k.length).toBeLessThanOrEqual(24);
  });
});

describe('startsReport', () => {
  it('lists sources by entries, most first, with a total', () => {
    const out = startsReport([{ source: 'inv_find', n: 3 }, { source: 'inv_alert', n: 9 }, { source: 'direct', n: 1 }], 7);
    expect(out.split('\n')).toEqual([
      '🚪 כניסות לבוט ב-7 ימים: 13',
      `   ${START_SOURCES.inv_alert} — 9`,
      `   ${START_SOURCES.inv_find} — 3`,
      '   🔗 ישירות (בלי קישור) — 1',
    ]);
  });

  it('says so when nobody came in yet', () => {
    expect(startsReport([], 7)).toBe('🚪 כניסות לבוט ב-7 ימים: עדיין אין');
  });
});
