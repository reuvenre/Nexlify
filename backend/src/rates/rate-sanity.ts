/**
 * Is this actually an exchange rate?
 *
 * Every published price is a supplier price multiplied by one of these numbers, so a bad one
 * does not fail — it reprices the entire catalogue in every group and the posts go out
 * looking normal. `r.ILS || FALLBACK.USD_ILS` caught only the two ways the field can be
 * missing (absent, zero); it accepts `-1`, `0.0004` and `41000` just as readily, which is
 * what an upstream returning an error body inside a 200, a changed base currency, or rates
 * quoted the other way round all look like.
 *
 * The bands are deliberately wide. This is not a forecast of where a currency may go — it is
 * the line between "a rate moved a lot" and "this is not a USD rate at all". A real move that
 * left one of these bands would be a world event, and holding the previous day's rate through
 * it is still the better of the two available mistakes.
 */

import type { RateCache } from './rates.service';

/** min/max per pair, as units of the quote currency per 1 USD. */
export const PLAUSIBLE_BANDS: Record<'USD_ILS' | 'USD_EUR' | 'USD_GBP', [number, number]> = {
  // Never below 2 or above 8 in the shekel's entire floating history.
  USD_ILS: [2, 8],
  // EUR and GBP have traded near parity in both directions; neither has been far outside this.
  USD_EUR: [0.4, 2],
  USD_GBP: [0.3, 2],
};

/** One rate, judged alone. */
export function isPlausibleRate(pair: keyof typeof PLAUSIBLE_BANDS, value: unknown): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const [min, max] = PLAUSIBLE_BANDS[pair];
  return value >= min && value <= max;
}

/**
 * The whole set, judged together — all three must hold.
 *
 * All or nothing on purpose: the failures this guards against (a wrong base currency, an
 * error body, an inverted quote) corrupt every pair at once, and a set with one bad member
 * is evidence the source is wrong rather than that one number is. Keeping two of three would
 * publish a mix of today's and the previous day's rates with nothing recording which.
 */
export function isPlausibleRates(rates: Partial<RateCache> | null | undefined): boolean {
  if (!rates || typeof rates !== 'object') return false;
  return (Object.keys(PLAUSIBLE_BANDS) as (keyof typeof PLAUSIBLE_BANDS)[])
    .every((pair) => isPlausibleRate(pair, (rates as any)[pair]));
}
