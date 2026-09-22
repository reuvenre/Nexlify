import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PersistentValue } from './persistent-value.entity';

/**
 * Read and write values that must survive a deploy.
 *
 * Deliberately the same two-call shape the cache helpers have (`load` / `save`), so callers
 * moving off the cache change where the answer comes from and nothing else. The difference
 * that matters is that this one actually persists: `CacheModule` without REDIS_URL is a
 * per-process map, and every deploy emptied it.
 *
 * Both calls swallow their errors and neither ever throws. Callers already have a correct
 * answer for "no value": the watchdog merges nothing in (rather than forgetting what it
 * knows), and the rates service falls through to its own fallback. Turning a database blip
 * into an exception would break a publish or stop the watchdog watching, which is worse than
 * every failure this store can have.
 */
@Injectable()
export class PersistentValueStore {
  private readonly logger = new Logger(PersistentValueStore.name);

  constructor(
    @InjectRepository(PersistentValue) private readonly repo: Repository<PersistentValue>,
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
      this.logger.warn(`persistent value read failed (${key}): ${err?.message}`);
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
      this.logger.warn(`persistent value write failed (${key}): ${err?.message}`);
    }
  }
}
