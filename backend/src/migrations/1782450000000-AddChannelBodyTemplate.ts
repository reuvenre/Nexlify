import { MigrationInterface, QueryRunner } from 'typeorm';

/** Per-channel body template (each group can have its own copy style). */
export class AddChannelBodyTemplate1782450000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE channels ADD COLUMN IF NOT EXISTS body_template_id varchar NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE channels DROP COLUMN IF EXISTS body_template_id`);
  }
}
