import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class PostImages1793000005000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('posts');
    const columns = [
      new TableColumn({ name: 'imageUrls', type: 'text', isNullable: true }),
      new TableColumn({ name: 'coverIndex', type: 'int', default: 0 }),
    ].filter((column) => !table?.findColumnByName(column.name));
    if (columns.length) await queryRunner.addColumns('posts', columns);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('posts');
    const columns = ['imageUrls', 'coverIndex'].filter((name) => table?.findColumnByName(name));
    if (columns.length) await queryRunner.dropColumns('posts', columns);
  }
}
