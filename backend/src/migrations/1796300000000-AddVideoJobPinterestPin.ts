import { MigrationInterface, QueryRunner } from 'typeorm';

/** The English Reel goes out as a Pinterest video pin (videos/pinterest-video.ts). */
export class AddVideoJobPinterestPin1796300000000 implements MigrationInterface {
  name = 'AddVideoJobPinterestPin1796300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS pinterest_pin_id character varying(64)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE video_jobs DROP COLUMN IF EXISTS pinterest_pin_id`);
  }
}
