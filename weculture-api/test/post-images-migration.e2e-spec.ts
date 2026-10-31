import { DataSource, Table } from 'typeorm';
import { createDataSourceOptions } from '../src/database';
import { ENTITIES, Post } from '../src/entities';
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

const migrations = [InitialSchema1789560000000, PostSubmissionIdentity1790899200000, PostCircles1791417600000, RoutePlanDetails1792454400000, PostComments1792458000000, ContentReports1793000000000, FeaturedPosts1793000001000, AnalyticsEvents1793000002000, EventChanges1793000003000, FollowsNotifications1793000004000, PostImages1793000005000];

describe('Post images migration', () => {
  it('adds and reverts nullable image data while preserving existing posts', async () => {
    const source = await new DataSource({ type: 'sqljs', entities: ENTITIES, migrations }).initialize(), runner = source.createQueryRunner();
    try {
      await source.runMigrations();
      const repo = source.getRepository(Post);
      const saved = await repo.save({ authorId: 'author-a', type: 'dynamic', status: 'approved', visibility: 'platform', circle: 'city', city: '北京', title: '旧单图', content: '旧正文', imageUrl: 'cloud://old.jpg' });
      expect(await repo.findOneByOrFail({ id: saved.id })).toMatchObject({ imageUrls: null, coverIndex: 0, imageUrl: 'cloud://old.jpg' });
      await repo.update(saved.id, { imageUrls: JSON.stringify(['cloud://a.jpg', 'cloud://b.jpg']), coverIndex: 1 });
      const table = await runner.getTable('posts');
      expect(table?.findColumnByName('imageUrls')).toBeTruthy();
      expect(table?.findColumnByName('coverIndex')).toBeTruthy();
      await source.undoLastMigration();
      expect(await repo.count()).toBe(1);
      const rows = await runner.query('SELECT title, imageUrl FROM posts');
      expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ title: '旧单图', imageUrl: 'cloud://old.jpg' })]));
      expect((await source.runMigrations()).map((migration) => migration.name)).toEqual(['PostImages1793000005000']);
      expect(await repo.findOneByOrFail({ id: saved.id })).toMatchObject({ title: '旧单图', imageUrl: 'cloud://old.jpg' });
    } finally { await runner.release(); await source.destroy(); }
  });

  it('adopts synchronized schemas without losing multi-image rows', async () => {
    const source = await new DataSource({ type: 'sqljs', entities: ENTITIES, migrations, synchronize: true }).initialize();
    try {
      const saved = await source.getRepository(Post).save({ authorId: 'author-a', type: 'dynamic', status: 'approved', visibility: 'platform', circle: 'city', city: '北京', title: '同步多图', content: '同步正文', imageUrls: JSON.stringify(['cloud://a.jpg']), coverIndex: 0 });
      expect((await source.runMigrations()).map((migration) => migration.name)).toEqual(migrations.map((migration) => migration.name));
      expect(await source.getRepository(Post).findOneByOrFail({ id: saved.id })).toMatchObject({ imageUrls: JSON.stringify(['cloud://a.jpg']), coverIndex: 0 });
      expect(await source.runMigrations()).toEqual([]);
    } finally { await source.destroy(); }
  });

  it('generates reversible MySQL column SQL without connecting to any database', async () => {
    const source = new DataSource({ type: 'mysql', database: 'isolated_post_images_sql_only' });
    const runner = source.createQueryRunner();
    let present = true;
    jest.spyOn(runner, 'hasTable').mockImplementation(async () => present);
    jest.spyOn(runner as any, 'loadTables').mockImplementation(async () => runner.loadedTables);
    runner.enableSqlMemory();
    runner.loadedTables.push(new Table({ name: 'posts', columns: [{ name: 'id', type: 'varchar', isPrimary: true }] }));
    const migration = new PostImages1793000005000();
    await migration.up(runner);
    const upSql = runner.getMemorySql().upQueries.map((query) => query.query).join('\n');
    expect(upSql).toContain('ALTER TABLE `posts` ADD `imageUrls` text NULL');
    expect(upSql).toContain('ALTER TABLE `posts` ADD `coverIndex` int NOT NULL DEFAULT 0');
    runner.clearSqlMemory(); present = true;
    await migration.down(runner);
    const downSql = runner.getMemorySql().upQueries.map((query) => query.query).join('\n');
    expect(downSql).toContain('ALTER TABLE `posts` DROP COLUMN `imageUrls`');
    expect(downSql).toContain('ALTER TABLE `posts` DROP COLUMN `coverIndex`');
  });

  it('registers the post images migration after all earlier migrations', () => {
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
