import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { DataSource, EntityManager } from 'typeorm';
import { createToken } from '../src/auth';
import { ApiErrorFilter, ResponseInterceptor } from '../src/common';
import { Post, PostComment, School, SchoolMembership, User } from '../src/entities';

jest.setTimeout(30_000);

describe('Post comments and replies', () => {
  let app: INestApplication, source: DataSource;
  let author: { id: string; token: string }, reader: { id: string; token: string }, outsider: { id: string; token: string }, unverified: { id: string; token: string };
  let schoolId: string, sequence = 0;
  const get = (token: string, postId: string, query = '') => request(app.getHttpServer()).get(`/api/v1/posts/${postId}/comments${query}`).set('Authorization', `Bearer ${token}`);
  const add = (token: string, postId: string, body: unknown) => request(app.getHttpServer()).post(`/api/v1/posts/${postId}/comments`).set('Authorization', `Bearer ${token}`).send(body as any);
  const remove = (token: string, postId: string, commentId: string) => request(app.getHttpServer()).delete(`/api/v1/posts/${postId}/comments/${commentId}`).set('Authorization', `Bearer ${token}`);
  const fixture = (values: Partial<Post> = {}) => source.getRepository(Post).save({
    title: `评论测试 ${++sequence}`, content: '评论及回复隔离测试', authorId: author.id,
    type: 'dynamic', status: 'approved', visibility: 'platform', circle: 'city', city: '北京', schoolId: null, ...values,
  });
  const body = (content: string, parentId?: string) => ({ content, clientRequestId: `comment-key-${++sequence}`, ...(parentId ? { parentId } : {}) });
  const rows = (postId: string) => source.getRepository(PostComment).findBy({ postId });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = 'comments-isolated-test-secret'; process.env.SEED_DEMO_DATA = 'false';
    const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); app.useGlobalInterceptors(new ResponseInterceptor()); app.useGlobalFilters(new ApiErrorFilter());
    await app.init(); source = app.get(DataSource);
    const account = async (name: string) => {
      const user = await source.getRepository(User).save({ wechatOpenId: `comments-${name}`, nickname: `${name}同学`, avatarUrl: `https://example.com/${name}.png` });
      return { id: user.id, token: createToken({ id: user.id, kind: 'user' }) };
    };
    author = await account('作者'); reader = await account('读者'); outsider = await account('外校'); unverified = await account('未认证');
    schoolId = (await source.getRepository(School).save({ name: '评论测试甲校', shortName: 'COMMENTS_A' })).id;
    const otherSchoolId = (await source.getRepository(School).save({ name: '评论测试乙校', shortName: 'COMMENTS_B' })).id;
    await source.getRepository(SchoolMembership).save([{ userId: author.id, schoolId }, { userId: reader.id, schoolId }, { userId: outsider.id, schoolId: otherSchoolId }]);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await app?.close(); });

  it('allows active unverified users on public posts and returns only the public comment contract', async () => {
    const post = await fixture(), payload = body('  第一次文化交流\n很期待  ');
    const created = (await add(unverified.token, post.id, payload).expect(201)).body.data;
    expect(created).toEqual({ id: expect.any(String), postId: post.id, content: '第一次文化交流\n很期待', createdAt: expect.any(String), deleted: false,
      author: { id: unverified.id, nickname: '未认证同学', avatarUrl: 'https://example.com/未认证.png', profileAvailable: true }, isPostAuthor: false, canDelete: true, canReply: true, parent: null });
    const listed = (await get(author.token, post.id).expect(200)).body.data;
    expect(listed).toMatchObject({ page: 1, pageSize: 20, total: 1, activeCount: 1, hasMore: false });
    expect(listed.items).toEqual([{ ...created, canDelete: false }]);
    expect(JSON.stringify(listed)).not.toContain('clientRequest'); expect(JSON.stringify(listed)).not.toContain('submissionHash');
  });

  it('supports author replies and replies between readers with only the parent nickname context', async () => {
    const post = await fixture();
    const first = (await add(reader.token, post.id, body('普通读者的评论')).expect(201)).body.data;
    const authorReply = (await add(author.token, post.id, body('作者回复读者', first.id)).expect(201)).body.data;
    expect(authorReply).toMatchObject({ isPostAuthor: true, canDelete: true, parent: { id: first.id, nickname: '读者同学', deleted: false } });
    const readerReply = (await add(unverified.token, post.id, body('另一个读者回复', first.id)).expect(201)).body.data;
    expect(readerReply.parent).toEqual({ id: first.id, nickname: '读者同学', deleted: false });
    expect(JSON.stringify(readerReply)).not.toContain('普通读者的评论');
    expect((await get(reader.token, post.id).expect(200)).body.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: authorReply.id, canDelete: false })]));
  });

  it('uses stable descending timestamp/id pagination, counts tombstones and isolates other posts', async () => {
    const post = await fixture(), other = await fixture();
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) ids.push((await add(reader.token, post.id, body(`分页 ${index}`)).expect(201)).body.data.id);
    await add(reader.token, other.id, body('另一帖子')).expect(201);
    await source.getRepository(PostComment).update({ postId: post.id }, { createdAt: new Date('2026-10-20T01:00:00Z') });
    await remove(reader.token, post.id, ids[1]).expect(200);
    const expected = ids.slice().sort().reverse();
    const first = (await get(reader.token, post.id, '?page=1&pageSize=2').expect(200)).body.data;
    const second = (await get(reader.token, post.id, '?page=2&pageSize=2').expect(200)).body.data;
    const third = (await get(reader.token, post.id, '?page=3&pageSize=2').expect(200)).body.data;
    expect([...first.items, ...second.items, ...third.items].map((item: any) => item.id)).toEqual(expected);
    expect(first).toMatchObject({ page: 1, pageSize: 2, total: 5, activeCount: 4, hasMore: true });
    expect(third).toMatchObject({ total: 5, activeCount: 4, hasMore: false });
    expect((await get(reader.token, post.id, '?page=4&pageSize=2').expect(200)).body.data.items).toEqual([]);
  });

  it('normalizes content and request identity, retries exactly once and conflicts on content or parent changes', async () => {
    const post = await fixture(), payload = { content: '  你好  ', clientRequestId: '  stable-key  ' };
    const first = (await add(reader.token, post.id, payload).expect(201)).body.data;
    expect((await add(reader.token, post.id, { content: '你好', clientRequestId: 'stable-key' }).expect(201)).body.data).toEqual(first);
    await add(reader.token, post.id, { content: '改内容', clientRequestId: 'stable-key' }).expect(409);
    const parent = (await add(author.token, post.id, body('被回复')).expect(201)).body.data;
    await add(reader.token, post.id, { content: '你好', clientRequestId: 'stable-key', parentId: parent.id }).expect(409);
    await add(author.token, post.id, { content: '你好', clientRequestId: 'stable-key' }).expect(201);
    const other = await fixture(); await add(reader.token, other.id, { content: '你好', clientRequestId: 'stable-key' }).expect(201);
    await add(reader.token, post.id, { content: '大小写分开', clientRequestId: 'STABLE-KEY' }).expect(201);
    expect(await rows(post.id)).toHaveLength(4);
  });

  it('soft-deletes only the owner, clears all old body responses and preserves existing replies', async () => {
    const post = await fixture(), originalPayload = body('删除后不应泄漏的正文');
    const original = (await add(reader.token, post.id, originalPayload).expect(201)).body.data;
    const replyPayload = body('保留的回复', original.id);
    const reply = (await add(author.token, post.id, replyPayload).expect(201)).body.data;
    await remove(author.token, post.id, original.id).expect(403);
    expect((await remove(reader.token, post.id, original.id).expect(200)).body.data).toEqual({ id: original.id, deleted: true });
    await remove(reader.token, post.id, original.id).expect(200);
    const list = (await get(reader.token, post.id).expect(200)).body.data;
    expect(list).toMatchObject({ total: 2, activeCount: 1 });
    expect(list.items.find((item: any) => item.id === original.id)).toMatchObject({ content: '', deleted: true, canDelete: false, canReply: false });
    expect(list.items.find((item: any) => item.id === reply.id)).toMatchObject({ content: replyPayload.content, parent: { id: original.id, nickname: '读者同学', deleted: true } });
    expect(JSON.stringify(list)).not.toContain(originalPayload.content);
    expect((await add(reader.token, post.id, originalPayload).expect(201)).body.data).toMatchObject({ id: original.id, content: '', deleted: true });
    expect((await add(author.token, post.id, replyPayload).expect(201)).body.data).toMatchObject({ id: reply.id, parent: { id: original.id, deleted: true } });
    await add(reader.token, post.id, { ...originalPayload, content: '改变正文' }).expect(409);
    await add(author.token, post.id, body('新的回复', original.id)).expect(409);
    const stored = await source.getRepository(PostComment).findOneByOrFail({ id: original.id });
    expect(stored.content).toBe(''); expect(stored.submissionHash).toHaveLength(64); expect(await rows(post.id)).toHaveLength(2);
  });

  it('never looks up a parent or deletion target from another post, even for the same author', async () => {
    const one = await fixture(), two = await fixture();
    const parent = (await add(reader.token, one.id, body('其他帖正文')).expect(201)).body.data;
    await add(author.token, two.id, body('跨帖回复', parent.id)).expect(404);
    await remove(reader.token, two.id, parent.id).expect(404);
    await add(author.token, two.id, body('不存在的回复', 'missing')).expect(404);
    await remove(reader.token, one.id, 'missing').expect(404);
    expect(await rows(two.id)).toHaveLength(0);
  });

  it('requires login, active users and approved posts for every comment operation, including author previews', async () => {
    const post = await fixture(); const comment = (await add(reader.token, post.id, body('原评论')).expect(201)).body.data;
    await request(app.getHttpServer()).get(`/api/v1/posts/${post.id}/comments`).expect(401);
    await request(app.getHttpServer()).post(`/api/v1/posts/${post.id}/comments`).send(body('登录前')).expect(401);
    await request(app.getHttpServer()).delete(`/api/v1/posts/${post.id}/comments/${comment.id}`).expect(401);
    await source.getRepository(User).update(reader.id, { status: 'disabled' });
    try {
      await get(reader.token, post.id).expect(403); await add(reader.token, post.id, body('停用后')).expect(403); await remove(reader.token, post.id, comment.id).expect(403);
    } finally { await source.getRepository(User).update(reader.id, { status: 'active' }); }
    for (const status of ['draft', 'pending', 'rejected', 'offline'] as const) {
      const hidden = await fixture({ status });
      await get(author.token, hidden.id).expect(404); await add(author.token, hidden.id, body('作者预览不能讨论')).expect(404); await remove(author.token, hidden.id, comment.id).expect(404);
    }
    await get(reader.token, 'missing').expect(404); await add(reader.token, 'missing', body('不存在')).expect(404);
  });

  it('rechecks campus verification and post state before reads, retries and deletes', async () => {
    const post = await fixture({ circle: 'campus', city: null, visibility: 'school', schoolId });
    const payload = body('校园评论'); const comment = (await add(reader.token, post.id, payload).expect(201)).body.data;
    for (const token of [outsider.token, unverified.token]) {
      await get(token, post.id).expect(403); await add(token, post.id, body('越权评论')).expect(403); await remove(token, post.id, comment.id).expect(403);
    }
    await source.getRepository(SchoolMembership).update({ userId: reader.id, schoolId }, { verificationStatus: 'revoked' });
    try {
      await get(reader.token, post.id).expect(403); await add(reader.token, post.id, payload).expect(403); await remove(reader.token, post.id, comment.id).expect(403);
    } finally { await source.getRepository(SchoolMembership).update({ userId: reader.id, schoolId }, { verificationStatus: 'verified' }); }
    await source.getRepository(Post).update(post.id, { status: 'offline' });
    await get(reader.token, post.id).expect(404); await add(reader.token, post.id, payload).expect(404); await remove(reader.token, post.id, comment.id).expect(404);
    expect((await rows(post.id))[0]).toMatchObject({ content: payload.content, deleted: false });
  });

  it('validates input and bounded pagination while preserving literal text', async () => {
    const post = await fixture();
    for (const invalid of [[], {}, { content: ' ', clientRequestId: 'a' }, { content: 1, clientRequestId: 'a' }, { content: 'a'.repeat(501), clientRequestId: 'a' },
      { content: '正文' }, { content: '正文', clientRequestId: '' }, { content: '正文', clientRequestId: 'a'.repeat(81) }, { content: '正文', clientRequestId: 123 },
      { content: '正文\u0000', clientRequestId: 'a' }, { content: '正文', clientRequestId: 'a\u0000' }, { ...body('正文'), parentId: null },
      { ...body('正文'), parentId: '' }, { ...body('正文'), parentId: [] }, { ...body('正文'), parentId: 'a'.repeat(37) }, { ...body('正文'), authorId: author.id }]) await add(reader.token, post.id, invalid).expect(400);
    for (const query of ['?page=0', '?page=-1', '?page=1.1', '?page=10001', '?pageSize=0', '?pageSize=51', '?pageSize=abc', '?page=1&page=2', '?unknown=1']) await get(reader.token, post.id, query).expect(400);
    const text = '<b>literal</b> & 比较 2 < 3';
    expect((await add(reader.token, post.id, body(text)).expect(201)).body.data.content).toBe(text);
    await add(reader.token, post.id, { content: '字'.repeat(500), clientRequestId: 'k'.repeat(80) }).expect(201);
    expect(await rows(post.id)).toHaveLength(2);
  });

  it('serializes concurrent identical writes and conflicting retries without duplicates', async () => {
    const post = await fixture(), payload = body('并发同评论');
    const same = await Promise.all(Array.from({ length: 6 }, () => add(reader.token, post.id, payload)));
    expect(same.map(result => result.status)).toEqual([201, 201, 201, 201, 201, 201]);
    expect(new Set(same.map(result => result.body.data.id)).size).toBe(1);
    const conflictPayload = body('另一组并发');
    const conflicting = await Promise.all([add(reader.token, post.id, conflictPayload), add(reader.token, post.id, { ...conflictPayload, content: '内容不同' })]);
    expect(conflicting.map(result => result.status).sort()).toEqual([201, 409]);
    expect(await rows(post.id)).toHaveLength(2);
  });

  it('serializes delete/reply races and retains any reply committed before the deletion', async () => {
    const post = await fixture();
    for (let index = 0; index < 5; index += 1) {
      const parent = (await add(reader.token, post.id, body(`父 ${index}`)).expect(201)).body.data;
      const replyPayload = body(`回复 ${index}`, parent.id);
      const operations = [remove(reader.token, post.id, parent.id), add(author.token, post.id, replyPayload)];
      const [deleted, replied] = await Promise.all(index % 2 ? operations.reverse() : operations);
      expect([deleted.status, replied.status].every(status => [200, 201, 409].includes(status))).toBe(true);
      const current = await source.getRepository(PostComment).findOneByOrFail({ id: parent.id });
      expect(current).toMatchObject({ content: '', deleted: true });
      await add(author.token, post.id, body('删除后新增必失败', parent.id)).expect(409);
      const existingReply = (await rows(post.id)).find(item => item.parentId === parent.id);
      if (existingReply) expect((await add(author.token, post.id, replyPayload).expect(201)).body.data).toMatchObject({ id: existingReply.id, parent: { deleted: true } });
    }
  });

  it('rolls back a failed insert and allows an unchanged retry', async () => {
    const post = await fixture(), payload = body('事务失败后重试');
    const originalSave = EntityManager.prototype.save;
    jest.spyOn(Logger, 'error').mockImplementation(() => undefined);
    const failure = jest.spyOn(EntityManager.prototype, 'save').mockImplementation((async function (this: EntityManager, target: unknown, ...args: unknown[]) {
      if (target === PostComment) throw new Error('isolated comment save failure');
      return (originalSave as any).call(this, target, ...args);
    }) as any);
    await add(reader.token, post.id, payload).expect(500);
    expect(await rows(post.id)).toHaveLength(0);
    failure.mockRestore(); await add(reader.token, post.id, payload).expect(201);
    expect(await rows(post.id)).toHaveLength(1);
  });
});

