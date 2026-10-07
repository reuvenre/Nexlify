import { MigrationInterface, QueryRunner } from 'typeorm';

/** Readers following a parcel (telegram-bot/parcel-track.entity.ts). */
export class AddParcelTracks1795300000000 implements MigrationInterface {
  name = 'AddParcelTracks1795300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS parcel_tracks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        chat_id character varying(40) NOT NULL,
        number character varying(40) NOT NULL,
        status character varying(30),
        sub_status character varying(60),
        event_time timestamptz,
        active boolean NOT NULL DEFAULT true,
        checked_at timestamptz,
        notified_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_parcel_tracks_chat_number UNIQUE (chat_id, number)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_parcel_tracks_active ON parcel_tracks (active)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS parcel_tracks`);
  }
}
