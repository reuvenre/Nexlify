import { MigrationInterface, QueryRunner } from 'typeorm';

/** Display name chosen at registration — shown in the UI instead of the email prefix. */
export class AddUserName1788000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS name varchar`);
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS name`);
  }
}
