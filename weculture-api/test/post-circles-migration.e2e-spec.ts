import { DataSource, Table } from 'typeorm';
import { PostCircles1791417600000 } from '../src/migrations/1791417600000-PostCircles';
import { InitialSchema1789560000000 } from '../src/migrations/1789560000000-InitialSchema';
import { PostSubmissionIdentity1790899200000 } from '../src/migrations/1790899200000-PostSubmissionIdentity';
import { ENTITIES, Post } from '../src/entities';

describe('Circle migration', () => {
  it('preserves real moderation data, classifies school visibility only and leaves ambiguous demos unclassified', async () => {
    const source = await new DataSource({ type: 'sqljs' }).initialize();
    const runner = source.createQueryRunner();
    try {
      await runner.createTable(new Table({ name: 'posts', columns: [
        { name: 'id', type: 'varchar', isPrimary: true }, { name: 'authorId', type: 'varchar' },
        { name: 'title', type: 'varchar' }, { name: 'visibility', type: 'varchar' },
        { name: 'schoolId', type: 'varchar', isNullable: true }, { name: 'status', type: 'varchar' },
        { name: 'rejectionReason', type: 'varchar' }, { name: 'createdAt', type: 'datetime' },
        { name: 'clientRequestId', type: 'varchar', isNullable: true }, { name: 'submissionHash', type: 'varchar', isNullable: true },
      ] }));
      const values = [
        ['pending-real', 'student', '真实校园待审投稿', 'school', 'school-a', 'pending', '', '2026-10-08 00:00:00', 'existing-request', 'original-hash'],
        ['rejected-real', 'student', '真实校园已驳回投稿', 'school', 'school-b', 'rejected', '请补充具体地点', '2026-10-08 00:00:00', null, null],
        ['demo-platform', 'admin', '剪纸艺术进校园，这就是指尖上的中国魅力！', 'platform', null, 'approved', '', '2026-10-08 00:00:00', null, null],
        ['same-title-user', 'student', '剪纸艺术进校园，这就是指尖上的中国魅力！', 'platform', null, 'pending', '', '2026-10-08 00:00:00', null, null],
        ['unknown', 'admin', '旧平台精选', 'platform', null, 'approved', '', '2026-10-08 00:00:00', null, null],
      ];
      for (const row of values) await runner.query('INSERT INTO posts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', row);
      const before = await runner.query('SELECT * FROM posts ORDER BY id');
      const migration = new PostCircles1791417600000();
      await migration.up(runner);
      const rows = await runner.query('SELECT * FROM posts ORDER BY id');
      expect(rows).toEqual(before.map((row: { visibility: string }) => ({ ...row, circle: row.visibility === 'school' ? 'campus' : null, city: null, contentLanguage: null })));
      expect((await runner.getTable('posts'))?.indices.map((index) => index.name)).toEqual(expect.arrayContaining(['IDX_posts_circle_status_city_createdAt', 'IDX_posts_circle_schoolId_status_createdAt']));
      await migration.down(runner);
      expect(await runner.query('SELECT * FROM posts ORDER BY id')).toEqual(before);
    } finally { await runner.release(); await source.destroy(); }
  });

  it('adopts an existing synchronized local schema without duplicate columns and preserves existing explicit classification', async () => {
    const source = await new DataSource({ type: 'sqljs', entities: ENTITIES, synchronize: true, migrations: [InitialSchema1789560000000, PostSubmissionIdentity1790899200000, PostCircles1791417600000] }).initialize();
    try {
      const posts = source.getRepository(Post);
      const school = await posts.save({ authorId: 'student', type: 'dynamic', visibility: 'school', schoolId: 'school-a', circle: null, title: '同步旧校园投稿', content: '原先同步仅添加了空圈层字段。', status: 'pending', clientRequestId: 'preserve-local-key', submissionHash: 'preserve-local-hash' });
      const classified = await posts.save({ authorId: 'student', type: 'dynamic', visibility: 'platform', circle: 'city', city: '上海', schoolId: null, title: '已分类同城内容', content: '明确分类和城市不得被迁移覆盖。', status: 'approved' });
      const migrations = await source.runMigrations();
      expect(migrations.map((migration) => migration.name)).toEqual(['InitialSchema1789560000000', 'PostSubmissionIdentity1790899200000', 'PostCircles1791417600000']);
      expect(await posts.findOneByOrFail({ id: school.id })).toMatchObject({ circle: 'campus', schoolId: 'school-a', status: 'pending', clientRequestId: 'preserve-local-key', submissionHash: 'preserve-local-hash' });
      expect(await posts.findOneByOrFail({ id: classified.id })).toMatchObject({ circle: 'city', city: '上海', schoolId: null, status: 'approved' });
      expect(await source.runMigrations()).toEqual([]);
    } finally { await source.destroy(); }
  });
});
