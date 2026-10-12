import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * How much of a focused group must be inside its focus.
 *
 * A strict focus turned down everything outside it, so the campaign's other keywords stopped
 * mattering. The owner wants 60-70% of the posts inside the focus and the rest from those
 * keywords. A group that already has a focus starts at 65%, the middle of what he asked for;
 * a new one stays at 100 (null) until he sets it.
 */
export class AddChannelCoreFocusShare1795800000000 implements MigrationInterface {
  name = 'AddChannelCoreFocusShare1795800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "core_focus_share" integer`);
    await queryRunner.query(
      `UPDATE "channels" SET "core_focus_share" = 65 WHERE "core_focus" IS NOT NULL AND "core_focus" <> '' AND "core_focus_share" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "channels" DROP COLUMN IF EXISTS "core_focus_share"`);
  }
}
