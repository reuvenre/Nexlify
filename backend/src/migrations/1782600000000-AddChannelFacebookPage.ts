import { MigrationInterface, QueryRunner } from 'typeorm';

/** Per-channel Facebook Page: each group publishes to its own page. */
export class AddChannelFacebookPage1782600000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE channels ADD COLUMN IF NOT EXISTS facebook_page_id varchar NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE channels DROP COLUMN IF EXISTS facebook_page_id`);
  }
}
