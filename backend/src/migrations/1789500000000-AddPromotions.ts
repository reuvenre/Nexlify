import { MigrationInterface, QueryRunner } from 'typeorm';

/** Admin-managed sales on plans/credit packs — date-driven active window. */
export class AddPromotions1789500000000 implements MigrationInterface {
  name = 'AddPromotions1789500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "promotions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "title" character varying NOT NULL,
        "target_type" character varying NOT NULL DEFAULT 'plan',
        "target_id" character varying,
        "percent_off" integer,
        "fixed_price" integer,
        "starts_at" TIMESTAMP WITH TIME ZONE,
        "ends_at" TIMESTAMP WITH TIME ZONE,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_promotions_id" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "promotions"`);
  }
}
