import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/**
 * What the watchdog has already said out loud, kept where a deploy cannot reach it.
 *
 * Every suppression the watchdog owns — the 6h per-key throttle, the reported-post memory,
 * the reported-regression memory — exists to answer one question: "did I already tell him
 * this?" All three lived in process fields, and then in the cache. Neither survives what
 * actually happens here: this deployment has no REDIS_URL, so `CacheModule` falls back to a
 * per-process in-memory store. The cache round-trip was therefore the same field with extra
 * steps, and every deploy — several on a working day — wiped all of it. The watchdog then
 * re-raised findings whose issues Claude had already fixed and closed (#74, #78, #84), which
 * to the owner reads as "the fix didn't work".
 *
 * Postgres is the one store this backend always has. One row per memory, JSON payload,
 * expiring by `expires_at` — the same shape `manager_actions.until_at` already uses, so
 * nothing needs a cleanup job: an expired row is simply not read.
 */
@Entity('watchdog_memory')
export class WatchdogMemory {
  /** The memory's name, e.g. 'watchdog:partials_reported'. One row per memory, not per id. */
  @PrimaryColumn({ type: 'varchar', length: 120 })
  key: string;

  /** The serialized map. Shape belongs to whichever module owns the key; anything this
   *  file cannot understand is the reader's problem to survive, never to throw on. */
  @Column({ type: 'jsonb', nullable: true })
  value: any;

  /** Past this moment the row is ignored on read — expiry without a sweeper. */
  @Column({ type: 'timestamptz' })
  expires_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
