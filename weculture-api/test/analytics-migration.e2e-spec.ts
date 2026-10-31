import { DataSource, Table } from 'typeorm';
import { createDataSourceOptions } from '../src/database';
import { ENTITIES, AnalyticsEvent } from '../src/entities';
import { InitialSchema1789560000000 } from '../src/migrations/1789560000000-InitialSchema';
import { PostSubmissionIdentity1790899200000 } from '../src/migrations/1790899200000-PostSubmissionIdentity';
import { PostCircles1791417600000 } from '../src/migrations/1791417600000-PostCircles';
import { RoutePlanDetails1792454400000 } from '../src/migrations/1792454400000-RoutePlanDetails';
import { PostComments1792458000000 } from '../src/migrations/1792458000000-PostComments';
import { ContentReports1793000000000 } from '../src/migrations/1793000000000-ContentReports';
import { FeaturedPosts1793000001000 } from '../src/migrations/1793000001000-FeaturedPosts';
import { AnalyticsEvents1793000002000 } from '../src/migrations/1793000002000-AnalyticsEvents';
import { EventChanges1793000003000 } from '../src/migrations/1793000003000-EventChanges';

const migrations = [InitialSchema1789560000000, PostSubmissionIdentity1790899200000, PostCircles1791417600000, RoutePlanDetails1792454400000, PostComments1792458000000, ContentReports1793000000000, FeaturedPosts1793000001000, AnalyticsEvents1793000002000];
const fixture = { eventCode: 'post_viewed', schoolId: null, actorHash: 'a'.repeat(64), targetType: 'post', targetId: 'post-a', properties: '{}', dedupeKey: 'dedupe-a' };

describe('Analytics events migration', () => {
  it('creates and reverts the analytics table with a unique dedupe key', async () => {
    const source = await new DataSource({ type: 'sqljs', entities: ENTITIES, migrations }).initialize(), runner = source.createQueryRunner();
    try {
      await source.runMigrations();
      const repo = source.getRepository(AnalyticsEvent);
      expect(await repo.save({ ...fixture })).toMatchObject({ eventCode: 'post_viewed' });
      await expect(repo.save({ ...fixture })).rejects.toThrow();
      await repo.save({ ...fixture, dedupeKey: 'dedupe-b' });
      const table = await runner.getTable('analytics_events');
      expect(table?.indices).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'IDX_analytics_events_code_created', columnNames: ['eventCode', 'createdAt'] }),
        expect.objectContaining({ name: 'IDX_analytics_events_school_created', columnNames: ['schoolId', 'createdAt'] }),
        expect.objectContaining({ name: 'IDX_analytics_events_dedupe', columnNames: ['dedupeKey'], isUnique: true }),
      ]));
      await source.undoLastMigration();
      expect(await runner.hasTable('analytics_events')).toBe(false);
      expect((await source.runMigrations()).map((migration) => migration.name)).toEqual(['AnalyticsEvents1793000002000']);
      expect(await repo.count()).toBe(0);
    } finally { await runner.release(); await source.destroy(); }
  });

  it('adopts synchronized schemas without losing existing events', async () => {
    const source = await new DataSource({ type: 'sqljs', entities: ENTITIES, migrations, synchronize: true }).initialize();
    try {
      const saved = await source.getRepository(AnalyticsEvent).save({ ...fixture });
      expect((await source.runMigrations()).map((migration) => migration.name)).toEqual(migrations.map((migration) => migration.name));
      expect(await source.getRepository(AnalyticsEvent).findOneByOrFail({ id: saved.id })).toMatchObject({ ...fixture });
      expect(await source.runMigrations()).toEqual([]);
    } finally { await source.destroy(); }
  });

  it('generates reversible MySQL table/index SQL without connecting to any database', async () => {
    const source = new DataSource({ type: 'mysql', database: 'isolated_analytics_sql_only' });
    const runner = source.createQueryRunner();
    let present = false;
    jest.spyOn(runner, 'hasTable').mockImplementation(async () => present);
    jest.spyOn(runner as any, 'loadTables').mockImplementation(async () => runner.loadedTables);
    runner.enableSqlMemory();
    const migration = new AnalyticsEvents1793000002000();
    await migration.up(runner);
    const createSql = runner.getMemorySql().upQueries.map((query) => query.query).join('\n');
    expect(createSql).toContain('CREATE TABLE `analytics_events`');
    expect(createSql).toContain('`eventCode` varchar(40) NOT NULL');
    expect(createSql).toContain('`actorHash` varchar(64) NULL');
    expect(createSql).toContain('`dedupeKey` varchar(120) NOT NULL');
    expect(createSql).toContain('UNIQUE INDEX `IDX_analytics_events_dedupe` (`dedupeKey`)');
    expect(createSql).toContain('INDEX `IDX_analytics_events_code_created` (`eventCode`, `createdAt`)');
    expect(createSql).toContain('INDEX `IDX_analytics_events_school_created` (`schoolId`, `createdAt`)');
    runner.loadedTables.push(new Table({ name: 'analytics_events', columns: [{ name: 'id', type: 'varchar', isPrimary: true }] }));
    runner.clearSqlMemory(); present = true;
    await migration.down(runner);
    expect(runner.getMemorySql().upQueries.map((query) => query.query)).toContain('DROP TABLE `analytics_events`');
  });

  it('registers the analytics migration after all earlier migrations', () => {
    const previous = { NODE_ENV: process.env.NODE_ENV, DB_TYPE: process.env.DB_TYPE };
    try {
      for (const type of ['mysql', 'sqljs']) {
        process.env.NODE_ENV = 'development'; process.env.DB_TYPE = type;
        expect(createDataSourceOptions().migrations).toEqual([...migrations, EventChanges1793000003000]);
      }
    } finally {
      for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
});
