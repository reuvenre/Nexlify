import { MigrationInterface, QueryRunner } from 'typeorm';

/** Product Reels rendered on GitHub Actions (videos/video-job.entity.ts). */
export class AddVideoJobs1795400000000 implements MigrationInterface {
  name = 'AddVideoJobs1795400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS video_jobs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        post_id uuid NOT NULL,
        status character varying(16) NOT NULL DEFAULT 'queued',
        origin character varying(16) NOT NULL DEFAULT 'auto',
        spec jsonb NOT NULL,
        worker_token character varying(64) NOT NULL,
        media_token character varying(64) NOT NULL,
        video bytea,
        video_size integer,
        error text,
        instagram_media_id character varying(64),
        facebook_video_id character varying(64),
        created_at timestamptz NOT NULL DEFAULT now(),
        rendered_at timestamptz,
        published_at timestamptz
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_video_jobs_post ON video_jobs (post_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_video_jobs_status ON video_jobs (status)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS video_jobs`);
  }
}
