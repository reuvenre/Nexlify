import { MigrationInterface, QueryRunner } from 'typeorm';

/** Make.com webhook relay: deliver Facebook posts via the user's Make scenario. */
export class AddMakeWebhook1782580000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE credential_sets ADD COLUMN IF NOT EXISTS make_webhook_url varchar NULL`);
    await q.query(`ALTER TABLE credential_sets ADD COLUMN IF NOT EXISTS publish_via_make boolean NOT NULL DEFAULT false`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE credential_sets DROP COLUMN IF EXISTS publish_via_make`);
    await q.query(`ALTER TABLE credential_sets DROP COLUMN IF EXISTS make_webhook_url`);
  }
}
