import { DataSource, Table } from 'typeorm';
import { PostSubmissionIdentity1790899200000 } from '../src/migrations/1790899200000-PostSubmissionIdentity';

describe('Post submission migration', () => {
  it('preserves legacy posts, allows null keys and enforces per-author request identity', async () => {
    const source = await new DataSource({ type: 'sqljs' }).initialize();
    const runner = source.createQueryRunner();
    try {
      await runner.createTable(new Table({ name: 'posts', columns: [
        { name: 'id', type: 'varchar', isPrimary: true },
        { name: 'authorId', type: 'varchar' },
        { name: 'title', type: 'varchar' },
      ] }));
      await runner.query('INSERT INTO posts (id, authorId, title) VALUES (?, ?, ?)', ['legacy-1', 'author', '旧投稿一']);
      await runner.query('INSERT INTO posts (id, authorId, title) VALUES (?, ?, ?)', ['legacy-2', 'author', '旧投稿二']);
      const migration = new PostSubmissionIdentity1790899200000();
      await migration.up(runner);
      const legacy = await runner.query('SELECT * FROM posts ORDER BY id');
      expect(legacy).toEqual([
        { id: 'legacy-1', authorId: 'author', title: '旧投稿一', clientRequestId: null, submissionHash: null },
        { id: 'legacy-2', authorId: 'author', title: '旧投稿二', clientRequestId: null, submissionHash: null },
      ]);
      await runner.query('INSERT INTO posts (id, authorId, title, clientRequestId) VALUES (?, ?, ?, ?)', ['new-1', 'author', '新投稿', 'same-key']);
      await expect(runner.query('INSERT INTO posts (id, authorId, title, clientRequestId) VALUES (?, ?, ?, ?)', ['new-2', 'author', '重复投稿', 'same-key'])).rejects.toThrow();
      await runner.query('INSERT INTO posts (id, authorId, title, clientRequestId) VALUES (?, ?, ?, ?)', ['new-3', 'other-author', '其他作者投稿', 'same-key']);
      await migration.down(runner);
      expect(await runner.query('SELECT * FROM posts ORDER BY id')).toHaveLength(4);
      expect((await runner.getTable('posts'))?.columns.map((column) => column.name)).toEqual(['id', 'authorId', 'title']);
    } finally { await runner.release(); await source.destroy(); }
  });
});
