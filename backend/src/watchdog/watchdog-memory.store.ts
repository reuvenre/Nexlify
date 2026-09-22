import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WatchdogMemory } from './watchdog-memory.entity';

/**
 * Read and write the watchdog's suppression memory.
 *
 * Deliberately the same two-call shape the cache helpers had (`load` / `save`), so the
 * callers did not change their logic when the backing store did — only where the answer
 * comes from. The difference that matters is that this one actually persists: `CacheModule`
 * without REDIS_URL is a per-process map, and every deploy emptied it.
 *
 * Both calls swallow their errors. A failed read yields null, which the callers' merge
 * functions already treat as "nothing to fold in" (never as "forget what I know"), and a
 * failed write costs at most one duplicate alert. A watchdog that throws is a watchdog that
 * stops watching, and that is the one outcome worse than a duplicate.
 */
@Injectable()
export class WatchdogMemoryStore {
  private readonly logger = new Logger(WatchdogMemoryStore.name);

  constructor(
    @InjectRepository(WatchdogMemory) private readonly repo: Repository<WatchdogMemory>,
  ) {}

  /** The stored value, or null when absent, expired or unreadable. */
  async load<T>(key: string): Promise<T | null> {
    try {
      const row = await this.repo.findOne({ where: { key } });
      if (!row) return null;
      // Expiry is enforced on READ, not by a sweeper: a row past its moment is treated as
      // absent and will be overwritten by the next save.
      if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null;
      return (row.value ?? null) as T | null;
    } catch (err: any) {
      this.logger.warn(`watchdog memory read failed (${key}): ${err?.message}`);
      return null;
    }
  }

  /** Store a value for `ttlMs`. Overwrites whatever the key held. */
  async save(key: string, value: unknown, ttlMs: number): Promise<void> {
    try {
      await this.repo.upsert(
        { key, value: value as any, expires_at: new Date(Date.now() + ttlMs) },
        ['key'],
      );
    } catch (err: any) {
      this.logger.warn(`watchdog memory write failed (${key}): ${err?.message}`);
    }
  }
}
