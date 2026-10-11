import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A group's core focus.
 *
 * The relevance guard lets a product through unless it is clearly wrong for the group, so a
 * tactical group still received ordinary flashlights and camping gear. With a focus set, the
 * automatic routes into the group publish only products clearly inside it. Null = no change.
 */
export class AddChannelCoreFocus1795700000000 implements MigrationInterface {
  name = 'AddChannelCoreFocus1795700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "core_focus" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "channels" DROP COLUMN IF EXISTS "core_focus"`);
  }
}
