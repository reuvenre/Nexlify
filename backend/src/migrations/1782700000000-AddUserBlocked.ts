import { MigrationInterface, QueryRunner } from 'typeorm';

/** Admin can block/deactivate a user (blocked users can't log in). */
export class AddUserBlocked1782700000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked boolean NOT NULL DEFAULT false`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE users DROP COLUMN IF EXISTS is_blocked`);
  }
}
