import { DataSource, Table } from 'typeorm';
import { createDataSourceOptions } from '../src/database';
import { ENTITIES, ContentReport } from '../src/entities';
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

const migrations = [InitialSchema1789560000000, PostSubmissionIdentity1790899200000, PostCircles1791417600000, RoutePlanDetails1792454400000, PostComments1792458000000, ContentReports1793000000000];
const fixture = { reporterId: 'user-a', schoolId: null, targetType: 'post' as const, targetId: 'post-a', postId: 'post-a', reason: 'spam', detail: '', status: 'pending' as const, handledBy: null, handledAt: null, resolution: '' };

describe('Content reports migration', () => {
  it('creates and reverts the reports table with scoped indexes and duplicate protection', async () => {
    const source = await new DataSource({ type: 'sqljs', entities: ENTITIES, migrations }).initialize(), runner = source.createQueryRunner();
    try {
      await source.runMigrations();
      const repo = source.getRepository(ContentReport);
      expect(await repo.save({ ...fixture })).toMatchObject({ status: 'pending', schoolId: null, handledAt: null });
      await expect(repo.save({ ...fixture })).rejects.toThrow();
      await repo.save({ ...fixture, reporterId: 'user-b' });
      await repo.save({ ...fixture, targetId: 'post-b', postId: 'post-b' });
      const table = await runner.getTable('content_reports');
      expect(table?.indices).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'IDX_content_reports_reporter_target', columnNames: ['reporterId', 'targetType', 'targetId'], isUnique: true }),
        expect.objectContaining({ name: 'IDX_content_reports_school_status_created', columnNames: ['schoolId', 'status', 'createdAt'] }),
        expect.objectContaining({ name: 'IDX_content_reports_target', columnNames: ['targetType', 'targetId'] }),
      ]));
      await source.undoLastMigration();
      expect(await runner.hasTable('content_reports')).toBe(false);
      expect((await source.runMigrations()).map((migration) => migration.name)).toEqual(['ContentReports1793000000000']);
      expect(await repo.count()).toBe(0);
    } finally { await runner.release(); await source.destroy(); }
  });

  it('adopts synchronized schemas without losing existing data', async () => {
    const source = await new DataSource({ type: 'sqljs', entities: ENTITIES, migrations, synchronize: true }).initialize();
    try {
      const saved = await source.getRepository(ContentReport).save({ ...fixture });
      expect((await source.runMigrations()).map((migration) => migration.name)).toEqual(migrations.map((migration) => migration.name));
      expect(await source.getRepository(ContentReport).findOneByOrFail({ id: saved.id })).toMatchObject({ ...fixture, status: 'pending' });
      expect(await source.runMigrations()).toEqual([]);
    } finally { await source.destroy(); }
  });

  it('generates reversible MySQL table/index SQL without connecting to any database', async () => {
    const source = new DataSource({ type: 'mysql', database: 'isolated_reports_sql_only' });
    const runner = source.createQueryRunner();
    let present = false;
    jest.spyOn(runner, 'hasTable').mockImplementation(async () => present);
    jest.spyOn(runner as any, 'loadTables').mockImplementation(async () => runner.loadedTables);
    runner.enableSqlMemory();
    const migration = new ContentReports1793000000000();
    await migration.up(runner);
    const createSql = runner.getMemorySql().upQueries.map((query) => query.query).join('\n');
    expect(createSql).toContain('CREATE TABLE `content_reports`');
    expect(createSql).toContain('`status` varchar(20) NOT NULL DEFAULT \'pending\'');
    expect(createSql).toContain('`schoolId` varchar(36) NULL');
    expect(createSql).toContain('UNIQUE INDEX `IDX_content_reports_reporter_target` (`reporterId`, `targetType`, `targetId`)');
    expect(createSql).toContain('INDEX `IDX_content_reports_school_status_created` (`schoolId`, `status`, `createdAt`)');
    expect(createSql).toContain('INDEX `IDX_content_reports_target` (`targetType`, `targetId`)');
    runner.loadedTables.push(new Table({ name: 'content_reports', columns: [{ name: 'id', type: 'varchar', isPrimary: true }] }));
    runner.clearSqlMemory(); present = true;
    await migration.down(runner);
    expect(runner.getMemorySql().upQueries.map((query) => query.query)).toContain('DROP TABLE `content_reports`');
  });

  it('registers the reports migration after all earlier migrations', () => {
    const previous = { NODE_ENV: process.env.NODE_ENV, DB_TYPE: process.env.DB_TYPE };
    try {
      for (const type of ['mysql', 'sqljs']) {
        process.env.NODE_ENV = 'development'; process.env.DB_TYPE = type;
        expect(createDataSourceOptions().migrations).toEqual([...migrations, FeaturedPosts1793000001000, AnalyticsEvents1793000002000, EventChanges1793000003000, FollowsNotifications1793000004000, PostImages1793000005000]);
      }
    } finally {
      for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
});
