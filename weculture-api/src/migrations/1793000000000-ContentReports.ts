import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class ContentReports1793000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(new Table({
      name: 'content_reports',
      columns: [
        { name: 'id', type: 'varchar', length: '36', isPrimary: true },
        { name: 'createdAt', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
        { name: 'updatedAt', type: 'datetime', default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' },
        { name: 'reporterId', type: 'varchar', length: '36' },
        { name: 'schoolId', type: 'varchar', length: '36', isNullable: true },
        { name: 'targetType', type: 'varchar', length: '20' },
        { name: 'targetId', type: 'varchar', length: '36' },
        { name: 'postId', type: 'varchar', length: '36' },
        { name: 'reason', type: 'varchar', length: '20' },
        { name: 'detail', type: 'text' },
        { name: 'status', type: 'varchar', length: '20', default: "'pending'" },
        { name: 'handledBy', type: 'varchar', length: '36', isNullable: true },
        { name: 'handledAt', type: 'datetime', isNullable: true },
        { name: 'resolution', type: 'text' },
      ],
      indices: [
        { name: 'IDX_content_reports_reporter_target', columnNames: ['reporterId', 'targetType', 'targetId'], isUnique: true },
        { name: 'IDX_content_reports_school_status_created', columnNames: ['schoolId', 'status', 'createdAt'] },
        { name: 'IDX_content_reports_target', columnNames: ['targetType', 'targetId'] },
      ],
    }), true);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('content_reports', true);
  }
}
