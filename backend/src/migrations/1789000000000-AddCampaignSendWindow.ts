import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-campaign send window in its own timezone: window_start_hour/window_end_hour are
 * read in window_tz (IANA name). Lets a US-audience Pinterest campaign publish in US
 * evening hours while Israeli campaigns keep the account's Israel-time window.
 */
export class AddCampaignSendWindow1789000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE campaigns
        ADD COLUMN IF NOT EXISTS window_start_hour int,
        ADD COLUMN IF NOT EXISTS window_end_hour int,
        ADD COLUMN IF NOT EXISTS window_tz varchar
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE campaigns DROP COLUMN IF EXISTS window_start_hour, DROP COLUMN IF EXISTS window_end_hour, DROP COLUMN IF EXISTS window_tz`);
  }
}
