import { MigrationInterface, QueryRunner } from 'typeorm';

/** Append-only security audit log (brute-force, privilege escalation, …). */
export class AddSecurityEvents1789700000000 implements MigrationInterface {
  name = 'AddSecurityEvents1789700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "security_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "type" character varying NOT NULL,
        "email" character varying,
        "user_id" character varying,
        "ip" character varying,
        "detail" character varying,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_security_events_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_secevent_type_time" ON "security_events" ("type", "created_at")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_secevent_time" ON "security_events" ("created_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "security_events"`);
  }
}
