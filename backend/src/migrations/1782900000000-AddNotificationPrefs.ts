import { MigrationInterface, QueryRunner } from 'typeorm';

/** Email notification preferences — only for notifications that are actually delivered. */
export class AddNotificationPrefs1782900000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS notification_prefs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        daily_summary boolean NOT NULL DEFAULT false,
        campaign_errors boolean NOT NULL DEFAULT false,
        last_daily_sent_on varchar NULL,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT uq_notification_prefs_user UNIQUE (user_id)
      )
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS notification_prefs`);
  }
}
