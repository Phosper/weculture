import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class PostComments1792458000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(new Table({
      name: 'post_comments',
      columns: [
        { name: 'id', type: 'varchar', length: '36', isPrimary: true },
        { name: 'createdAt', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
        { name: 'updatedAt', type: 'datetime', default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' },
        { name: 'postId', type: 'varchar', length: '36' },
        { name: 'authorId', type: 'varchar', length: '36' },
        { name: 'parentId', type: 'varchar', length: '36', isNullable: true },
        { name: 'content', type: 'text' },
        { name: 'deleted', type: 'boolean', default: '0' },
        { name: 'clientRequestId', type: 'varchar', length: '80' },
        { name: 'clientRequestHash', type: 'varchar', length: '64' },
        { name: 'submissionHash', type: 'varchar', length: '64' },
      ],
      indices: [
        { name: 'IDX_post_comments_request', columnNames: ['authorId', 'postId', 'clientRequestHash'], isUnique: true },
        { name: 'IDX_post_comments_post_created', columnNames: ['postId', 'createdAt', 'id'] },
      ],
    }), true);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('post_comments', true);
  }
}
