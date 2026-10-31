import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { DataSource } from 'typeorm';
import { createToken } from '../src/auth';
import { ApiErrorFilter, ResponseInterceptor } from '../src/common';
import { Post, PostComment, School, SchoolMembership, User } from '../src/entities';

jest.setTimeout(30_000);

describe('Public user search and author profiles', () => {
  let app: INestApplication, source: DataSource;
  let guest: User, readerA: User, readerB: User, author: User, empty: User, schoolOnly: User;
  let schoolA: string, schoolB: string, sequence = 0;
  const publicIds: string[] = [], campusIds: string[] = [];
  const token = (user: User, schoolId?: string) => createToken({ id: user.id, kind: 'user', schoolId });
  const get = (user: User, path: string, query: Record<string, unknown> = {}) => request(app.getHttpServer())
    .get(`/api/v1/${path}`).set('Authorization', `Bearer ${token(user, schoolA)}`).query(query);
  const search = (user: User, q: string, extra: Record<string, unknown> = {}) => get(user, 'users', { q, ...extra });
  const post = (authorId: string, overrides: Partial<Post> = {}) => source.getRepository(Post).save({
    id: `profile-post-${String(++sequence).padStart(4, '0')}`, authorId, title: '作者主页测试', content: '公开内容及学校隔离',
    type: 'dynamic', status: 'approved', visibility: 'platform', schoolId: null, circle: 'city', city: '北京',
    createdAt: new Date('2026-10-20T10:00:00Z'), ...overrides,
  });
  const account = (id: string, nickname: string, status: User['status'] = 'active') => source.getRepository(User).save({
    id, nickname, wechatOpenId: `private-openid-${id}`, avatarUrl: `https://example.com/${id}.png`, status,
  });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = 'user-profile-isolated-test-secret'; process.env.SEED_DEMO_DATA = 'false';
    const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); app.useGlobalInterceptors(new ResponseInterceptor()); app.useGlobalFilters(new ApiErrorFilter());
    await app.init(); source = app.get(DataSource);
    guest = await account('profile-guest', '访客'); readerA = await account('profile-reader-a', '甲校读者'); readerB = await account('profile-reader-b', '乙校读者');
    author = await account('profile-author', 'AuthorAlpha'); empty = await account('profile-empty', 'EmptyAuthor'); schoolOnly = await account('profile-school-only', 'SchoolOnly');
    schoolA = (await source.getRepository(School).save({ name: '作者主页甲校', shortName: 'PROFILE_A' })).id;
    schoolB = (await source.getRepository(School).save({ name: '作者主页乙校', shortName: 'PROFILE_B' })).id;
    await source.getRepository(SchoolMembership).save([{ userId: readerA.id, schoolId: schoolA }, { userId: readerB.id, schoolId: schoolB }, { userId: author.id, schoolId: schoolA }]);
    for (const circle of [null, 'city', 'international'] as const) publicIds.push((await post(author.id, { circle })).id);
    for (const schoolId of [schoolA, schoolB]) campusIds.push((await post(author.id, { circle: 'campus', visibility: 'school', schoolId })).id);
    for (const status of ['draft', 'pending', 'rejected', 'offline'] as const) await post(author.id, { status });
    // Deliberately malformed legacy combinations must be excluded exactly as in the discovery feed.
    for (const values of [
      { schoolId: schoolA }, { circle: 'campus' as const }, { circle: null, visibility: 'school' as const, schoolId: schoolA },
      { circle: 'city' as const, visibility: 'school' as const, schoolId: schoolA },
      { circle: 'campus' as const, visibility: 'school' as const, schoolId: null },
    ]) await post(author.id, values);
    await post(schoolOnly.id, { circle: 'campus', visibility: 'school', schoolId: schoolA });
    await post(empty.id, { status: 'pending' });
    for (const status of ['disabled', 'deleted'] as const) {
      const user = await account(`profile-${status}`, `Unavailable${status}`, status); await post(user.id);
    }
    await post('legacy-admin');
  });
  afterAll(async () => { await app?.close(); });

  it.each(['guest', 'schoolA', 'schoolB', 'own'] as const)('uses the exact discovery visibility predicate for %s', async (viewer) => {
    const user = viewer === 'guest' ? guest : viewer === 'schoolA' ? readerA : viewer === 'schoolB' ? readerB : author;
    const expected = [...publicIds, ...(viewer === 'guest' ? [] : [campusIds[viewer === 'schoolB' ? 1 : 0]])].sort().reverse();
    const profile = (await get(user, `users/${author.id}`).expect(200)).body.data;
    expect(profile).toEqual({ id: author.id, nickname: author.nickname, avatarUrl: author.avatarUrl, visiblePostCount: expected.length, following: false });
    const searchProfile = { id: profile.id, nickname: profile.nickname, avatarUrl: profile.avatarUrl, visiblePostCount: profile.visiblePostCount };
    const page = (await get(user, `users/${author.id}/posts`).expect(200)).body.data;
    expect(page).toMatchObject({ page: 1, pageSize: 20, total: expected.length, hasMore: false });
    expect(page.items.map((item: Post) => item.id)).toEqual(expected);
    expect(page.items.every((item: Post) => item.status === 'approved')).toBe(true);
    const feed = (await get(user, 'posts', { page: '1', pageSize: '100' }).expect(200)).body.data;
    expect(feed.items.filter((item: Post) => item.authorId === author.id).map((item: Post) => item.id)).toEqual(expected);
    const users = (await search(user, '  authorALPHA  ').expect(200)).body.data;
    expect(users).toEqual({ items: [searchProfile], page: 1, pageSize: 20, total: 1, hasMore: false });
  });

  it('returns an active zero-visible-post profile without making it searchable', async () => {
    for (const target of [empty, schoolOnly]) {
      const profile = (await get(guest, `users/${target.id}`).expect(200)).body.data;
      expect(profile.visiblePostCount).toBe(0);
      expect((await get(guest, `users/${target.id}/posts`).expect(200)).body.data).toEqual({ items: [], page: 1, pageSize: 20, total: 0, hasMore: false });
      expect((await search(guest, target.nickname).expect(200)).body.data.total).toBe(0);
    }
    expect((await search(readerA, schoolOnly.nickname).expect(200)).body.data.items).toEqual([
      { id: schoolOnly.id, nickname: schoolOnly.nickname, avatarUrl: schoolOnly.avatarUrl, visiblePostCount: 1 },
    ]);
  });

  it('checks current membership in the database even when a token still claims the old school', async () => {
    await source.getRepository(SchoolMembership).update({ userId: readerA.id }, { verificationStatus: 'revoked' });
    try {
      expect((await get(readerA, `users/${author.id}`).expect(200)).body.data.visiblePostCount).toBe(3);
      expect((await get(readerA, `users/${author.id}/posts`).expect(200)).body.data.total).toBe(3);
      expect((await search(readerA, schoolOnly.nickname).expect(200)).body.data.total).toBe(0);
    } finally { await source.getRepository(SchoolMembership).update({ userId: readerA.id }, { verificationStatus: 'verified' }); }
  });

  it('never exposes disabled, deleted, missing or legacy administrator targets', async () => {
    expect((await search(guest, 'Unavailable').expect(200)).body.data.total).toBe(0);
    for (const id of ['profile-disabled', 'profile-deleted', 'missing-user', 'legacy-admin', 'x'.repeat(80)]) {
      await get(guest, `users/${id}`).expect(404); await get(guest, `users/${id}/posts`).expect(404);
    }
  });

  it('uses only public metadata and the displayed fallback nickname', async () => {
    const fallback = await account('profile-fallback', ''); await post(fallback.id);
    const profile = (await get(guest, `users/${fallback.id}`).expect(200)).body.data;
    expect(profile).toEqual({ id: fallback.id, nickname: 'Weculture 用户', avatarUrl: fallback.avatarUrl, visiblePostCount: 1, following: false });
    const result = (await search(guest, 'weculture 用户').expect(200)).body.data;
    expect(result.items).toContainEqual({ id: profile.id, nickname: profile.nickname, avatarUrl: profile.avatarUrl, visiblePostCount: profile.visiblePostCount });
    for (const value of result.items) {
      expect(Object.keys(value).sort()).toEqual(['avatarUrl', 'id', 'nickname', 'visiblePostCount']);
    }
    expect(Object.keys((await get(readerA, `users/${author.id}`).expect(200)).body.data).sort()).toEqual(['avatarUrl', 'following', 'id', 'nickname', 'visiblePostCount']);
    expect(JSON.stringify(result)).not.toMatch(/wechatOpenId|private-openid|schoolId|membership|status|createdAt/);
  });

  it.each(['%', '_', '!', '!%_', "' OR 1=1 --"])('treats %s as a literal nickname substring', async (literal) => {
    const user = await account(`profile-literal-${++sequence}`, `Literal${literal}Tail`); await post(user.id);
    const result = (await search(guest, literal).expect(200)).body.data;
    expect(result.items.map((item: User) => item.id)).toContain(user.id);
    expect(result.items.every((item: User) => item.nickname.includes(literal))).toBe(true);
  });

  it('paginates distinct authors in stable nickname/id order with correct counts', async () => {
    const authors = [];
    for (const id of ['profile-page-c', 'profile-page-a', 'profile-page-b']) {
      const user = await account(id, 'PageAuthor'); authors.push(user);
      await post(user.id); await post(user.id); await post(user.id, { status: 'pending' });
    }
    const gathered = [];
    for (let page = 1; page <= 3; page++) {
      const result = (await search(guest, 'PageAuthor', { page: String(page), pageSize: '1' }).expect(200)).body.data;
      expect(result).toMatchObject({ page, pageSize: 1, total: 3, hasMore: page < 3 });
      expect(result.items[0].visiblePostCount).toBe(2); gathered.push(result.items[0].id);
    }
    expect(gathered).toEqual(authors.map((user) => user.id).sort());
    expect((await search(guest, 'PageAuthor', { page: '100000', pageSize: '100' }).expect(200)).body.data).toMatchObject({ items: [], total: 3, hasMore: false });
    const pages = [];
    for (let page = 1; page <= 2; page++) pages.push((await get(guest, `users/${author.id}/posts`, { page: String(page), pageSize: '2' }).expect(200)).body.data);
    expect(pages[0]).toMatchObject({ total: 3, hasMore: true }); expect(pages[1]).toMatchObject({ total: 3, hasMore: false });
    expect(pages.flatMap((value) => value.items).map((value) => value.id)).toEqual(publicIds.slice().sort().reverse());
    const newest = await post(author.id, { createdAt: new Date('2026-10-21T10:00:00Z') });
    try { expect((await get(guest, `users/${author.id}/posts`, { pageSize: '1' }).expect(200)).body.data.items[0].id).toBe(newest.id); }
    finally { await source.getRepository(Post).delete(newest.id); }
  });

  it('marks real active post and comment authors as profileAvailable and all other authors unavailable', async () => {
    const feed = (await get(guest, 'posts', { pageSize: '100' }).expect(200)).body.data.items;
    expect(feed.find((item: Post) => item.authorId === author.id).author.profileAvailable).toBe(true);
    for (const id of ['profile-disabled', 'profile-deleted', 'legacy-admin']) expect(feed.find((item: Post) => item.authorId === id).author.profileAvailable).toBe(false);
    for (const id of [author.id, 'profile-disabled', 'profile-deleted', 'legacy-admin']) await source.getRepository(PostComment).save({
      postId: publicIds[0], authorId: id, content: '作者标识', clientRequestId: id, clientRequestHash: id, submissionHash: id,
    });
    const comments = (await get(guest, `posts/${publicIds[0]}/comments`).expect(200)).body.data.items;
    for (const comment of comments) expect(comment.author.profileAvailable).toBe(comment.author.id === author.id);
    const ownPage = (await get(guest, `users/${author.id}/posts`).expect(200)).body.data;
    expect(ownPage.items[0].author).toMatchObject({ id: author.id, profileAvailable: true });
    expect(JSON.stringify(ownPage)).not.toMatch(/clientRequestId|submissionHash|wechatOpenId/);
  });

  it('rejects empty directories, malformed search, unknown keys and invalid pagination', async () => {
    for (const query of [{}, { q: '' }, { q: '  ' }, { q: 'a'.repeat(101) }, { q: ['a', 'b'] }, { q: 'Author', schoolId: schoolA }, { q: 'Author', scope: 'platform' }, { q: 'Author', status: 'active' }]) await get(guest, 'users', query).expect(400);
    for (const query of [{ page: '0' }, { page: '-1' }, { page: '1.5' }, { page: '01' }, { page: '100001' }, { pageSize: '0' }, { pageSize: '101' }, { page: ['1', '2'] }, { page: '' }, { pageSize: ' 2 ' }]) {
      await search(guest, 'Author', query).expect(400); await get(guest, `users/${author.id}/posts`, query).expect(400);
    }
    for (const key of ['q', 'scope', 'circle', 'status', 'schoolId', 'authorId']) await get(guest, `users/${author.id}/posts`, { [key]: 'x' }).expect(400);
    await get(guest, `users/${author.id}`, { page: '1' }).expect(400);
    for (const id of ['bad.id', 'space id', 'x'.repeat(81), '中文']) {
      await get(guest, `users/${encodeURIComponent(id)}`).expect(400); await get(guest, `users/${encodeURIComponent(id)}/posts`).expect(400);
    }
    await search(guest, `  ${'a'.repeat(100)}  `).expect(200);
  });

  it('requires an authenticated active current viewer on all three endpoints', async () => {
    for (const path of ['users?q=Author', `users/${author.id}`, `users/${author.id}/posts`]) {
      await request(app.getHttpServer()).get(`/api/v1/${path}`).expect(401);
      for (const value of ['bad-token', createToken({ id: guest.id, kind: 'admin' })]) await request(app.getHttpServer()).get(`/api/v1/${path}`).set('Authorization', `Bearer ${value}`).expect(401);
      for (const id of ['profile-disabled', 'profile-deleted', 'missing-viewer', undefined]) {
        const value = createToken({ id: id as string, kind: 'user' });
        await request(app.getHttpServer()).get(`/api/v1/${path}`).set('Authorization', `Bearer ${value}`).expect(403);
      }
    }
  });
});
