import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Videos the owner picks into a post's album, beside its photos (album-videos.ts).
 *
 * Kept out of gallery_json because every platform but Telegram reads that column as photos.
 */
export class AddPostAlbumVideos1796000000000 implements MigrationInterface {
  name = 'AddPostAlbumVideos1796000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "album_videos" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "posts" DROP COLUMN IF EXISTS "album_videos"`);
  }
}
