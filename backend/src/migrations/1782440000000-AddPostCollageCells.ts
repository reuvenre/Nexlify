import { MigrationInterface, QueryRunner } from 'typeorm';

/** Collage mode: compose gallery images into grid sheets for one album. */
export class AddPostCollageCells1782440000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS collage_cells int NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE posts DROP COLUMN IF EXISTS collage_cells`);
  }
}
