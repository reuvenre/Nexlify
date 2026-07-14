import { MigrationInterface, QueryRunner } from 'typeorm';

/** Tiered AliExpress coupons ("ILAFF3 — $7 OFF $55+") auto-attached to matching posts. */
export class AddCoupons1782800000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS coupons (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        code varchar NOT NULL,
        discount_usd double precision NOT NULL DEFAULT 0,
        min_spend_usd double precision NOT NULL DEFAULT 0,
        campaign varchar NULL,
        starts_at timestamp NULL,
        ends_at timestamp NULL,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_coupons_user_min ON coupons (user_id, min_spend_usd)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_coupons_user_min`);
    await q.query(`DROP TABLE IF EXISTS coupons`);
  }
}
