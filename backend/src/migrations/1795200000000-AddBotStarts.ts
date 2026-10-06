import { MigrationInterface, QueryRunner } from 'typeorm';

/** Where readers enter the search bot from (telegram-bot/bot-start.entity.ts). */
export class AddBotStarts1795200000000 implements MigrationInterface {
  name = 'AddBotStarts1795200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS bot_starts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        source character varying(24) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_bot_starts_user_created ON bot_starts (user_id, created_at)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS bot_starts`);
  }
}
