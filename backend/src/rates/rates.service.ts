import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import axios from 'axios';
import { cacheGet, cacheSet } from '../common/safe-cache';
import { PersistentValueStore } from '../common/persistent-value.store';
import { isPlausibleRates } from './rate-sanity';

export interface RateCache {
  USD_ILS: number;
  USD_EUR: number;
  USD_GBP: number;
  updated_at: string;
}

const RATES_CACHE_KEY = 'exchange_rates';
/** Kept byte-identical to the old cache key, so an instance that still has a warm Redis
 *  entry under it is not orphaned by the move to the database. */
const RATES_LAST_GOOD_KEY = 'exchange_rates_last_good';
const RATES_TTL_SEC = 60 * 60; // 1 hour
const LAST_GOOD_TTL_SEC = 30 * 24 * 60 * 60; // 30 days — survives a long upstream outage

/**
 * The floor under everything: hardcoded rates for a backend that has never once reached the
 * upstream API and has no last-known-good to fall back on.
 *
 * `updated_at` is the day these numbers were written, NOT the moment they are served. It used
 * to be `new Date()`, evaluated at import, so a process falling back to this floor reported a
 * rate from years ago as if it had been fetched seconds earlier — the one situation where the
 * timestamp is the only thing that could warn anybody.
 */
const FALLBACK_WRITTEN_AT = '2025-01-01T00:00:00.000Z';
const FALLBACK: RateCache = {
  USD_ILS: 3.7,
  USD_EUR: 0.92,
  USD_GBP: 0.79,
  updated_at: FALLBACK_WRITTEN_AT,
};

@Injectable()
export class RatesService {
  private readonly logger = new Logger(RatesService.name);

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly store: PersistentValueStore,
  ) {}

  async getRates(): Promise<RateCache> {
    // The hot cache stays in CacheModule on purpose: it saves a repeated HTTP call within the
    // hour and nothing more, and a miss costs one fetch. That is what a cache is for.
    // safe-cache: a dead Redis must degrade to a direct fetch, never hang the
    // request (this exact call used to freeze every products endpoint).
    const cached = await cacheGet<RateCache>(this.cacheManager, RATES_CACHE_KEY);
    if (cached) return cached;

    const fresh = await this.fetchRates();
    await cacheSet(this.cacheManager, RATES_CACHE_KEY, fresh, RATES_TTL_SEC * 1000);
    return fresh;
  }

  async getRate(pair: string): Promise<number> {
    const rates = await this.getRates();
    if (pair === 'USD_ILS') return rates.USD_ILS;
    if (pair === 'USD_EUR') return rates.USD_EUR;
    if (pair === 'USD_GBP') return rates.USD_GBP;
    return 1;
  }

  private async fetchRates(): Promise<RateCache> {
    try {
      const res = await axios.get(
        'https://api.exchangerate-api.com/v4/latest/USD',
        { timeout: 8000 },
      );
      const r = res.data?.rates || {};
      const fresh: RateCache = {
        USD_ILS: r.ILS || FALLBACK.USD_ILS,
        USD_EUR: r.EUR || FALLBACK.USD_EUR,
        USD_GBP: r.GBP || FALLBACK.USD_GBP,
        updated_at: new Date().toISOString(),
      };
      // A 200 carrying nonsense is not a rate. Every price the system publishes is multiplied
      // by this number, so a bad one reprices the whole catalogue in the groups — the last
      // known-good rate is a far better answer than a fresh wrong one.
      if (!isPlausibleRates(fresh)) {
        this.logger.warn(`implausible rates from upstream (USD_ILS=${fresh.USD_ILS}) — keeping the last known-good`);
        return this.lastGoodOrFallback();
      }
      // Persist the last KNOWN-GOOD rate separately (long TTL) so an upstream outage falls
      // back to a real recent rate instead of the stale hardcoded floor.
      //
      // In the DATABASE, not the cache. With no REDIS_URL the cache is a per-process store,
      // so this 30-day TTL meant "until the next deploy": after any deploy with the upstream
      // down, every price in every group was computed from the hardcoded 3.7.
      await this.store.save(RATES_LAST_GOOD_KEY, fresh, LAST_GOOD_TTL_SEC * 1000);
      return fresh;
    } catch {
      return this.lastGoodOrFallback();
    }
  }

  /** The most recent rate that was ever believed, else the hardcoded floor. */
  private async lastGoodOrFallback(): Promise<RateCache> {
    const lastGood = await this.store.load<RateCache>(RATES_LAST_GOOD_KEY);
    if (lastGood && isPlausibleRates(lastGood)) return lastGood;
    this.logger.warn('no usable last-known-good rate — falling back to the hardcoded floor');
    return FALLBACK;
  }
}
