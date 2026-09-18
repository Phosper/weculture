import { MigrationInterface, QueryRunner, Table, TableColumnOptions, TableIndex } from 'typeorm';

const baseColumns: TableColumnOptions[] = [
  { name: 'id', type: 'varchar', length: '36', isPrimary: true },
  { name: 'createdAt', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
  { name: 'updatedAt', type: 'datetime', default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' },
];

const text = (name: string, options: Partial<TableColumnOptions> = {}): TableColumnOptions => ({ name, type: 'varchar', length: '255', ...options });
const integer = (name: string, defaultValue?: number): TableColumnOptions => ({ name, type: 'int', ...(defaultValue === undefined ? {} : { default: String(defaultValue) }) });
const index = (table: string, columns: string[], unique = false) => new TableIndex({ name: `IDX_${table}_${columns.join('_')}`, columnNames: columns, isUnique: unique });

export class InitialSchema1789560000000 implements MigrationInterface {
  name = 'InitialSchema1789560000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tables = [
      new Table({ name: 'schools', columns: [...baseColumns, text('name', { isUnique: true }), text('shortName'), text('status', { default: "'active'" })] }),
      new Table({ name: 'users', columns: [...baseColumns, text('wechatOpenId', { isUnique: true }), text('nickname', { default: "''" }), text('avatarUrl', { default: "''" }), text('status', { default: "'active'" })] }),
      new Table({ name: 'school_memberships', columns: [...baseColumns, text('userId', { length: '36' }), text('schoolId', { length: '36' }), text('verificationStatus', { default: "'verified'" }), text('memberRole', { default: "'member'" })], indices: [index('school_memberships', ['userId', 'schoolId'], true)] }),
      new Table({ name: 'invite_codes', columns: [...baseColumns, text('code', { isUnique: true }), text('schoolId', { length: '36' }), text('batchName'), integer('maxUses', 1), integer('usedCount', 0), { name: 'expiresAt', type: 'datetime', isNullable: true }, text('status', { default: "'active'" })] }),
      new Table({ name: 'posts', columns: [...baseColumns, text('schoolId', { length: '36', isNullable: true }), text('authorId', { length: '36' }), text('type'), text('visibility', { default: "'school'" }), text('status', { default: "'pending'" }), text('title'), { name: 'content', type: 'text' }, text('imageUrl', { default: "''" }), text('tag', { default: "''" }), integer('likeCount', 0), text('rejectionReason', { default: "''" }), text('reviewedBy', { length: '36', isNullable: true })] }),
      new Table({ name: 'events', columns: [...baseColumns, text('postId', { length: '36', isUnique: true }), { name: 'startsAt', type: 'datetime' }, { name: 'endsAt', type: 'datetime' }, text('location'), { name: 'registrationDeadline', type: 'datetime' }, integer('capacity', 30), integer('registeredCount', 0), text('status', { default: "'active'" })] }),
      new Table({ name: 'event_registrations', columns: [...baseColumns, text('eventId', { length: '36' }), text('userId', { length: '36' }), text('status', { default: "'registered'" })], indices: [index('event_registrations', ['eventId', 'userId'], true)] }),
      new Table({ name: 'likes', columns: [...baseColumns, text('userId', { length: '36' }), text('postId', { length: '36' })], indices: [index('likes', ['userId', 'postId'], true)] }),
      new Table({ name: 'favorites', columns: [...baseColumns, text('userId', { length: '36' }), text('targetType'), text('targetId', { length: '36' })], indices: [index('favorites', ['userId', 'targetType', 'targetId'], true)] }),
      new Table({ name: 'travel_routes', columns: [...baseColumns, text('schoolId', { length: '36', isNullable: true }), text('visibility', { default: "'platform'" }), text('status', { default: "'active'" }), text('title'), text('destination'), text('days'), integer('budget', 0), { name: 'preferences', type: 'text' }, { name: 'stops', type: 'text' }, { name: 'highlights', type: 'text' }, text('coverUrl', { default: "''" })] }),
      new Table({ name: 'user_plans', columns: [...baseColumns, text('userId', { length: '36' }), text('targetType'), text('targetId', { length: '36' }), text('status', { default: "'active'" })], indices: [index('user_plans', ['userId', 'targetType', 'targetId'], true)] }),
      new Table({ name: 'assistant_knowledge', columns: [...baseColumns, text('schoolId', { length: '36', isNullable: true }), text('question'), { name: 'keywords', type: 'text' }, { name: 'answer', type: 'text' }, text('status', { default: "'active'" })] }),
      new Table({ name: 'assistant_messages', columns: [...baseColumns, text('userId', { length: '36' }), text('schoolId', { length: '36', isNullable: true }), text('role'), { name: 'content', type: 'text' }] }),
      new Table({ name: 'admin_accounts', columns: [...baseColumns, text('username', { isUnique: true }), text('passwordHash'), text('role', { default: "'operator'" }), text('schoolId', { length: '36', isNullable: true }), text('status', { default: "'active'" })] }),
      new Table({ name: 'audit_logs', columns: [...baseColumns, text('adminId', { length: '36' }), text('schoolId', { length: '36', isNullable: true }), text('action'), text('resourceType'), text('resourceId', { length: '36' }), text('result', { default: "'success'" }), { name: 'detail', type: 'text' }] }),
    ];

    for (const table of tables) await queryRunner.createTable(table, true);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tables = ['audit_logs', 'admin_accounts', 'assistant_messages', 'assistant_knowledge', 'user_plans', 'travel_routes', 'favorites', 'likes', 'event_registrations', 'events', 'posts', 'invite_codes', 'school_memberships', 'users', 'schools'];
    for (const table of tables) await queryRunner.dropTable(table, true);
  }
}
