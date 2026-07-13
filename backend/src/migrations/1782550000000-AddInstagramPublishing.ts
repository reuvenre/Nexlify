import { MigrationInterface, QueryRunner } from 'typeorm';

/** Instagram publishing: IG business id + publish toggle on credentials, and the
 *  published media id on posts. */
export class AddInstagramPublishing1782550000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE credential_sets ADD COLUMN IF NOT EXISTS instagram_business_id varchar NULL`);
    await q.query(`ALTER TABLE credential_sets ADD COLUMN IF NOT EXISTS publish_instagram boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS instagram_post_id varchar NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE posts DROP COLUMN IF EXISTS instagram_post_id`);
    await q.query(`ALTER TABLE credential_sets DROP COLUMN IF EXISTS publish_instagram`);
    await q.query(`ALTER TABLE credential_sets DROP COLUMN IF EXISTS instagram_business_id`);
  }
}
