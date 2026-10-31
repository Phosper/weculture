import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class PostSubmissionIdentity1790899200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('posts');
    const columns = [
      new TableColumn({ name: 'clientRequestId', type: 'varchar', length: '80', isNullable: true }),
      new TableColumn({ name: 'submissionHash', type: 'varchar', length: '64', isNullable: true }),
    ].filter((column) => !table?.findColumnByName(column.name));
    if (columns.length) await queryRunner.addColumns('posts', columns);
    if (!table?.indices.some((index) => index.name === 'IDX_posts_authorId_clientRequestId')) await queryRunner.createIndex('posts', new TableIndex({
      name: 'IDX_posts_authorId_clientRequestId', columnNames: ['authorId', 'clientRequestId'], isUnique: true,
    }));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('posts', 'IDX_posts_authorId_clientRequestId');
    await queryRunner.dropColumns('posts', ['clientRequestId', 'submissionHash']);
  }
}
