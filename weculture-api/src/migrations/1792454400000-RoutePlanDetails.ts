import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class RoutePlanDetails1792454400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('user_plans');
    const columns = [
      new TableColumn({ name: 'departDate', type: 'varchar', length: '10', isNullable: true }),
      new TableColumn({ name: 'companions', type: 'int', isNullable: true }),
    ].filter((column) => !table?.findColumnByName(column.name));
    if (columns.length) await queryRunner.addColumns('user_plans', columns);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('user_plans');
    const columns = ['departDate', 'companions'].filter((name) => table?.findColumnByName(name));
    if (columns.length) await queryRunner.dropColumns('user_plans', columns);
  }
}
