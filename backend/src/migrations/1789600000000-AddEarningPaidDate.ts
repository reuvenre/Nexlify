import { MigrationInterface, QueryRunner } from 'typeorm';

/** Payment-completed time per order — matches the portal's "Completed Payments Time". */
export class AddEarningPaidDate1789600000000 implements MigrationInterface {
  name = 'AddEarningPaidDate1789600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "earnings" ADD COLUMN IF NOT EXISTS "paid_date" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "earnings" DROP COLUMN IF EXISTS "paid_date"`);
  }
}
