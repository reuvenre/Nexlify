import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-group send queue: each channel gets its own schedule window/interval/clock.
 * All columns are NULLABLE — null means "inherit the user's global schedule setting",
 * so existing groups keep behaving exactly as before until the user overrides them.
 */
export class AddChannelSchedule1782750000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE channels ADD COLUMN IF NOT EXISTS schedule_enabled boolean NULL`);
    await q.query(`ALTER TABLE channels ADD COLUMN IF NOT EXISTS schedule_interval_minutes int NULL`);
    await q.query(`ALTER TABLE channels ADD COLUMN IF NOT EXISTS schedule_start_hour int NULL`);
    await q.query(`ALTER TABLE channels ADD COLUMN IF NOT EXISTS schedule_end_hour int NULL`);
    await q.query(`ALTER TABLE channels ADD COLUMN IF NOT EXISTS schedule_last_sent_at timestamp NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE channels DROP COLUMN IF EXISTS schedule_last_sent_at`);
    await q.query(`ALTER TABLE channels DROP COLUMN IF EXISTS schedule_end_hour`);
    await q.query(`ALTER TABLE channels DROP COLUMN IF EXISTS schedule_start_hour`);
    await q.query(`ALTER TABLE channels DROP COLUMN IF EXISTS schedule_interval_minutes`);
    await q.query(`ALTER TABLE channels DROP COLUMN IF EXISTS schedule_enabled`);
  }
}
