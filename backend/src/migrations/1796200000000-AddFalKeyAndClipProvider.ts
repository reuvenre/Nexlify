import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The account's fal.ai key (the Reels' image-to-video opening, fal-clip.ts), and which engine
 * made a Reel's AI clip, so the two can be compared.
 */
export class AddFalKeyAndClipProvider1796200000000 implements MigrationInterface {
  name = 'AddFalKeyAndClipProvider1796200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE credential_sets ADD COLUMN IF NOT EXISTS fal_api_key_enc character varying`);
    await queryRunner.query(`ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS clip_provider character varying(16)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE video_jobs DROP COLUMN IF EXISTS clip_provider`);
    await queryRunner.query(`ALTER TABLE credential_sets DROP COLUMN IF EXISTS fal_api_key_enc`);
  }
}
