import { MigrationInterface, QueryRunner } from 'typeorm';

/** Persist the user's default body + footer template selection. Idempotent. */
export class AddDefaultTemplates1782140000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE credential_sets
        ADD COLUMN IF NOT EXISTS default_body_template_id varchar,
        ADD COLUMN IF NOT EXISTS default_footer_template_id varchar
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE credential_sets
        DROP COLUMN IF EXISTS default_body_template_id,
        DROP COLUMN IF EXISTS default_footer_template_id
    `);
  }
}
