import {
  buildSmartIntakePrompt, fallbackKeyword, parseIntakeVerdict,
} from './smart-intake';

describe('parseIntakeVerdict', () => {
  it('reads a clean verdict', () => {
    const v = parseIntakeVerdict('{"campaign": 1, "keyword": "jewelry organizer", "reason": "מתאים"}', 3);
    expect(v).toEqual({ campaign: 1, keyword: 'jewelry organizer', reason: 'מתאים' });
  });

  it('reads a verdict wrapped in prose or code fences', () => {
    const v = parseIntakeVerdict('Sure!\n```json\n{"campaign": 0, "keyword": "camping lantern", "reason": "x"}\n```', 2);
    expect(v?.campaign).toBe(0);
    expect(v?.keyword).toBe('camping lantern');
  });

  it('clamps an out-of-range campaign index to -1, never to a real campaign', () => {
    // A hallucinated index must not route a product to an arbitrary audience.
    expect(parseIntakeVerdict('{"campaign": 7, "keyword": "storage box", "reason": ""}', 3)!.campaign).toBe(-1);
    expect(parseIntakeVerdict('{"campaign": -5, "keyword": "storage box", "reason": ""}', 3)!.campaign).toBe(-1);
  });

  it('fails CLOSED on garbage — no verdict beats a guessed one', () => {
    expect(parseIntakeVerdict('cannot decide', 3)).toBeNull();
    expect(parseIntakeVerdict('{"campaign": 1}', 3)).toBeNull(); // no keyword
    expect(parseIntakeVerdict('', 3)).toBeNull();
  });

  it('rejects an absurdly long keyword — that is a title, not a search phrase', () => {
    const long = 'x'.repeat(80);
    expect(parseIntakeVerdict(`{"campaign": 0, "keyword": "${long}", "reason": ""}`, 1)).toBeNull();
  });
});

describe('fallbackKeyword', () => {
  it('takes the first meaningful words of a marketing title', () => {
    expect(fallbackKeyword('Flexible Kitchen Scraper Spatula for Nonstick Pans 2024 Hot'))
      .toBe('flexible kitchen scraper');
  });

  it('drops short tokens and bare numbers', () => {
    expect(fallbackKeyword('3Pcs LED USB Mini Fan for Home')).toBe('3pcs led usb');
  });

  it('survives an empty title', () => {
    expect(fallbackKeyword('')).toBe('');
  });
});

describe('buildSmartIntakePrompt', () => {
  it('numbers the campaigns so the verdict index is unambiguous', () => {
    const p = buildSmartIntakePrompt(
      { title: 'Storage Box', category: 'Home' },
      [
        { name: 'מאמא', keywords: ['kitchen gadgets'], channels: ['מאמא מותגים'] },
        { name: 'Pinterest', keywords: ['jewelry organizer'], channels: [] },
      ],
    );
    expect(p).toContain('0. "מאמא"');
    expect(p).toContain('1. "Pinterest"');
    expect(p).toContain('Category: ⟦Home⟧');
  });
});
