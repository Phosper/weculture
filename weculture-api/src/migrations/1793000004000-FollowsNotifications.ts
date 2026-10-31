import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class FollowsNotifications1793000004000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(new Table({
      name: 'follows',
      columns: [
        { name: 'id', type: 'varchar', length: '36', isPrimary: true },
        { name: 'createdAt', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
        { name: 'updatedAt', type: 'datetime', default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' },
        { name: 'followerId', type: 'varchar', length: '36' },
        { name: 'targetType', type: 'varchar', length: '20' },
        { name: 'targetId', type: 'varchar', length: '36' },
      ],
      indices: [
        { name: 'IDX_follows_follower_target', columnNames: ['followerId', 'targetType', 'targetId'], isUnique: true },
        { name: 'IDX_follows_target', columnNames: ['targetType', 'targetId'] },
      ],
    }), true);
    await queryRunner.createTable(new Table({
      name: 'user_notifications',
      columns: [
        { name: 'id', type: 'varchar', length: '36', isPrimary: true },
        { name: 'createdAt', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
        { name: 'updatedAt', type: 'datetime', default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' },
        { name: 'userId', type: 'varchar', length: '36' },
        { name: 'type', type: 'varchar', length: '30' },
        { name: 'actorId', type: 'varchar', length: '36', isNullable: true },
        { name: 'objectType', type: 'varchar', length: '20' },
        { name: 'objectId', type: 'varchar', length: '80' },
        { name: 'postId', type: 'varchar', length: '36', isNullable: true },
        { name: 'dedupeKey', type: 'varchar', length: '120' },
        { name: 'readAt', type: 'datetime', isNullable: true },
      ],
      indices: [
        { name: 'IDX_user_notifications_user_read_created', columnNames: ['userId', 'readAt', 'createdAt'] },
        { name: 'IDX_user_notifications_dedupe', columnNames: ['dedupeKey'], isUnique: true },
      ],
    }), true);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('user_notifications', true);
    await queryRunner.dropTable('follows', true);
  }
}
