import { MigrationInterface, QueryRunner } from 'typeorm';

/** Readers' price-drop alerts (telegram-bot/price-alert.entity.ts). */
export class AddPriceAlerts1795100000000 implements MigrationInterface {
  name = 'AddPriceAlerts1795100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS price_alerts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        chat_id character varying(40) NOT NULL,
        product_id character varying(40) NOT NULL,
        title character varying(200) NOT NULL,
        image_url text,
        price_ils double precision NOT NULL,
        currency character varying(8) NOT NULL DEFAULT 'ILS',
        active boolean NOT NULL DEFAULT true,
        misses integer NOT NULL DEFAULT 0,
        checked_at timestamptz,
        notified_at timestamptz,
        notified_price double precision,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_price_alerts_chat_product UNIQUE (chat_id, product_id)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_price_alerts_active ON price_alerts (active, user_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS price_alerts`);
  }
}
