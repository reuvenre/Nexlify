import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One earnings row per (user, order) — prevents duplicate money rows when a
 * sync is double-clicked or overlaps another. Also a covering index for the
 * per-user, date-ordered summary/list queries.
 */
export class AddEarningsUniqueIndex1782400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // De-dupe any pre-existing duplicates before the unique index is created.
    await queryRunner.query(`
      DELETE FROM earnings e USING earnings d
      WHERE e.user_id = d.user_id AND e.order_id = d.order_id AND e.ctid > d.ctid
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_earnings_user_order ON earnings (user_id, order_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_earnings_user_date ON earnings (user_id, order_date)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_earnings_user_date`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_earnings_user_order`);
  }
}
