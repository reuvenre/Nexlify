import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserRolesAndPlans1780000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS role varchar NOT NULL DEFAULT 'user'
    `);
    await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS plan varchar NOT NULL DEFAULT 'free'
    `);

    // Bootstrap the system owner as admin with full (Scale) plan access
    await queryRunner.query(`
      UPDATE users SET role = 'admin', plan = 'scale' WHERE email = 'rubypc6@gmail.com'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS plan`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS role`);
  }
}
