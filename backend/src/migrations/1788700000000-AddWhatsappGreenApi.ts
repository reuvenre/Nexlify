import { MigrationInterface, QueryRunner } from 'typeorm';

/** WhatsApp publishing via Green API (posts to groups) alongside the official Cloud API. */
export class AddWhatsappGreenApi1788700000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE credential_sets ADD COLUMN IF NOT EXISTS whatsapp_provider varchar NOT NULL DEFAULT 'green'`);
    await q.query(`ALTER TABLE credential_sets ADD COLUMN IF NOT EXISTS green_api_url varchar NULL`);
    await q.query(`ALTER TABLE credential_sets ADD COLUMN IF NOT EXISTS green_api_instance_id varchar NULL`);
    await q.query(`ALTER TABLE credential_sets ADD COLUMN IF NOT EXISTS green_api_token_enc varchar NULL`);
    await q.query(`ALTER TABLE credential_sets ADD COLUMN IF NOT EXISTS whatsapp_group_id varchar NULL`);
    await q.query(`ALTER TABLE credential_sets ADD COLUMN IF NOT EXISTS publish_whatsapp boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS whatsapp_message_id varchar NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE posts DROP COLUMN IF EXISTS whatsapp_message_id`);
    await q.query(`ALTER TABLE credential_sets DROP COLUMN IF EXISTS publish_whatsapp`);
    await q.query(`ALTER TABLE credential_sets DROP COLUMN IF EXISTS whatsapp_group_id`);
    await q.query(`ALTER TABLE credential_sets DROP COLUMN IF EXISTS green_api_token_enc`);
    await q.query(`ALTER TABLE credential_sets DROP COLUMN IF EXISTS green_api_instance_id`);
    await q.query(`ALTER TABLE credential_sets DROP COLUMN IF EXISTS green_api_url`);
    await q.query(`ALTER TABLE credential_sets DROP COLUMN IF EXISTS whatsapp_provider`);
  }
}
