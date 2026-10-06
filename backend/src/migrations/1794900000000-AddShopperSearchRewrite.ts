import { MigrationInterface, QueryRunner } from 'typeorm';

/** Which readers' searches were found only through a model's rewrite (query-rewrite.ts). */
export class AddShopperSearchRewrite1794900000000 implements MigrationInterface {
  name = 'AddShopperSearchRewrite1794900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE shopper_searches ADD COLUMN IF NOT EXISTS rewrite character varying(80)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE shopper_searches DROP COLUMN IF EXISTS rewrite`);
  }
}
