import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { DataSource } from 'typeorm';
import { ApiErrorFilter, ResponseInterceptor } from '../src/common';
import { Event, Post, School, SchoolMembership, User } from '../src/entities';

jest.setTimeout(30_000);

describe('Discovery search, pagination and visibility', () => {
  let app: INestApplication;
  let source: DataSource;
  let guestToken: string, schoolToken: string, otherSchoolToken: string;
  let guestId: string, schoolUserId: string, schoolId: string, otherSchoolId: string;
  const postId = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
  const timestamp = '2026-01-01T12:00:00.000Z';
  const feed = (token: string, query: Record<string, string | number> = {}) => request(app.getHttpServer())
    .get('/api/v1/posts').set('Authorization', `Bearer ${token}`).query(query);
  const ids = (data: { id: string }[]) => data.map((post) => post.id);

  const savePost = async (id: number, overrides: Partial<Post> = {}) => {
    const post = await source.getRepository(Post).save({
      id: postId(id), authorId: guestId, schoolId: null, circle: 'city' as const, city: '北京',
      contentLanguage: null, visibility: 'platform' as const, status: 'approved' as const,
      type: 'dynamic' as const, title: `普通内容 ${id}`, content: '普通正文', tag: '',
      createdAt: new Date(timestamp), ...overrides,
    });
    if (post.type === 'event') await source.getRepository(Event).save({
      postId: post.id, startsAt: new Date('2027-01-02T12:00:00Z'), endsAt: new Date('2027-01-02T14:00:00Z'),
      registrationDeadline: new Date('2027-01-01T12:00:00Z'), location: '测试活动室', capacity: 20,
    });
    return post;
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'discovery-search-isolated-test-secret';
    process.env.SEED_DEMO_DATA = 'false';
    const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new ApiErrorFilter());
    await app.init();
    source = app.get(DataSource);
    expect(source.options.type).toBe('sqljs');

    const login = async (name: string) => (await request(app.getHttpServer())
      .post('/api/v1/auth/wechat/login').send({ code: `dev-discovery-${name}` }).expect(201)).body.data;
    const guest = await login('guest'), sameSchool = await login('school-a'), otherSchool = await login('school-b');
    guestToken = guest.token; schoolToken = sameSchool.token; otherSchoolToken = otherSchool.token;
    guestId = guest.user.id; schoolUserId = sameSchool.user.id;
    const schools = await source.getRepository(School).save([
      { name: '搜索测试甲校', shortName: 'SEARCH_A' }, { name: '搜索测试乙校', shortName: 'SEARCH_B' },
    ]);
    schoolId = schools[0].id; otherSchoolId = schools[1].id;
    await source.getRepository(SchoolMembership).save([
      { userId: sameSchool.user.id, schoolId }, { userId: otherSchool.user.id, schoolId: otherSchoolId },
    ]);

    const author = await source.getRepository(User).save({ wechatOpenId: 'discovery-fixture-author', nickname: '真实作者Alpha' });
    await savePost(1, { title: 'TitleNeedle 标题命中' });
    await savePost(2, { content: '正文中的 BodyNeedle 信息' });
    await savePost(3, { tag: 'TagNeedle 文化' });
    await savePost(4, { authorId: author.id });

    // Newer unrelated content must not hide search results that are beyond the initial feed page.
    for (const id of [10, 11, 12]) await savePost(id, { createdAt: new Date('2026-01-04T12:00:00Z') });
    for (const id of [20, 21, 22]) await savePost(id, { title: `PageNeedle ${id}`, createdAt: new Date('2026-01-03T12:00:00Z') });
    for (const id of [23, 24]) await savePost(id, { title: `PageNeedle ${id}`, createdAt: new Date('2026-01-02T12:00:00Z') });
    await savePost(25, { title: 'PageNeedle 25' });

    await savePost(30, { title: 'FilterNeedle 城市动态' });
    await savePost(31, { title: 'FilterNeedle 城市活动', type: 'event' });
    await savePost(32, { title: 'FilterNeedle 城市闲置', type: 'market' });
    await savePost(33, { title: 'FilterNeedle 国际动态', circle: 'international', city: null, contentLanguage: 'en' });
    await savePost(34, { title: 'FilterNeedle 上海活动', city: '上海', type: 'event' });
    await savePost(35, { title: 'FilterNeedle 本校活动', circle: 'campus', city: null, visibility: 'school', schoolId, type: 'event' });
    await savePost(36, { title: 'FilterNeedle 外校活动', circle: 'campus', city: null, visibility: 'school', schoolId: otherSchoolId, type: 'event' });

    await savePost(40, { title: 'PrivacyNeedle 公开' });
    await savePost(41, { title: 'PrivacyNeedle 待审核', authorId: schoolUserId, status: 'pending' });
    await savePost(42, { title: 'PrivacyNeedle 已下架', status: 'offline' });
    await savePost(43, { title: 'PrivacyNeedle 本校', circle: 'campus', city: null, visibility: 'school', schoolId });
    await savePost(44, { title: 'PrivacyNeedle 外校', circle: 'campus', city: null, visibility: 'school', schoolId: otherSchoolId });

    await savePost(50, { title: '折扣 50% 留字面百分号' });
    await savePost(51, { content: '标签 a_b 中的字面下划线' });
    await savePost(52, { tag: '活动! 这里是字面叹号' });
    await savePost(53, { title: '三个字面符号 !%_ 必须连续' });
    await savePost(54, { title: '折扣 50X', content: '标签 axb', tag: '活动普通字符' });
  });

  afterAll(async () => { await app?.close(); });

  it.each<[string, string, number]>([
    ['标题', '  TITLENEEDLE  ', 1], ['正文', 'bodyneedle', 2], ['标签', 'tagneedle', 3], ['真实作者昵称', 'Alpha', 4],
  ])('searches visible posts by %s through the HTTP API', async (_, query, id) => {
    const response = await feed(guestToken, { scope: 'platform', q: String(query), page: 1, pageSize: 20 }).expect(200);
    expect(response.body.data).toMatchObject({ total: 1, page: 1, pageSize: 20, hasMore: false });
    expect(ids(response.body.data.items)).toEqual([postId(Number(id))]);
    if (id === 4) expect(response.body.data.items[0].author.nickname).toBe('真实作者Alpha');
  });

  it('finds matches outside the first feed page and uses stable createdAt/id descending pagination', async () => {
    const initial = await feed(guestToken, { scope: 'platform', page: 1, pageSize: 2 }).expect(200);
    expect(ids(initial.body.data.items)).toEqual([postId(12), postId(11)]);
    const expected = [[22, 21], [20, 24], [23, 25]];
    const gathered: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const response = await feed(guestToken, { scope: 'platform', q: 'PageNeedle', page, pageSize: 2 }).expect(200);
      expect(response.body.data).toMatchObject({ page, pageSize: 2, total: 6, hasMore: page < 3 });
      expect(ids(response.body.data.items)).toEqual(expected[page - 1].map(postId));
      gathered.push(...ids(response.body.data.items));
    }
    expect(new Set(gathered).size).toBe(6);
    const repeated = await feed(guestToken, { scope: 'platform', q: 'PageNeedle', page: 2, pageSize: 2 }).expect(200);
    expect(ids(repeated.body.data.items)).toEqual([postId(20), postId(24)]);
    const beyond = await feed(guestToken, { scope: 'platform', q: 'PageNeedle', page: 4, pageSize: 2 }).expect(200);
    expect(beyond.body.data).toMatchObject({ items: [], total: 6, hasMore: false });
  });

  it('combines public scope, keyword, type and page without admitting campus posts', async () => {
    const all = await feed(schoolToken, { scope: 'platform', q: 'FilterNeedle', page: 1, pageSize: 20 }).expect(200);
    expect(ids(all.body.data.items)).toEqual([34, 33, 32, 31, 30].map(postId));
    for (const [type, expected] of [['dynamic', [33, 30]], ['event', [34, 31]], ['market', [32]]] as const) {
      const response = await feed(guestToken, { scope: 'platform', q: 'FilterNeedle', type, page: 1, pageSize: 1 }).expect(200);
      expect(response.body.data).toMatchObject({ total: expected.length, hasMore: expected.length > 1 });
      expect(ids(response.body.data.items)).toEqual([postId(expected[0])]);
    }
    const secondEvent = await feed(guestToken, { scope: 'platform', q: 'FilterNeedle', type: 'event', page: 2, pageSize: 1 }).expect(200);
    expect(secondEvent.body.data).toMatchObject({ total: 2, hasMore: false });
    expect(ids(secondEvent.body.data.items)).toEqual([postId(31)]);
  });

  it('combines city and type searches and limits the school scope to the authenticated school', async () => {
    const city = await feed(guestToken, { circle: 'city', city: '北京市', q: 'FilterNeedle', type: 'event', page: 1, pageSize: 1 }).expect(200);
    expect(city.body.data).toMatchObject({ total: 1, hasMore: false });
    expect(ids(city.body.data.items)).toEqual([postId(31)]);
    const school = await feed(schoolToken, { scope: 'school', q: 'FilterNeedle', type: 'event', page: 1, pageSize: 1 }).expect(200);
    expect(school.body.data).toMatchObject({ total: 1, hasMore: false });
    expect(ids(school.body.data.items)).toEqual([postId(35)]);
    const campus = await feed(otherSchoolToken, { circle: 'campus', q: 'FilterNeedle', type: 'event', page: 1, pageSize: 1 }).expect(200);
    expect(ids(campus.body.data.items)).toEqual([postId(36)]);
  });

  it('never leaks pending, offline or foreign-school matches, even to the pending post author', async () => {
    const sameSchool = await feed(schoolToken, { q: 'PrivacyNeedle', page: 1, pageSize: 20 }).expect(200);
    expect(sameSchool.body.data.total).toBe(2);
    expect(ids(sameSchool.body.data.items)).toEqual([postId(43), postId(40)]);
    const guest = await feed(guestToken, { q: 'PrivacyNeedle', page: 1, pageSize: 20 }).expect(200);
    expect(guest.body.data.total).toBe(1);
    expect(ids(guest.body.data.items)).toEqual([postId(40)]);
    const otherSchool = await feed(otherSchoolToken, { q: 'PrivacyNeedle', page: 1, pageSize: 20 }).expect(200);
    expect(ids(otherSchool.body.data.items)).toEqual([postId(44), postId(40)]);
    await feed(guestToken, { scope: 'school', q: 'PrivacyNeedle', page: 1 }).expect(403);
    await feed(schoolToken, { schoolId: otherSchoolId, q: 'PrivacyNeedle', page: 1 }).expect(403);
  });

  it.each<[string, number[]]>([
    ['%', [53, 50]], ['_', [53, 51]], ['!', [53, 52]], ['!%_', [53]], ['50%', [50]], ['a_b', [51]],
  ])('treats the search %s as literal text rather than LIKE syntax', async (query, expected) => {
    const response = await feed(guestToken, { scope: 'platform', q: query, page: 1, pageSize: 100 }).expect(200);
    expect(response.body.data.total).toBe(expected.length);
    expect(ids(response.body.data.items)).toEqual(expected.map(postId));
  });

  it('rejects oversized and array search inputs with 400 instead of executing an invalid query', async () => {
    await feed(guestToken, { q: '长'.repeat(101), page: 1 }).expect(400);
    await request(app.getHttpServer()).get('/api/v1/posts?q=first&q=second&page=1')
      .set('Authorization', `Bearer ${guestToken}`).expect(400);
  });

  it('retains legacy array responses when pagination is omitted and searches public content without school verification', async () => {
    const me = await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', `Bearer ${guestToken}`).expect(200);
    expect(me.body.data.verified).toBe(false);
    const legacy = await feed(guestToken, { scope: 'platform', q: 'PageNeedle' }).expect(200);
    expect(Array.isArray(legacy.body.data)).toBe(true);
    expect(ids(legacy.body.data)).toEqual([22, 21, 20, 24, 23, 25].map(postId));
    const defaultFeed = await feed(guestToken).expect(200);
    expect(Array.isArray(defaultFeed.body.data)).toBe(true);
    expect(defaultFeed.body.data.every((post: Post) => post.visibility === 'platform' && post.status === 'approved')).toBe(true);
  });
});
