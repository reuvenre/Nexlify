import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Round-robin keyword rotation: campaigns cycle through keywords[cursor % len] and advance,
 * instead of picking one at random each run (which over-used some keywords and rarely touched
 * others). `keyword_cursor` is the rotation pointer.
 */
export class AddCampaignKeywordCursor1787000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE campaigns
        ADD COLUMN IF NOT EXISTS keyword_cursor integer NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE campaigns DROP COLUMN IF EXISTS keyword_cursor`);
  }
}
