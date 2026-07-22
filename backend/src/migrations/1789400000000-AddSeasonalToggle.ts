import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Commercial-calendar seasonality kill-switch. ON by default: during event windows
 * (holidays/sales, built into the code) seasonal keywords join campaign rotations and
 * the copywriter gets a seasonal context line — zero user setup.
 */
export class AddSeasonalToggle1789400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE credential_sets ADD COLUMN IF NOT EXISTS seasonal_enabled boolean NOT NULL DEFAULT true`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE credential_sets DROP COLUMN IF EXISTS seasonal_enabled`);
  }
}
