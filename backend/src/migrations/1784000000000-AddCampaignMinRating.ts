import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Campaign rating filter: publish only products at/above a minimum star rating.
 * AliExpress product.query has no rating filter param, so the runner enforces it
 * client-side against each product's evaluate_rate. null = no rating filter.
 */
export class AddCampaignMinRating1784000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE campaigns
        ADD COLUMN IF NOT EXISTS min_rating double precision
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE campaigns DROP COLUMN IF EXISTS min_rating`);
  }
}
