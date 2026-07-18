import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Password-protected Yupoo catalogs: store the store's "index-lock" password (AES-encrypted)
 * so the fetcher can unlock it via the `indexlockcode` cookie. Null = public store.
 */
export class AddSupplierCatalogPassword1785000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE supplier_catalogs
        ADD COLUMN IF NOT EXISTS password_enc varchar
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE supplier_catalogs DROP COLUMN IF EXISTS password_enc`);
  }
}
