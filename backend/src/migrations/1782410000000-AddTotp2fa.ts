import { MigrationInterface, QueryRunner } from 'typeorm';

/** TOTP two-factor auth columns on the user. */
export class AddTotp2fa1782410000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret_enc varchar NULL`);
    await queryRunner.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS totp_enabled`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS totp_secret_enc`);
  }
}
