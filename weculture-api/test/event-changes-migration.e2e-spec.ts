import { DataSource, Table } from 'typeorm';
import { createDataSourceOptions } from '../src/database';
import { ENTITIES, Event, Post } from '../src/entities';
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
import { PostImages1793000005000 } from '../src/migrations/1793000005000-PostImages';

const migrations = [InitialSchema1789560000000, PostSubmissionIdentity1790899200000, PostCircles1791417600000, RoutePlanDetails1792454400000, PostComments1792458000000, ContentReports1793000000000, FeaturedPosts1793000001000, AnalyticsEvents1793000002000, EventChanges1793000003000];

describe('Event changes migration', () => {
  it('adds and reverts change fields while preserving existing events', async () => {
    const source = await new DataSource({ type: 'sqljs', entities: ENTITIES, migrations }).initialize(), runner = source.createQueryRunner();
    try {
      await source.runMigrations();
      await new PostImages1793000005000().up(runner);
      const post = await source.getRepository(Post).save({ authorId: 'author-a', type: 'event', status: 'approved', visibility: 'platform', circle: 'city', city: '北京', title: '迁移活动', content: '迁移正文' });
      const event = await source.getRepository(Event).save({ postId: post.id, startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 90000000), registrationDeadline: new Date(Date.now() + 80000000), location: '原地点', capacity: 10 });
      expect(event).toMatchObject({ changeNote: '', changedAt: null, cancellationReason: '' });
      await source.getRepository(Event).update(event.id, { status: 'changed', changeNote: '改地点', changedAt: new Date(), cancellationReason: '' });
      const table = await runner.getTable('events');
      expect(table?.findColumnByName('changeNote')).toBeTruthy();
      expect(table?.findColumnByName('changedAt')).toBeTruthy();
      expect(table?.findColumnByName('cancellationReason')).toBeTruthy();
      await source.undoLastMigration();
      expect(await runner.getTable('events')).not.toBeUndefined();
      expect(await source.getRepository(Event).count()).toBe(1);
      expect((await source.runMigrations()).map((migration) => migration.name)).toEqual(['EventChanges1793000003000']);
      expect(await source.getRepository(Event).findOneByOrFail({ id: event.id })).toMatchObject({ postId: post.id, location: '原地点' });
    } finally { await runner.release(); await source.destroy(); }
  });

  it('adopts synchronized schemas without losing events', async () => {
    const source = await new DataSource({ type: 'sqljs', entities: ENTITIES, migrations, synchronize: true }).initialize();
    try {
      const post = await source.getRepository(Post).save({ authorId: 'author-a', type: 'event', status: 'approved', visibility: 'platform', circle: 'city', city: '北京', title: '同步活动', content: '同步正文' });
      const event = await source.getRepository(Event).save({ postId: post.id, startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 90000000), registrationDeadline: new Date(Date.now() + 80000000), location: '原地点', capacity: 10 });
      expect((await source.runMigrations()).map((migration) => migration.name)).toEqual(migrations.map((migration) => migration.name));
      expect(await source.getRepository(Event).findOneByOrFail({ id: event.id })).toMatchObject({ changeNote: '', cancellationReason: '' });
      expect(await source.runMigrations()).toEqual([]);
    } finally { await source.destroy(); }
  });

  it('generates reversible MySQL column SQL without connecting to any database', async () => {
    const source = new DataSource({ type: 'mysql', database: 'isolated_event_changes_sql_only' });
    const runner = source.createQueryRunner();
    let present = true;
    jest.spyOn(runner, 'hasTable').mockImplementation(async () => present);
    jest.spyOn(runner as any, 'loadTables').mockImplementation(async () => runner.loadedTables);
    runner.enableSqlMemory();
    runner.loadedTables.push(new Table({ name: 'events', columns: [{ name: 'id', type: 'varchar', isPrimary: true }] }));
    const migration = new EventChanges1793000003000();
    await migration.up(runner);
    const upSql = runner.getMemorySql().upQueries.map((query) => query.query).join('\n');
    expect(upSql).toContain('ALTER TABLE `events` ADD `changeNote` varchar(500) NOT NULL DEFAULT \'\'');
    expect(upSql).toContain('ALTER TABLE `events` ADD `changedAt` datetime NULL');
    expect(upSql).toContain('ALTER TABLE `events` ADD `cancellationReason` varchar(500) NOT NULL DEFAULT \'\'');
    runner.clearSqlMemory(); present = true;
    await migration.down(runner);
    expect(runner.getMemorySql().upQueries.map((query) => query.query).join('\n')).toContain('ALTER TABLE `events` DROP COLUMN `changeNote`');
  });

  it('registers the event changes migration after all earlier migrations', () => {
    const previous = { NODE_ENV: process.env.NODE_ENV, DB_TYPE: process.env.DB_TYPE };
    try {
      for (const type of ['mysql', 'sqljs']) {
        process.env.NODE_ENV = 'development'; process.env.DB_TYPE = type;
        expect(createDataSourceOptions().migrations).toEqual([...migrations, FollowsNotifications1793000004000, PostImages1793000005000]);
      }
    } finally {
      for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
});
