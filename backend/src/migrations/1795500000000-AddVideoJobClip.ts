import { MigrationInterface, QueryRunner } from 'typeorm';

/** The Reel's opening clip: the AI clip's bytes, and what the Reel actually opened with. */
export class AddVideoJobClip1795500000000 implements MigrationInterface {
  name = 'AddVideoJobClip1795500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS clip bytea`);
    await queryRunner.query(`ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS clip_source character varying(16)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE video_jobs DROP COLUMN IF EXISTS clip_source`);
    await queryRunner.query(`ALTER TABLE video_jobs DROP COLUMN IF EXISTS clip`);
  }
}
