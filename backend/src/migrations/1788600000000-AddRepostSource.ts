import { MigrationInterface, QueryRunner } from 'typeorm';

/** Lets the user pin one post per product as the template a FLYLINK re-post clones. */
export class AddRepostSource1788600000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_repost_source boolean NOT NULL DEFAULT false`);
  }
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE posts DROP COLUMN IF EXISTS is_repost_source`);
  }
}
