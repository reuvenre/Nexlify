import { MigrationInterface, QueryRunner } from 'typeorm';

/** Credential slots for scaffolded integrations (WhatsApp / Amazon / Pinterest).
 *  Stored so users can enter keys; publish/import paths are wired later. */
export class AddScaffoldIntegrations1782570000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    const add = (col: string, type = 'varchar') =>
      q.query(`ALTER TABLE credential_sets ADD COLUMN IF NOT EXISTS ${col} ${type} NULL`);
    await add('whatsapp_phone_number_id');
    await add('whatsapp_access_token_enc');
    await add('amazon_access_key');
    await add('amazon_secret_key_enc');
    await add('amazon_partner_tag');
    await add('pinterest_access_token_enc');
    await add('pinterest_board_id');
  }

  public async down(q: QueryRunner): Promise<void> {
    const drop = (col: string) => q.query(`ALTER TABLE credential_sets DROP COLUMN IF EXISTS ${col}`);
    await drop('whatsapp_phone_number_id');
    await drop('whatsapp_access_token_enc');
    await drop('amazon_access_key');
    await drop('amazon_secret_key_enc');
    await drop('amazon_partner_tag');
    await drop('pinterest_access_token_enc');
    await drop('pinterest_board_id');
  }
}
