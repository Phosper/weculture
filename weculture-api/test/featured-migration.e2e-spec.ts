import { DataSource, Table } from 'typeorm';
import { createDataSourceOptions } from '../src/database';
import { ENTITIES, FeaturedPost } from '../src/entities';
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

const migrations = [InitialSchema1789560000000, PostSubmissionIdentity1790899200000, PostCircles1791417600000, RoutePlanDetails1792454400000, PostComments1792458000000, ContentReports1793000000000, FeaturedPosts1793000001000];
const fixture = { postId: 'post-a', scope: 'platform' as const, schoolId: null, sortOrder: 0, status: 'active' as const, createdBy: 'admin-a' };

describe('Featured posts migration', () => {
  it('creates and reverts the featured table with one post per feature', async () => {
    const source = await new DataSource({ type: 'sqljs', entities: ENTITIES, migrations }).initialize(), runner = source.createQueryRunner();
    try {
      await source.runMigrations();
      const repo = source.getRepository(FeaturedPost);
      expect(await repo.save({ ...fixture })).toMatchObject({ status: 'active', sortOrder: 0 });
      await expect(repo.save({ ...fixture })).rejects.toThrow();
      await repo.save({ ...fixture, postId: 'post-b', sortOrder: 2 });
      const table = await runner.getTable('featured_posts');
      expect(table?.indices).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'IDX_featured_posts_post', columnNames: ['postId'], isUnique: true }),
        expect.objectContaining({ name: 'IDX_featured_posts_scope_status_order', columnNames: ['scope', 'schoolId', 'status', 'sortOrder'] }),
      ]));
      await source.undoLastMigration();
      expect(await runner.hasTable('featured_posts')).toBe(false);
      expect((await source.runMigrations()).map((migration) => migration.name)).toEqual(['FeaturedPosts1793000001000']);
      expect(await repo.count()).toBe(0);
    } finally { await runner.release(); await source.destroy(); }
  });

  it('adopts synchronized schemas without losing existing featured rows', async () => {
    const source = await new DataSource({ type: 'sqljs', entities: ENTITIES, migrations, synchronize: true }).initialize();
    try {
      const saved = await source.getRepository(FeaturedPost).save({ ...fixture });
      expect((await source.runMigrations()).map((migration) => migration.name)).toEqual(migrations.map((migration) => migration.name));
      expect(await source.getRepository(FeaturedPost).findOneByOrFail({ id: saved.id })).toMatchObject({ ...fixture, status: 'active' });
      expect(await source.runMigrations()).toEqual([]);
    } finally { await source.destroy(); }
  });

  it('generates reversible MySQL table/index SQL without connecting to any database', async () => {
    const source = new DataSource({ type: 'mysql', database: 'isolated_featured_sql_only' });
    const runner = source.createQueryRunner();
    let present = false;
    jest.spyOn(runner, 'hasTable').mockImplementation(async () => present);
    jest.spyOn(runner as any, 'loadTables').mockImplementation(async () => runner.loadedTables);
    runner.enableSqlMemory();
    const migration = new FeaturedPosts1793000001000();
    await migration.up(runner);
    const createSql = runner.getMemorySql().upQueries.map((query) => query.query).join('\n');
    expect(createSql).toContain('CREATE TABLE `featured_posts`');
    expect(createSql).toContain('`sortOrder` int NOT NULL DEFAULT 0');
    expect(createSql).toContain('`status` varchar(20) NOT NULL DEFAULT \'active\'');
    expect(createSql).toContain('UNIQUE INDEX `IDX_featured_posts_post` (`postId`)');
    expect(createSql).toContain('INDEX `IDX_featured_posts_scope_status_order` (`scope`, `schoolId`, `status`, `sortOrder`)');
    runner.loadedTables.push(new Table({ name: 'featured_posts', columns: [{ name: 'id', type: 'varchar', isPrimary: true }] }));
    runner.clearSqlMemory(); present = true;
    await migration.down(runner);
    expect(runner.getMemorySql().upQueries.map((query) => query.query)).toContain('DROP TABLE `featured_posts`');
  });

  it('registers the featured migration after all earlier migrations', () => {
    const previous = { NODE_ENV: process.env.NODE_ENV, DB_TYPE: process.env.DB_TYPE };
    try {
      for (const type of ['mysql', 'sqljs']) {
        process.env.NODE_ENV = 'development'; process.env.DB_TYPE = type;
        expect(createDataSourceOptions().migrations).toEqual([...migrations, AnalyticsEvents1793000002000, EventChanges1793000003000, FollowsNotifications1793000004000, PostImages1793000005000]);
      }
    } finally {
      for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
});
