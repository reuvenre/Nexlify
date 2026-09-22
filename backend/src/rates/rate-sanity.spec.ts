import { PLAUSIBLE_BANDS, isPlausibleRate, isPlausibleRates } from './rate-sanity';

const GOOD = { USD_ILS: 3.42, USD_EUR: 0.91, USD_GBP: 0.78, updated_at: '2026-09-22T00:00:00.000Z' };

describe('judging whether a number is an exchange rate', () => {
  describe('one pair at a time', () => {
    it('accepts a rate in its band', () => {
      expect(isPlausibleRate('USD_ILS', 3.42)).toBe(true);
      expect(isPlausibleRate('USD_EUR', 0.91)).toBe(true);
      expect(isPlausibleRate('USD_GBP', 0.78)).toBe(true);
    });

    it('accepts both ends of the band, so a real move to the edge is not rejected', () => {
      const [min, max] = PLAUSIBLE_BANDS.USD_ILS;
      expect(isPlausibleRate('USD_ILS', min)).toBe(true);
      expect(isPlausibleRate('USD_ILS', max)).toBe(true);
    });

    it('rejects a rate quoted the other way round', () => {
      expect(isPlausibleRate('USD_ILS', 1 / 3.42)).toBe(false); // 0.29 ILS per USD
    });

    it('rejects a base-currency mix-up', () => {
      expect(isPlausibleRate('USD_ILS', 41000)).toBe(false); // agorot, or a different base
    });

    it.each([
      ['zero', 0],
      ['negative', -3.42],
      ['a string', '3.42'],
      ['null', null],
      ['undefined', undefined],
      ['NaN', NaN],
      ['Infinity', Infinity],
    ])('rejects %s', (_label, value) => {
      expect(isPlausibleRate('USD_ILS', value as unknown)).toBe(false);
    });
  });

  describe('the whole set', () => {
    it('accepts a normal day', () => {
      expect(isPlausibleRates(GOOD)).toBe(true);
    });

    it('rejects the set when a single pair is wrong — the source is the suspect, not the number', () => {
      expect(isPlausibleRates({ ...GOOD, USD_EUR: 41000 })).toBe(false);
    });

    it('rejects a set with a pair missing', () => {
      const { USD_GBP, ...missing } = GOOD;
      expect(isPlausibleRates(missing as any)).toBe(false);
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['an empty object', {}],
      ['a string', 'USD_ILS=3.42'],
    ])('rejects %s rather than throwing', (_label, raw) => {
      expect(isPlausibleRates(raw as any)).toBe(false);
    });

    it('rejects an error body that arrived with a 200', () => {
      expect(isPlausibleRates({ error: 'quota exceeded' } as any)).toBe(false);
    });
  });

  it('keeps the hardcoded floor inside its own bands', () => {
    // The floor is what the service serves when nothing else is available. If it ever fell
    // outside these bands the service would reject its own last resort and serve nothing.
    expect(isPlausibleRates({ USD_ILS: 3.7, USD_EUR: 0.92, USD_GBP: 0.79 })).toBe(true);
  });
});
