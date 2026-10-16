import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The videos of a supplier product's Yupoo album.
 *
 * Albums mix photos and videos, and only the photos were read. Existing products fill in on
 * their next scheduled sync, which re-reads the album anyway.
 */
export class AddSupplierProductVideos1795900000000 implements MigrationInterface {
  name = 'AddSupplierProductVideos1795900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "supplier_products" ADD COLUMN IF NOT EXISTS "videos_json" text`);
    await queryRunner.query(`ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "send_as_video" boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "posts" DROP COLUMN IF EXISTS "send_as_video"`);
    await queryRunner.query(`ALTER TABLE "supplier_products" DROP COLUMN IF EXISTS "videos_json"`);
  }
}
