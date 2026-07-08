import { Injectable } from '@nestjs/common';

export type RoundingMode = 'natural' | 'charming' | 'exact';

export interface PricingConfig {
  markup_pct?: number;            // 0–100, default 0
  shipping_buffer_ils?: number;   // 0–200, default 0
  rounding_mode?: RoundingMode;   // default 'natural'
}

/**
 * AliExpress USD→ILS price converter (ported from the `aliexpress-price-converter`
 * skill). Turns a base cost into a clean selling price using the strict order:
 *
 *   base   = cost_ils  (or price_usd × rate when there's no reliable ILS cost)
 *   +shipping_buffer_ils
 *   ×(1 + markup_pct/100)
 *   → round per the chosen mode
 *
 * With the affiliate-safe defaults (markup 0, buffer 0, natural rounding) this is
 * just a tidy rounding of the cost; resellers raise markup to set their margin.
 */
@Injectable()
export class PricingService {
  /** Clamp the user's config to the skill's validated ranges. */
  sanitize(cfg?: PricingConfig): Required<PricingConfig> {
    // Default is 'exact': show the SAME price the user sees on aliexpress.com.
    // 'natural'/'charming' rounding is an opt-in for resellers who add markup —
    // as a default it made every displayed price deviate from the site (₪11.68→₪12),
    // which reads as "the system pulls wrong prices".
    const mode: RoundingMode = cfg?.rounding_mode === 'charming' || cfg?.rounding_mode === 'natural'
      ? cfg.rounding_mode
      : 'exact';
    return {
      markup_pct: clamp(cfg?.markup_pct ?? 0, 0, 100),
      shipping_buffer_ils: clamp(cfg?.shipping_buffer_ils ?? 0, 0, 200),
      rounding_mode: mode,
    };
  }

  /**
   * Compute the final ILS selling price.
   * @param costIls  reliable ILS cost (e.g. AliExpress target price); 0 if unknown
   * @param priceUsd raw USD price (used only when costIls is 0)
   * @param rate     live USD→ILS rate
   */
  computeIls(costIls: number, priceUsd: number, rate: number, cfg?: PricingConfig): number {
    const c = this.sanitize(cfg);
    const base = costIls > 0 ? costIls : (priceUsd > 0 ? priceUsd * rate : 0);
    if (base <= 0) return 0;
    const withBuffer = base + c.shipping_buffer_ils;
    const withMarkup = withBuffer * (1 + c.markup_pct / 100);
    return this.round(withMarkup, c.rounding_mode);
  }

  /** Apply rounding only (no markup/buffer) — used for the "was/original" price. */
  round(value: number, mode: RoundingMode): number {
    if (!(value > 0)) return 0;
    switch (mode) {
      case 'exact':
        // TRUE exact — the price as-is to the agora, identical to the site.
        return +value.toFixed(2);
      case 'charming': {
        // Round DOWN to the nearest price ending in 9 (…9, …19, …29).
        const down = Math.floor(value);
        const ending9 = down - ((down + 1) % 10);
        return ending9 > 0 ? ending9 : down;
      }
      case 'natural':
      default:
        // Round UP to ₪1; prices over 50 round up to the nearest ₪5.
        return value > 50 ? Math.ceil(value / 5) * 5 : Math.ceil(value);
    }
  }
}

function clamp(n: number, lo: number, hi: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}
