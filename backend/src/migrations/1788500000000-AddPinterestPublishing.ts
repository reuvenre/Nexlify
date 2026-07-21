import { MigrationInterface, QueryRunner } from 'typeorm';

/** Pinterest publishing: publish toggle on credentials + the published Pin id on posts.
 *  (pinterest_access_token_enc / pinterest_board_id already exist from the scaffold migration.) */
export class AddPinterestPublishing1788500000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE credential_sets ADD COLUMN IF NOT EXISTS publish_pinterest boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS pinterest_post_id varchar NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE posts DROP COLUMN IF EXISTS pinterest_post_id`);
    await q.query(`ALTER TABLE credential_sets DROP COLUMN IF EXISTS publish_pinterest`);
  }
}
