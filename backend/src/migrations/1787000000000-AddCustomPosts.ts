import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Scheduled custom posts ("special posts"): user-authored content sent to chosen groups at a
 * chosen time, optionally recurring. Dispatched into each group's next free queue slot so it
 * interleaves with the autopilot posts on the same clock.
 */
export class AddCustomPosts1787000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS custom_posts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL,
        name varchar NOT NULL DEFAULT '',
        body text NOT NULL,
        image_urls jsonb,
        target_channels jsonb,
        send_at timestamptz NOT NULL,
        repeat varchar NOT NULL DEFAULT 'none',
        enabled boolean NOT NULL DEFAULT true,
        next_send_at timestamptz,
        last_sent_at timestamptz,
        sent_count integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_custom_posts_user ON custom_posts (user_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS custom_posts`);
  }
}
