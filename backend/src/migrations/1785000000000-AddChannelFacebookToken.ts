import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-channel Facebook Page Access Token. A Page token is page-specific, so a group on a
 * different Facebook page needs its own token; null falls back to the account's global token.
 * Stored encrypted (AES), same as bot_token_enc.
 */
export class AddChannelFacebookToken1785000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE channels
        ADD COLUMN IF NOT EXISTS facebook_page_token_enc varchar
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE channels DROP COLUMN IF EXISTS facebook_page_token_enc`);
  }
}
