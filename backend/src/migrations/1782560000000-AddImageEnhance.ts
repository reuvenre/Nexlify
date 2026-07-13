import { MigrationInterface, QueryRunner } from 'typeorm';

/** Auto image-enhancement toggle on credentials. */
export class AddImageEnhance1782560000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE credential_sets ADD COLUMN IF NOT EXISTS image_enhance_enabled boolean NOT NULL DEFAULT false`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE credential_sets DROP COLUMN IF EXISTS image_enhance_enabled`);
  }
}
