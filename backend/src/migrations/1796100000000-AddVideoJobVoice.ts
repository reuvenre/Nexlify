import { MigrationInterface, QueryRunner } from 'typeorm';

/** The Reel's Hebrew voiceover (reel-voice.ts), and whether the finished Reel carries it. */
export class AddVideoJobVoice1796100000000 implements MigrationInterface {
  name = 'AddVideoJobVoice1796100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS voice bytea`);
    await queryRunner.query(`ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS has_voice boolean`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE video_jobs DROP COLUMN IF EXISTS has_voice`);
    await queryRunner.query(`ALTER TABLE video_jobs DROP COLUMN IF EXISTS voice`);
  }
}
