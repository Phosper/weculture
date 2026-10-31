import { DataSource, Table } from 'typeorm';
import { createDataSourceOptions } from '../src/database';
import { ENTITIES, Follow, UserNotification } from '../src/entities';
import { InitialSchema1789560000000 } from '../src/migrations/1789560000000-InitialSchema';
import { PostSubmissionIdentity1790899200000 } from '../src/migrations/1790899200000-PostSubmissionIdentity';
import { PostCircles1791417600000 } from '../src/migrations/1791417600000-PostCircles';
import { RoutePlanDetails1792454400000 } from '../src/migrations/1792454400000-RoutePlanDetails';
import { PostComments1792458000000 } from '../src/migrations/1792458000000-PostComments';
import { ContentReports1793000000000 } from '../src/migrations/1793000000000-ContentReports';
import { FeaturedPosts1793000001000 } from '../src/migrations/1793000001000-FeaturedPosts';
import { AnalyticsEvents1793000002000 } from '../src/migrations/1793000002000-AnalyticsEvents';
import { EventChanges1793000003000 } from '../src/migrations/1793000003000-EventChanges';
import { FollowsNotifications1793000004000 } from '../src/migrations/1793000004000-FollowsNotifications';

const migrations = [InitialSchema1789560000000, PostSubmissionIdentity1790899200000, PostCircles1791417600000, RoutePlanDetails1792454400000, PostComments1792458000000, ContentReports1793000000000, FeaturedPosts1793000001000, AnalyticsEvents1793000002000, EventChanges1793000003000, FollowsNotifications1793000004000];
const follow = { followerId: 'user-a', targetType: 'user' as const, targetId: 'user-b' };
const notification = { userId: 'user-a', type: 'comment' as const, actorId: 'user-b', objectType: 'post' as const, objectId: 'post-a', postId: 'post-a', dedupeKey: 'notify-a', readAt: null };

describe('Follows and notifications migration', () => {
  it('creates and reverts both tables with the expected uniqueness', async () => {
    const source = await new DataSource({ type: 'sqljs', entities: ENTITIES, migrations }).initialize(), runner = source.createQueryRunner();
    try {
      await source.runMigrations();
      expect(await source.getRepository(Follow).save({ ...follow })).toMatchObject({ targetType: 'user' });
      await expect(source.getRepository(Follow).save({ ...follow })).rejects.toThrow();
      expect(await source.getRepository(UserNotification).save({ ...notification })).toMatchObject({ type: 'comment', readAt: null });
      await expect(source.getRepository(UserNotification).save({ ...notification })).rejects.toThrow();
      const followTable = await runner.getTable('follows'), notificationTable = await runner.getTable('user_notifications');
      expect(followTable?.indices).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'IDX_follows_follower_target', columnNames: ['followerId', 'targetType', 'targetId'], isUnique: true }),
        expect.objectContaining({ name: 'IDX_follows_target', columnNames: ['targetType', 'targetId'] }),
      ]));
      expect(notificationTable?.indices).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'IDX_user_notifications_user_read_created', columnNames: ['userId', 'readAt', 'createdAt'] }),
        expect.objectContaining({ name: 'IDX_user_notifications_dedupe', columnNames: ['dedupeKey'], isUnique: true }),
      ]));
      await source.undoLastMigration();
      expect(await runner.hasTable('follows')).toBe(false);
      expect(await runner.hasTable('user_notifications')).toBe(false);
      expect((await source.runMigrations()).map((migration) => migration.name)).toEqual(['FollowsNotifications1793000004000']);
      expect(await source.getRepository(Follow).count()).toBe(0);
      expect(await source.getRepository(UserNotification).count()).toBe(0);
    } finally { await runner.release(); await source.destroy(); }
  });

  it('adopts synchronized schemas without losing follow and notification rows', async () => {
    const source = await new DataSource({ type: 'sqljs', entities: ENTITIES, migrations, synchronize: true }).initialize();
    try {
      const savedFollow = await source.getRepository(Follow).save({ ...follow });
      const savedNotification = await source.getRepository(UserNotification).save({ ...notification });
      expect((await source.runMigrations()).map((migration) => migration.name)).toEqual(migrations.map((migration) => migration.name));
      expect(await source.getRepository(Follow).findOneByOrFail({ id: savedFollow.id })).toMatchObject({ targetId: 'user-b' });
      expect(await source.getRepository(UserNotification).findOneByOrFail({ id: savedNotification.id })).toMatchObject({ dedupeKey: 'notify-a', readAt: null });
      expect(await source.runMigrations()).toEqual([]);
    } finally { await source.destroy(); }
  });

  it('generates reversible MySQL table/index SQL without connecting to any database', async () => {
    const source = new DataSource({ type: 'mysql', database: 'isolated_follows_sql_only' });
    const runner = source.createQueryRunner();
    let present = false;
    jest.spyOn(runner, 'hasTable').mockImplementation(async () => present);
    jest.spyOn(runner as any, 'loadTables').mockImplementation(async () => runner.loadedTables);
    runner.enableSqlMemory();
    const migration = new FollowsNotifications1793000004000();
    await migration.up(runner);
    const upSql = runner.getMemorySql().upQueries.map((query) => query.query).join('\n');
    expect(upSql).toContain('CREATE TABLE `follows`');
    expect(upSql).toContain('UNIQUE INDEX `IDX_follows_follower_target` (`followerId`, `targetType`, `targetId`)');
    expect(upSql).toContain('INDEX `IDX_follows_target` (`targetType`, `targetId`)');
    expect(upSql).toContain('CREATE TABLE `user_notifications`');
    expect(upSql).toContain('UNIQUE INDEX `IDX_user_notifications_dedupe` (`dedupeKey`)');
    expect(upSql).toContain('INDEX `IDX_user_notifications_user_read_created` (`userId`, `readAt`, `createdAt`)');
    runner.loadedTables.push(new Table({ name: 'follows', columns: [{ name: 'id', type: 'varchar', isPrimary: true }] }));
    runner.loadedTables.push(new Table({ name: 'user_notifications', columns: [{ name: 'id', type: 'varchar', isPrimary: true }] }));
    runner.clearSqlMemory(); present = true;
    await migration.down(runner);
    const downSql = runner.getMemorySql().upQueries.map((query) => query.query).join('\n');
    expect(downSql).toContain('DROP TABLE `follows`');
    expect((downSql.match(/DROP TABLE/g) || []).length).toBe(2);
  });

  it('registers the follows/notifications migration after all earlier migrations', () => {
    const previous = { NODE_ENV: process.env.NODE_ENV, DB_TYPE: process.env.DB_TYPE };
    try {
      for (const type of ['mysql', 'sqljs']) {
        process.env.NODE_ENV = 'development'; process.env.DB_TYPE = type;
        expect(createDataSourceOptions().migrations).toEqual(migrations);
      }
    } finally {
      for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
});
