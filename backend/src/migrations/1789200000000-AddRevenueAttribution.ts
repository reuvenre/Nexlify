import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Revenue attribution: posts.keyword records which campaign keyword produced each post;
 * earnings.post_id/keyword link every commission to the post that drove it (matched by
 * product + 30-day window, most-clicked post wins). Together they answer the money
 * question the system was blind to: WHICH keyword/campaign/post actually earns.
 */
export class AddRevenueAttribution1789200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS keyword varchar`);
    await queryRunner.query(`
      ALTER TABLE earnings
        ADD COLUMN IF NOT EXISTS post_id uuid,
        ADD COLUMN IF NOT EXISTS keyword varchar
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_earnings_post ON earnings (post_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_posts_user_product ON posts (user_id, product_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_posts_user_product`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_earnings_post`);
    await queryRunner.query(`ALTER TABLE earnings DROP COLUMN IF EXISTS post_id, DROP COLUMN IF EXISTS keyword`);
    await queryRunner.query(`ALTER TABLE posts DROP COLUMN IF EXISTS keyword`);
  }
}
