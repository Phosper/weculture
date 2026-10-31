import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class EventChanges1793000003000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('events');
    const columns = [
      new TableColumn({ name: 'changeNote', type: 'varchar', length: '500', default: "''" }),
      new TableColumn({ name: 'changedAt', type: 'datetime', isNullable: true }),
      new TableColumn({ name: 'cancellationReason', type: 'varchar', length: '500', default: "''" }),
    ].filter((column) => !table?.findColumnByName(column.name));
    if (columns.length) await queryRunner.addColumns('events', columns);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('events');
    const columns = ['changeNote', 'changedAt', 'cancellationReason'].filter((name) => table?.findColumnByName(name));
    if (columns.length) await queryRunner.dropColumns('events', columns);
  }
}
