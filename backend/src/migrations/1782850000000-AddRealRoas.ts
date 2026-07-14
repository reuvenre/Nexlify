import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Real ROAS: store the commissions actually attributed to a boosted product, and the
 * organic-earnings bar a post must clear before we spend money on it.
 */
export class AddRealRoas1782850000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE ad_boosts ADD COLUMN IF NOT EXISTS revenue_usd double precision NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE credential_sets ADD COLUMN IF NOT EXISTS boost_min_revenue_usd double precision NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE credential_sets DROP COLUMN IF EXISTS boost_min_revenue_usd`);
    await q.query(`ALTER TABLE ad_boosts DROP COLUMN IF EXISTS revenue_usd`);
  }
}
