import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Every account may run its own readers' bot (and talk to the manager in it).
 *
 * The bot's token and the linked owner chat live on the account's credentials. A reader
 * talks to each bot separately, so a price alert or a followed parcel belongs to the
 * account whose bot it came through: the unique keys gain user_id.
 */
export class AddTenantBots1795600000000 implements MigrationInterface {
  name = 'AddTenantBots1795600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE credential_sets ADD COLUMN IF NOT EXISTS search_bot_token_enc text`);
    await queryRunner.query(`ALTER TABLE credential_sets ADD COLUMN IF NOT EXISTS manager_chat_id character varying(40)`);

    await queryRunner.query(`ALTER TABLE price_alerts DROP CONSTRAINT IF EXISTS uq_price_alerts_chat_product`);
    await queryRunner.query(`ALTER TABLE price_alerts DROP CONSTRAINT IF EXISTS uq_price_alerts_user_chat_product`);
    await queryRunner.query(`ALTER TABLE price_alerts ADD CONSTRAINT uq_price_alerts_user_chat_product UNIQUE (user_id, chat_id, product_id)`);

    await queryRunner.query(`ALTER TABLE parcel_tracks DROP CONSTRAINT IF EXISTS uq_parcel_tracks_chat_number`);
    await queryRunner.query(`ALTER TABLE parcel_tracks DROP CONSTRAINT IF EXISTS uq_parcel_tracks_user_chat_number`);
    await queryRunner.query(`ALTER TABLE parcel_tracks ADD CONSTRAINT uq_parcel_tracks_user_chat_number UNIQUE (user_id, chat_id, number)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE parcel_tracks DROP CONSTRAINT IF EXISTS uq_parcel_tracks_user_chat_number`);
    await queryRunner.query(`ALTER TABLE parcel_tracks ADD CONSTRAINT uq_parcel_tracks_chat_number UNIQUE (chat_id, number)`);
    await queryRunner.query(`ALTER TABLE price_alerts DROP CONSTRAINT IF EXISTS uq_price_alerts_user_chat_product`);
    await queryRunner.query(`ALTER TABLE price_alerts ADD CONSTRAINT uq_price_alerts_chat_product UNIQUE (chat_id, product_id)`);
    await queryRunner.query(`ALTER TABLE credential_sets DROP COLUMN IF EXISTS manager_chat_id`);
    await queryRunner.query(`ALTER TABLE credential_sets DROP COLUMN IF EXISTS search_bot_token_enc`);
  }
}
