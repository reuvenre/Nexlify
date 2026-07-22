import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Facebook Page token expiry tracking: `facebook_token_expires_at` (resolved via Graph
 * debug_token when a token is saved) powers a renew-before-it-dies reminder — a daily
 * cron emails the owner ahead of expiry, and Settings shows a countdown. Meta tokens
 * die silently (~60 days) and take Instagram/Facebook publishing down with them.
 */
export class AddFacebookTokenExpiry1788900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE credential_sets
        ADD COLUMN IF NOT EXISTS facebook_token_expires_at timestamptz,
        ADD COLUMN IF NOT EXISTS facebook_token_notified_at timestamptz
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE credential_sets DROP COLUMN IF EXISTS facebook_token_expires_at, DROP COLUMN IF EXISTS facebook_token_notified_at`);
  }
}
