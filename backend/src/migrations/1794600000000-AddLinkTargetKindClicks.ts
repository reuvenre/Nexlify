import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * link_targets learns who minted a code and how often it was clicked.
 *
 * A post's clicks are counted on the post. A code with no post behind it — the storefront's
 * buy buttons and now the members' search bot — redirected without being counted, so
 * there was no way to tell whether the search bot earns its keep. `kind` separates the bot's
 * codes from the store's; `clicks` counts human clicks (preview crawlers excluded).
 */
export class AddLinkTargetKindClicks1794600000000 implements MigrationInterface {
  name = 'AddLinkTargetKindClicks1794600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE link_targets ADD COLUMN IF NOT EXISTS kind character varying(20)`);
    await queryRunner.query(`ALTER TABLE link_targets ADD COLUMN IF NOT EXISTS clicks integer NOT NULL DEFAULT 0`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE link_targets DROP COLUMN IF EXISTS clicks`);
    await queryRunner.query(`ALTER TABLE link_targets DROP COLUMN IF EXISTS kind`);
  }
}
