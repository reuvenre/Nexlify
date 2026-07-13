import { MigrationInterface, QueryRunner } from 'typeorm';

/** Multi-group fan-out: a post can target several groups at once (one credit). */
export class AddPostChannelOverrides1782650000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS channel_overrides text NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE posts DROP COLUMN IF EXISTS channel_overrides`);
  }
}
