import type { MigrationInterface, QueryRunner } from "typeorm";

export class Baseline1730000000000 implements MigrationInterface {
  name = "Baseline1730000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("SELECT 1");
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("SELECT 1");
  }
}
