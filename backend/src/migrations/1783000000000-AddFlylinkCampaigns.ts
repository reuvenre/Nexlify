import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FLYLINK campaigns: a campaign can now rotate the user's linked supplier_products instead
 * of keyword-searching AliExpress. `source` selects the runner; `target_channels` holds the
 * groups a flylink campaign posts to; `last_posted_at` is the round-robin cursor.
 */
export class AddFlylinkCampaigns1783000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE campaigns
        ADD COLUMN IF NOT EXISTS source varchar NOT NULL DEFAULT 'aliexpress',
        ADD COLUMN IF NOT EXISTS target_channels text
    `);
    await queryRunner.query(`
      ALTER TABLE supplier_products
        ADD COLUMN IF NOT EXISTS last_posted_at timestamptz
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE campaigns DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS target_channels`);
    await queryRunner.query(`ALTER TABLE supplier_products DROP COLUMN IF EXISTS last_posted_at`);
  }
}
