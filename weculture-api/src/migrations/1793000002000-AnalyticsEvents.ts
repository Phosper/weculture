import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class AnalyticsEvents1793000002000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(new Table({
      name: 'analytics_events',
      columns: [
        { name: 'id', type: 'varchar', length: '36', isPrimary: true },
        { name: 'createdAt', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
        { name: 'updatedAt', type: 'datetime', default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' },
        { name: 'eventCode', type: 'varchar', length: '40' },
        { name: 'schoolId', type: 'varchar', length: '36', isNullable: true },
        { name: 'actorHash', type: 'varchar', length: '64', isNullable: true },
        { name: 'targetType', type: 'varchar', length: '20', isNullable: true },
        { name: 'targetId', type: 'varchar', length: '80', isNullable: true },
        { name: 'properties', type: 'text' },
        { name: 'dedupeKey', type: 'varchar', length: '120' },
      ],
      indices: [
        { name: 'IDX_analytics_events_code_created', columnNames: ['eventCode', 'createdAt'] },
        { name: 'IDX_analytics_events_school_created', columnNames: ['schoolId', 'createdAt'] },
        { name: 'IDX_analytics_events_dedupe', columnNames: ['dedupeKey'], isUnique: true },
      ],
    }), true);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('analytics_events', true);
  }
}
