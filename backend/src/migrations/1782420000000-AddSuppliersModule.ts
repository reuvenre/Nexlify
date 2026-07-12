import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Suppliers module: Yupoo (content) ↔ FLYLINK (affiliate) product catalogs,
 * fully separate from the AliExpress `catalog_products` flow. Plus a
 * `channel_override` column on posts so queued/scheduled posts can target a
 * specific publishing group.
 */
export class AddSuppliersModule1782420000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS supplier_catalogs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL,
        name varchar NOT NULL,
        source_type varchar NOT NULL DEFAULT 'yupoo',
        source_store varchar,
        affiliate_network varchar NOT NULL DEFAULT 'flylink',
        sku_match_mode varchar NOT NULL DEFAULT 'numeric',
        sku_match_config jsonb,
        selectors_json text,
        target_channel_id varchar,
        flylink_api_token_enc varchar,
        enabled boolean NOT NULL DEFAULT true,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_supplier_catalogs_user ON supplier_catalogs (user_id)`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS supplier_products (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL,
        supplier_catalog_id uuid NOT NULL REFERENCES supplier_catalogs(id) ON DELETE CASCADE,
        sku varchar,
        title varchar NOT NULL,
        description text,
        image_url varchar,
        gallery_json text,
        price double precision NOT NULL DEFAULT 0,
        currency varchar NOT NULL DEFAULT 'USD',
        yupoo_url varchar,
        flylink_url varchar,
        in_stock boolean,
        status varchar NOT NULL DEFAULT 'active',
        has_post boolean NOT NULL DEFAULT false,
        synced_at timestamp,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_supplier_products_user_sku ON supplier_products (user_id, sku)`);

    await queryRunner.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS channel_override varchar`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE posts DROP COLUMN IF EXISTS channel_override`);
    await queryRunner.query(`DROP TABLE IF EXISTS supplier_products`);
    await queryRunner.query(`DROP TABLE IF EXISTS supplier_catalogs`);
  }
}
