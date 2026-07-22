import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Winner recycling: posts that PROVED themselves (short-link clicks / attributed
 * commissions) get republished automatically with fresh AI copy. posts.recycled_from
 * marks the clone; the per-user toggle + click threshold live on credential_sets.
 */
export class AddWinnerRecycling1789300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS recycled_from uuid`);
    await queryRunner.query(`
      ALTER TABLE credential_sets
        ADD COLUMN IF NOT EXISTS recycle_winners_enabled boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS recycle_min_clicks int NOT NULL DEFAULT 10
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE credential_sets DROP COLUMN IF EXISTS recycle_winners_enabled, DROP COLUMN IF EXISTS recycle_min_clicks`);
    await queryRunner.query(`ALTER TABLE posts DROP COLUMN IF EXISTS recycled_from`);
  }
}
