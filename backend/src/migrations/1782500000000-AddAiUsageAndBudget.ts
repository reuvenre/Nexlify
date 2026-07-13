import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AI token metering: per-day/per-provider usage rollup + an optional monthly
 * token budget on the user's credentials (powers the dashboard usage gauge).
 */
export class AddAiUsageAndBudget1782500000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS ai_usage (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL,
        day date NOT NULL,
        provider varchar NOT NULL DEFAULT 'gemini',
        prompt_tokens bigint NOT NULL DEFAULT 0,
        output_tokens bigint NOT NULL DEFAULT 0,
        total_tokens bigint NOT NULL DEFAULT 0,
        calls integer NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT uq_ai_usage_user_day_provider UNIQUE (user_id, day, provider)
      )
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage (user_id)`);
    await q.query(`ALTER TABLE credential_sets ADD COLUMN IF NOT EXISTS ai_monthly_token_budget integer NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE credential_sets DROP COLUMN IF EXISTS ai_monthly_token_budget`);
    await q.query(`DROP TABLE IF EXISTS ai_usage`);
  }
}
