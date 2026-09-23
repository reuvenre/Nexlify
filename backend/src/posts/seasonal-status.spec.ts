import { SeasonalStatus, seasonalRunNote } from './seasonal-status';

const status = (over: Partial<SeasonalStatus> = {}): SeasonalStatus => ({
  state: 'active',
  events: ['האלווין (ארה"ב)', 'קריסמס (ארה"ב)'],
  keywords: ['halloween decorations', 'christmas gifts'],
  ...over,
});

describe('the seasonal line in the run note', () => {
  describe('when the calendar has nothing to say', () => {
    it.each([
      ['on', 'active'],
      ['off at the account', 'account-off'],
      ['off in the plan', 'plan-off'],
      ['off on the campaign', 'campaign-off'],
    ])('stays silent with no open window, even when seasonal is %s', (_label, state) => {
      expect(seasonalRunNote(status({ state: state as any, events: [], keywords: [] }), 0)).toBeNull();
    });
  });

  describe('a switch is off while a window is open', () => {
    it('names the account switch and the screen it lives on', () => {
      const note = seasonalRunNote(status({ state: 'account-off', keywords: [] }), 0);
      expect(note).toContain('חלון פתוח: האלווין (ארה"ב), קריסמס (ארה"ב)');
      expect(note).toContain('הגדרות ← תזמון');
    });

    it('says when the plan is what is blocking it', () => {
      expect(seasonalRunNote(status({ state: 'plan-off', keywords: [] }), 0))
        .toContain('לא כלול בתוכנית');
    });

    it('points at the campaign toggle, not the account one', () => {
      const note = seasonalRunNote(status({ state: 'campaign-off', keywords: [] }), 0);
      expect(note).toContain('כבוי בקמפיין הזה');
      expect(note).not.toContain('הגדרות');
    });
  });

  describe('everything on', () => {
    it('reports the keywords and how many posts came from them', () => {
      const note = seasonalRunNote(status(), 2);
      expect(note).toContain('halloween decorations, christmas gifts');
      expect(note).toContain('2 פוסטים מהן');
    });

    it('reports ZERO explicitly — the switches are on and the filters are eating them', () => {
      // The whole point: an open window plus live keywords plus no posts is a campaign-filter
      // problem, and it is invisible in every other field.
      expect(seasonalRunNote(status(), 0)).toContain('0 פוסטים מהן');
    });

    it('says so when the open events carry no search terms for this language', () => {
      // Black Friday angles the copy and never says what to sell.
      const note = seasonalRunNote(status({ events: ['Black Friday'], keywords: [] }), 0);
      expect(note).toContain('הקשר לכתיבה בלבד');
      expect(note).not.toContain('פוסטים מהן');
    });
  });

  describe('staying inside the run-note budget', () => {
    it('caps a long event list rather than filling the field', () => {
      const note = seasonalRunNote(
        status({ events: ['א', 'ב', 'ג', 'ד', 'ה'], keywords: ['k1'] }), 1,
      );
      expect(note).toContain('א, ב, ג ועוד 2');
      expect(note!.length).toBeLessThan(200);
    });

    it('caps a long keyword list the same way', () => {
      const note = seasonalRunNote(
        status({ events: ['האלווין'], keywords: ['k1', 'k2', 'k3', 'k4'] }), 1,
      );
      expect(note).toContain('k1, k2, k3 ועוד 1');
    });

    it('leaves a short list untouched', () => {
      expect(seasonalRunNote(status({ events: ['האלווין'], keywords: ['k1'] }), 1))
        .toBe('🗓️ חלון פתוח: האלווין · k1 · 1 פוסטים מהן');
    });
  });

  it('reads the owner\'s actual case: US window open, pins publishing, no holiday products', () => {
    const note = seasonalRunNote(status(), 0);
    expect(note).toBe(
      '🗓️ חלון פתוח: האלווין (ארה"ב), קריסמס (ארה"ב) · halloween decorations, christmas gifts · 0 פוסטים מהן',
    );
  });
});
