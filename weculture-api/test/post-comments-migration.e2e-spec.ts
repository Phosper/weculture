import { DataSource, Table } from 'typeorm';
import { createDataSourceOptions } from '../src/database';
import { ENTITIES, Post, PostComment, UserPlan } from '../src/entities';
import { InitialSchema1789560000000 } from '../src/migrations/1789560000000-InitialSchema';
import { PostSubmissionIdentity1790899200000 } from '../src/migrations/1790899200000-PostSubmissionIdentity';
import { PostCircles1791417600000 } from '../src/migrations/1791417600000-PostCircles';
import { RoutePlanDetails1792454400000 } from '../src/migrations/1792454400000-RoutePlanDetails';
import { PostComments1792458000000 } from '../src/migrations/1792458000000-PostComments';

const migrations = [InitialSchema1789560000000, PostSubmissionIdentity1790899200000, PostCircles1791417600000, RoutePlanDetails1792454400000, PostComments1792458000000];
const fixture = { postId: 'post-a', authorId: 'user-a', content: '迁移前已有评论', parentId: null, clientRequestId: 'request-a', clientRequestHash: 'a'.repeat(64), submissionHash: 'b'.repeat(64) };

describe('Post comments migration', () => {
  it('creates and reverts SQLite comments without altering existing posts, and enforces per-user/post request uniqueness', async () => {
    const source = await new DataSource({ type: 'sqljs', entities: ENTITIES, migrations }).initialize(), runner = source.createQueryRunner();
    try {
      await source.runMigrations();
      const post = await source.getRepository(Post).save({ id: 'post-a', authorId: 'user-a', type: 'dynamic', visibility: 'platform', title: '原帖子', content: '原内容' });
      const before = await source.getRepository(Post).findOneByOrFail({ id: post.id });
      const first = await source.getRepository(PostComment).save({ ...fixture });
      await expect(source.getRepository(PostComment).save({ ...fixture })).rejects.toThrow();
      await source.getRepository(PostComment).save({ ...fixture, authorId: 'user-b' });
      await source.getRepository(PostComment).save({ ...fixture, postId: 'post-b' });
      await source.getRepository(PostComment).save({ ...fixture, clientRequestHash: 'c'.repeat(64) });
      const table = await runner.getTable('post_comments');
      expect(table?.indices).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'IDX_post_comments_request', columnNames: ['authorId', 'postId', 'clientRequestHash'], isUnique: true }),
        expect.objectContaining({ name: 'IDX_post_comments_post_created', columnNames: ['postId', 'createdAt', 'id'] }),
      ]));
      expect(first).toMatchObject({ parentId: null, deleted: false });
      await source.undoLastMigration();
      expect(await runner.hasTable('post_comments')).toBe(false);
      expect(await source.getRepository(Post).findOneByOrFail({ id: post.id })).toEqual(before);
      await new PostComments1792458000000().down(runner);
      expect((await source.runMigrations()).map(migration => migration.name)).toEqual(['PostComments1792458000000']);
      expect(await source.getRepository(PostComment).count()).toBe(0);
    } finally { await runner.release(); await source.destroy(); }
  });

  it('adopts synchronized schemas without data loss and supports repeat execution in the complete registered chain', async () => {
    const source = await new DataSource({ type: 'sqljs', entities: ENTITIES, migrations, synchronize: true }).initialize();
    try {
      const comment = await source.getRepository(PostComment).save({ ...fixture });
      const plan = await source.getRepository(UserPlan).save({ userId: 'user-a', targetType: 'route', targetId: 'route-a', departDate: '2028-02-29', companions: 0 });
      expect((await source.runMigrations()).map(migration => migration.name)).toEqual(migrations.map(migration => migration.name));
      expect(await source.getRepository(PostComment).findOneByOrFail({ id: comment.id })).toMatchObject({ ...fixture, deleted: false });
      expect(await source.getRepository(UserPlan).findOneByOrFail({ id: plan.id })).toMatchObject({ departDate: '2028-02-29', companions: 0 });
      expect(await source.runMigrations()).toEqual([]);
      await new PostComments1792458000000().up(source.createQueryRunner());
      expect(await source.getRepository(PostComment).count()).toBe(1);
    } finally { await source.destroy(); }
  });

  it('generates reversible MySQL table/index SQL without connecting to any database', async () => {
    const source = new DataSource({ type: 'mysql', database: 'isolated_comment_migration_sql_only' });
    const runner = source.createQueryRunner();
    let present = false;
    jest.spyOn(runner, 'hasTable').mockImplementation(async () => present);
    jest.spyOn(runner as any, 'loadTables').mockImplementation(async () => runner.loadedTables);
    runner.enableSqlMemory();
    const migration = new PostComments1792458000000();
    await migration.up(runner);
    const createSql = runner.getMemorySql().upQueries.map(query => query.query).join('\n');
    expect(createSql).toContain('CREATE TABLE `post_comments`');
    expect(createSql).toContain('`createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP');
    expect(createSql).toContain('`updatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
    expect(createSql).toContain('`deleted` boolean NOT NULL DEFAULT 0');
    expect(createSql).toContain('UNIQUE INDEX `IDX_post_comments_request` (`authorId`, `postId`, `clientRequestHash`)');
    expect(createSql).toContain('INDEX `IDX_post_comments_post_created` (`postId`, `createdAt`, `id`)');
    runner.loadedTables.push(new Table({ name: 'post_comments', columns: [{ name: 'id', type: 'varchar', isPrimary: true }] }));
    runner.clearSqlMemory(); present = true;
    await migration.down(runner);
    expect(runner.getMemorySql().upQueries.map(query => query.query)).toContain('DROP TABLE `post_comments`');
  });

  it('registers the comments migration after all earlier migrations for MySQL and SQLite', () => {
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

