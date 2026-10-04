import { MigrationInterface, QueryRunner } from 'typeorm';

/** What readers search for in the search bot — anonymous (see shopper-search.entity.ts). */
export class AddShopperSearches1794700000000 implements MigrationInterface {
  name = 'AddShopperSearches1794700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS shopper_searches (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        keyword character varying(80) NOT NULL,
        max_price double precision,
        results integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_shopper_searches_user_created ON shopper_searches (user_id, created_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS shopper_searches`);
  }
}
