import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Facebook publish throttle: pace Facebook independently of Telegram so high-frequency
 * posting doesn't trip FB's spam block. `facebook_min_interval_minutes` (per account) sets
 * the minimum gap between FB posts per page; `facebook_last_sent_at` (per channel) is that
 * page's throttle clock.
 */
export class AddFacebookThrottle1786000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE credential_sets
        ADD COLUMN IF NOT EXISTS facebook_min_interval_minutes integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE channels
        ADD COLUMN IF NOT EXISTS facebook_last_sent_at timestamp
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE credential_sets DROP COLUMN IF EXISTS facebook_min_interval_minutes`);
    await queryRunner.query(`ALTER TABLE channels DROP COLUMN IF EXISTS facebook_last_sent_at`);
  }
}
