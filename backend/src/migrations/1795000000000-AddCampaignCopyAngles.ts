import { MigrationInterface, QueryRunner } from 'typeorm';

/** Copy angles the owner approved per campaign (posts/copy-variants.ts, manager proposals). */
export class AddCampaignCopyAngles1795000000000 implements MigrationInterface {
  name = 'AddCampaignCopyAngles1795000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS copy_angles jsonb NOT NULL DEFAULT '[]'::jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE campaigns DROP COLUMN IF EXISTS copy_angles`);
  }
}
