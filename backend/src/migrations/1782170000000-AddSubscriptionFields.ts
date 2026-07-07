import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Subscription/plans system (demo-mode billing).
 * Plan definitions (credits, limits, prices) live in code — plans.const.ts;
 * these columns hold only the user's subscription state.
 */
export class AddSubscriptionFields1782170000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_plan varchar NOT NULL DEFAULT 'starter'
    `);
    await queryRunner.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_billing varchar NOT NULL DEFAULT 'monthly'
    `);
    await queryRunner.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS credits_remaining int NOT NULL DEFAULT 500
    `);
    await queryRunner.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_renews_at timestamp NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS plan_renews_at`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS credits_remaining`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS plan_billing`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS subscription_plan`);
  }
}
