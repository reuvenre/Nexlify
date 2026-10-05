import { MigrationInterface, QueryRunner } from 'typeorm';

/** Posts as the channel shows them, for the readers' search (see channel-message.entity.ts). */
export class AddChannelMessages1794800000000 implements MigrationInterface {
  name = 'AddChannelMessages1794800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS channel_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        chat_id character varying(40) NOT NULL,
        chat_username character varying(64),
        message_id integer NOT NULL,
        text text NOT NULL,
        buy_url text,
        posted_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_channel_messages_chat_message UNIQUE (chat_id, message_id)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_channel_messages_user ON channel_messages (user_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS channel_messages`);
  }
}
