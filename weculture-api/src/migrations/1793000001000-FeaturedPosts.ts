import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class FeaturedPosts1793000001000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(new Table({
      name: 'featured_posts',
      columns: [
        { name: 'id', type: 'varchar', length: '36', isPrimary: true },
        { name: 'createdAt', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
        { name: 'updatedAt', type: 'datetime', default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' },
        { name: 'postId', type: 'varchar', length: '36' },
        { name: 'scope', type: 'varchar', length: '20' },
        { name: 'schoolId', type: 'varchar', length: '36', isNullable: true },
        { name: 'sortOrder', type: 'int', default: 0 },
        { name: 'status', type: 'varchar', length: '20', default: "'active'" },
        { name: 'createdBy', type: 'varchar', length: '36' },
      ],
      indices: [
        { name: 'IDX_featured_posts_post', columnNames: ['postId'], isUnique: true },
        { name: 'IDX_featured_posts_scope_status_order', columnNames: ['scope', 'schoolId', 'status', 'sortOrder'] },
      ],
    }), true);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('featured_posts', true);
  }
}
