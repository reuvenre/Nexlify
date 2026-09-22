import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The watchdog's suppression memory, moved out of the process and into the database.
 *
 * The throttle, the reported-post ids and the reported-regression drops all decide whether
 * the owner hears about something twice. They were held in process fields backed by the
 * cache — and with no REDIS_URL in this deployment the cache IS a process field, so every
 * deploy reset all three and already-fixed findings were re-raised (#74, #78, #84).
 *
 * One row per memory, expiring by `expires_at`: no cleanup job, and a row past its expiry
 * is simply never read.
 */
export class AddWatchdogMemory1794400000000 implements MigrationInterface {
  name = 'AddWatchdogMemory1794400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS watchdog_memory (
        key character varying(120) PRIMARY KEY,
        value jsonb,
        expires_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS watchdog_memory`);
  }
}
