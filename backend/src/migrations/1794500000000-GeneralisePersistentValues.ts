import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `watchdog_memory` generalised into `persistent_values`.
 *
 * The table shipped one commit ago for the watchdog's suppression memory, and the very next
 * thing that needed it was the rates service: its last known-good exchange rate was written
 * to the cache with a 30-day TTL, which without REDIS_URL means "until the next deploy". The
 * mechanism is identical, and a second copy of it under a second name is how this codebase
 * has produced its own bugs before — one decision in two places, the second never updated.
 *
 * DROPPED rather than renamed, on purpose: the table holds only suppression state that is
 * re-derived within one scan cycle, its longest-lived row is seven days old, and it has
 * existed for minutes. The cost of dropping it is at most one duplicate watchdog alert; the
 * cost of a conditional rename is DDL nobody can reason about later.
 */
export class GeneralisePersistentValues1794500000000 implements MigrationInterface {
  name = 'GeneralisePersistentValues1794500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS watchdog_memory`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS persistent_values (
        key character varying(120) PRIMARY KEY,
        value jsonb,
        expires_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS persistent_values`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS watchdog_memory (
        key character varying(120) PRIMARY KEY,
        value jsonb,
        expires_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }
}
