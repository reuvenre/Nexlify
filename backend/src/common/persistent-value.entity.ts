import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/**
 * Small values that must outlive the process, keyed by name and expiring by themselves.
 *
 * This exists because `CacheModule` is not storage here. With no REDIS_URL set — and this
 * deployment sets none — it falls back to a per-process in-memory store, so "cache it for
 * 30 days" means "cache it until the next deploy", several times a working day. Everything
 * written with a long TTL was therefore silently not being kept: the watchdog's suppression
 * memory (#74, #78, #84) and the last known-good exchange rate alike.
 *
 * Postgres is the one store this backend always has. One row per value, JSON payload,
 * expiry enforced on read — the same shape `manager_actions.until_at` already uses, so
 * nothing needs a cleanup job.
 *
 * It is for values that are worth keeping but cheap to lose: anything in here must be
 * re-derivable, because expiry silently removes it. Real domain data belongs in a real table.
 */
@Entity('persistent_values')
export class PersistentValue {
  /** The value's name, e.g. 'watchdog:throttle' or 'exchange_rates_last_good'. */
  @PrimaryColumn({ type: 'varchar', length: 120 })
  key: string;

  /** The payload. Its shape belongs to whichever module owns the key; anything this file
   *  cannot understand is the reader's problem to survive, never to throw on. */
  @Column({ type: 'jsonb', nullable: true })
  value: any;

  /** Past this moment the row is ignored on read — expiry without a sweeper. */
  @Column({ type: 'timestamptz' })
  expires_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
