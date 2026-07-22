import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-campaign publishing targets: `target_platforms` (JSON array of
 * telegram/facebook/instagram/pinterest/whatsapp) lets one campaign publish ONLY to chosen
 * platforms instead of the account-global toggles, and `currency_pair` prices a campaign in
 * its own currency (e.g. an English Pinterest campaign in USD while the account stays ILS).
 */
export class AddCampaignPlatformsAndCurrency1788800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE campaigns
        ADD COLUMN IF NOT EXISTS target_platforms text,
        ADD COLUMN IF NOT EXISTS currency_pair varchar
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE campaigns DROP COLUMN IF EXISTS target_platforms, DROP COLUMN IF EXISTS currency_pair`);
  }
}
