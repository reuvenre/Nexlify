import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NEXUS integration: multi-provider AI, Facebook/Meta publishing, Apify discovery,
 * and Meta Ads auto-boost. Adds credential columns, post/catalog columns, and the
 * ad_boosts table. All statements are idempotent so this is safe to re-run.
 */
export class AddNexusIntegration1782000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── credential_sets: new provider / channel / boost columns ──
    await queryRunner.query(`
      ALTER TABLE credential_sets
        ADD COLUMN IF NOT EXISTS ai_provider varchar NOT NULL DEFAULT 'anthropic',
        ADD COLUMN IF NOT EXISTS anthropic_api_key_enc varchar,
        ADD COLUMN IF NOT EXISTS anthropic_model varchar NOT NULL DEFAULT 'claude-sonnet-4-6',
        ADD COLUMN IF NOT EXISTS gemini_api_key_enc varchar,
        ADD COLUMN IF NOT EXISTS gemini_model varchar NOT NULL DEFAULT 'gemini-2.5-flash',
        ADD COLUMN IF NOT EXISTS facebook_page_id varchar,
        ADD COLUMN IF NOT EXISTS facebook_page_token_enc varchar,
        ADD COLUMN IF NOT EXISTS meta_ad_account_id varchar,
        ADD COLUMN IF NOT EXISTS publish_telegram boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS publish_facebook boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS apify_api_token_enc varchar,
        ADD COLUMN IF NOT EXISTS boost_enabled boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS boost_roas_threshold double precision NOT NULL DEFAULT 2.0,
        ADD COLUMN IF NOT EXISTS boost_daily_budget integer NOT NULL DEFAULT 50,
        ADD COLUMN IF NOT EXISTS boost_hard_limit_usd integer NOT NULL DEFAULT 200
    `);

    // ── posts: Facebook post id ──
    await queryRunner.query(`
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS facebook_post_id varchar
    `);

    // ── catalog_products: link health flag ──
    await queryRunner.query(`
      ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS link_validated boolean
    `);

    // ── ad_boosts table ──
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ad_boosts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL,
        post_id varchar,
        facebook_post_id varchar,
        product_title varchar,
        clicks integer NOT NULL DEFAULT 0,
        impressions integer NOT NULL DEFAULT 0,
        roas double precision NOT NULL DEFAULT 0,
        ad_spend double precision NOT NULL DEFAULT 0,
        daily_budget double precision NOT NULL DEFAULT 0,
        status varchar NOT NULL DEFAULT 'skipped',
        campaign_id varchar,
        adset_id varchar,
        creative_id varchar,
        ad_id varchar,
        note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_ad_boosts_user_id ON ad_boosts (user_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS ad_boosts`);
    await queryRunner.query(`ALTER TABLE catalog_products DROP COLUMN IF EXISTS link_validated`);
    await queryRunner.query(`ALTER TABLE posts DROP COLUMN IF EXISTS facebook_post_id`);
    await queryRunner.query(`
      ALTER TABLE credential_sets
        DROP COLUMN IF EXISTS ai_provider,
        DROP COLUMN IF EXISTS anthropic_api_key_enc,
        DROP COLUMN IF EXISTS anthropic_model,
        DROP COLUMN IF EXISTS gemini_api_key_enc,
        DROP COLUMN IF EXISTS gemini_model,
        DROP COLUMN IF EXISTS facebook_page_id,
        DROP COLUMN IF EXISTS facebook_page_token_enc,
        DROP COLUMN IF EXISTS meta_ad_account_id,
        DROP COLUMN IF EXISTS publish_telegram,
        DROP COLUMN IF EXISTS publish_facebook,
        DROP COLUMN IF EXISTS apify_api_token_enc,
        DROP COLUMN IF EXISTS boost_enabled,
        DROP COLUMN IF EXISTS boost_roas_threshold,
        DROP COLUMN IF EXISTS boost_daily_budget,
        DROP COLUMN IF EXISTS boost_hard_limit_usd
    `);
  }
}
