import { MigrationInterface, QueryRunner } from 'typeorm';

/** Per-channel footer template (each group has its own join link). */
export class AddChannelFooterTemplate1782430000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE channels ADD COLUMN IF NOT EXISTS footer_template_id uuid NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE channels DROP COLUMN IF EXISTS footer_template_id`);
  }
}
