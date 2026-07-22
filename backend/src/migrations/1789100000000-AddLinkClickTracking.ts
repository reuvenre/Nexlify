import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Trackable short links: posts.short_code backs the /r/<code> redirect, link_clicks
 * records every shopper click (the fast feedback + attribution-weighting signal), and
 * posts.clicks_count caches the total for list screens.
 */
export class AddLinkClickTracking1789100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE posts
        ADD COLUMN IF NOT EXISTS short_code varchar,
        ADD COLUMN IF NOT EXISTS clicks_count int NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_posts_short_code ON posts (short_code) WHERE short_code IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS link_clicks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id uuid NOT NULL,
        user_id uuid NOT NULL,
        referrer varchar(500),
        user_agent varchar(300),
        clicked_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_link_clicks_post ON link_clicks (post_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_link_clicks_user_date ON link_clicks (user_id, clicked_at)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS link_clicks`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_posts_short_code`);
    await queryRunner.query(`ALTER TABLE posts DROP COLUMN IF EXISTS short_code, DROP COLUMN IF EXISTS clicks_count`);
  }
}
