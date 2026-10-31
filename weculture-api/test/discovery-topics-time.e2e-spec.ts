import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { DataSource } from 'typeorm';
import { adminAuthVersion, createToken } from '../src/auth';
import { AppService } from '../src/app.service';
import { ApiErrorFilter, ResponseInterceptor } from '../src/common';
import { AdminAccount, ENTITIES, Event, Post, School, SchoolMembership, User } from '../src/entities';
import { eventTimeBounds } from '../src/event-time-filter';

jest.setTimeout(30_000);

describe('Discovery exact topics and activity time filters', () => {
  let app: INestApplication, source: DataSource, mysql: DataSource, service: AppService;
  let guest: { id: string; token: string }, member: { id: string; token: string }, foreign: { id: string; token: string };
  let schoolId: string, foreignSchoolId: string, adminToken: string, operatorToken: string;
  let sequence = 0;
  const NOW = new Date('2026-10-20T15:30:00.000Z'); // Beijing October 20, 23:30.
  const TODAY_END = new Date('2026-10-20T16:00:00.000Z');
  const WEEK_END = new Date('2026-10-26T16:00:00.000Z');
  const feed = (token: string, query: Record<string, string | number | undefined> = {}) => request(app.getHttpServer())
    .get('/api/v1/posts').set('Authorization', `Bearer ${token}`).query(query);
  const adminFeed = (token: string, query: Record<string, string | number | undefined> = {}) => request(app.getHttpServer())
    .get('/api/v1/admin/posts').set('Authorization', `Bearer ${token}`).query(query);
  const ids = (items: { id: string }[]) => items.map(({ id }) => id);
  const post = async (overrides: Partial<Post> = {}) => source.getRepository(Post).save({
    id: `10000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    authorId: guest.id, circle: 'city' as const, city: '北京', visibility: 'platform' as const, schoolId: null,
    type: 'dynamic' as const, status: 'approved' as const, title: '时间话题筛选测试', content: '正文中的组合搜索词', tag: '文化活动',
    createdAt: new Date('2026-10-20T12:00:00.000Z'), ...overrides,
  });
  const activity = async (startsAt: Date, values: Partial<Event> = {}, postValues: Partial<Post> = {}) => {
    const content = await post({ type: 'event', ...postValues });
    const event = await source.getRepository(Event).save({
      postId: content.id, startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000),
      registrationDeadline: new Date(startsAt.getTime() - 60_000), status: 'active',
      location: '测试活动室', capacity: 20, registeredCount: 0, ...values,
    });
    return { post: content, event };
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'discovery-topics-time-isolated-secret';
    process.env.SEED_DEMO_DATA = 'false';
    const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new ApiErrorFilter());
    await app.init();
    source = app.get(DataSource); service = app.get(AppService);
    expect(source.options.type).toBe('sqljs');
    mysql = new DataSource({ type: 'mysql', timezone: 'Z', database: 'offline_filter_test', entities: ENTITIES });
    // Metadata and SQL generation only; no MySQL connection is opened.
    await (mysql as any).buildMetadatas();
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'hrtime', 'performance', 'queueMicrotask'] });
    const account = async (name: string) => {
      const user = await source.getRepository(User).save({ wechatOpenId: `topics-time-${name}` });
      return { id: user.id, token: createToken({ id: user.id, kind: 'user' }) };
    };
    guest = await account('guest'); member = await account('member'); foreign = await account('foreign');
    const schools = await source.getRepository(School).save([
      { name: '话题时间甲校', shortName: 'TOPICS_A' }, { name: '话题时间乙校', shortName: 'TOPICS_B' },
    ]);
    schoolId = schools[0].id; foreignSchoolId = schools[1].id;
    await source.getRepository(SchoolMembership).save([{ userId: member.id, schoolId }, { userId: foreign.id, schoolId: foreignSchoolId }]);
    const adminAccount = async (username: string, role: AdminAccount['role'], scope: string | null) => {
      const admin = await source.getRepository(AdminAccount).save({ username, passwordHash: 'unused-isolated-hash', role, schoolId: scope });
      return createToken({ id: admin.id, kind: 'admin', role, schoolId: scope, authVersion: adminAuthVersion(admin.passwordHash) });
    };
    adminToken = await adminAccount('topics-time-admin', 'super_admin', null);
    operatorToken = await adminAccount('topics-time-operator', 'operator', schoolId);
  });
  beforeEach(async () => {
    await source.getRepository(Event).clear();
    await source.getRepository(Post).clear();
    // Freeze only the clock; keep network and database scheduling on real timers.
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'hrtime', 'performance', 'queueMicrotask'] });
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
  afterAll(async () => { await app?.close(); });

  it('matches a complete, trimmed topic independently of title/body search or case-insensitive database collation', async () => {
    const exact = await post({ tag: 'Culture' });
    for (const tag of ['culture', 'Cülture', 'Culture extra', 'Culture ']) await post({ tag });
    await post({ tag: '其他话题', title: 'Culture', content: 'Culture' });
    const result = await feed(guest.token, { tag: '  Culture  ', page: 1 }).expect(200);
    expect(result.body.data.total).toBe(1);
    expect(ids(result.body.data.items)).toEqual([exact.id]);
  });

  it('treats percent signs, underscores, quotes and SQL-looking topic text literally', async () => {
    const tag = "活动!%_' OR '1'='1";
    const exact = await post({ tag });
    await post({ tag: `${tag}后缀` }); await post({ tag: '活动Xabcd' });
    const result = await feed(guest.token, { tag, q: '组合搜索词', page: 1 }).expect(200);
    expect(result.body.data.total).toBe(1);
    expect(ids(result.body.data.items)).toEqual([exact.id]);
  });

  it.each([1, 80])('accepts a complete topic of %i characters', async (length) => {
    const exact = await post({ tag: '文'.repeat(length) });
    const result = await feed(guest.token, { tag: ` ${'文'.repeat(length)} ` }).expect(200);
    expect(ids(result.body.data)).toEqual([exact.id]);
  });

  it('filters upcoming active events without representing full or closed registration as available', async () => {
    const atNow = await activity(NOW);
    const full = await activity(new Date(NOW.getTime() + 60_000), { registeredCount: 20 });
    const closed = await activity(new Date(NOW.getTime() + 120_000), { registrationDeadline: new Date(NOW.getTime() - 1) });
    const future = await activity(new Date('2027-01-01T00:00:00Z'));
    await activity(new Date(NOW.getTime() - 1));
    await activity(new Date(NOW.getTime() + 60_000), { status: 'cancelled' });
    await activity(new Date(NOW.getTime() + 60_000), { status: 'changed' });
    await post({ type: 'event' }); // A missing event record cannot pass the inner join.
    await activity(new Date(NOW.getTime() + 60_000), {}, { type: 'dynamic' });
    const result = await feed(guest.token, { eventTime: 'upcoming', page: 1 }).expect(200);
    expect(result.body.data.total).toBe(4);
    expect(ids(result.body.data.items)).toEqual([future.post.id, closed.post.id, full.post.id, atNow.post.id]);
    expect(result.body.data.items.find((item: Post) => item.id === full.post.id).event).toMatchObject({ registeredCount: 20, capacity: 20 });
    for (const event of [full.event, closed.event]) await request(app.getHttpServer())
      .post(`/api/v1/events/${event.id}/registrations`).set('Authorization', `Bearer ${guest.token}`).send({}).expect(409);
  });

  it('uses inclusive now and exclusive Beijing next-midnight boundaries for today', async () => {
    const atNow = await activity(NOW);
    const last = await activity(new Date(TODAY_END.getTime() - 1));
    await activity(new Date(TODAY_END));
    await activity(new Date(NOW.getTime() - 1));
    const result = await feed(guest.token, { eventTime: 'today' }).expect(200);
    expect(Array.isArray(result.body.data)).toBe(true);
    expect(ids(result.body.data)).toEqual([last.post.id, atNow.post.id]);
  });

  it('counts today as the first of seven Beijing calendar days', async () => {
    const tomorrow = await activity(TODAY_END);
    const last = await activity(new Date(WEEK_END.getTime() - 1));
    await activity(WEEK_END);
    await activity(new Date(NOW.getTime() - 1));
    const result = await feed(guest.token, { eventTime: 'week', type: 'event', page: 1 }).expect(200);
    expect(result.body.data.total).toBe(2);
    expect(ids(result.body.data.items)).toEqual([last.post.id, tomorrow.post.id]);
  });

  it('moves the today window at Beijing midnight even though the UTC date has not changed', async () => {
    const beforeMidnight = await activity(new Date('2026-10-20T15:59:59.999Z'));
    const midnight = await activity(new Date('2026-10-20T16:00:00.000Z'));
    const nextLast = await activity(new Date('2026-10-21T15:59:59.999Z'));
    await activity(new Date('2026-10-21T16:00:00.000Z'));
    jest.setSystemTime(new Date('2026-10-20T15:59:59.999Z'));
    expect(ids((await feed(guest.token, { eventTime: 'today' }).expect(200)).body.data)).toEqual([beforeMidnight.post.id]);
    jest.setSystemTime(new Date('2026-10-20T16:00:00.000Z'));
    expect(ids((await feed(guest.token, { eventTime: 'today' }).expect(200)).body.data)).toEqual([nextLast.post.id, midnight.post.id]);
  });

  it('combines topic, time, city, search, type and stable pagination before counting', async () => {
    const matches = [];
    for (let index = 0; index < 5; index++) matches.push(await activity(new Date(NOW.getTime() + index * 1_000)));
    await activity(NOW, {}, { city: '上海' });
    await activity(NOW, {}, { tag: '其他' });
    await activity(TODAY_END);
    await post();
    const gathered: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const result = await feed(guest.token, { circle: 'city', city: '北京市', q: '组合搜索词', type: 'event', tag: '文化活动', eventTime: 'today', page, pageSize: 2 }).expect(200);
      expect(result.body.data).toMatchObject({ total: 5, page, pageSize: 2, hasMore: page < 3 });
      gathered.push(...ids(result.body.data.items));
    }
    expect(gathered).toEqual(matches.map(({ post: content }) => content.id).reverse());
    expect(new Set(gathered).size).toBe(5);
  });

  it('preserves school and approval restrictions under matching topics and event times', async () => {
    const publicEvent = await activity(NOW);
    const own = await activity(NOW, {}, { circle: 'campus', city: null, visibility: 'school', schoolId });
    const other = await activity(NOW, {}, { circle: 'campus', city: null, visibility: 'school', schoolId: foreignSchoolId });
    await activity(NOW, {}, { status: 'pending', authorId: member.id });
    await activity(NOW, {}, { status: 'offline' });
    const filters = { tag: '文化活动', eventTime: 'today', page: 1 };
    expect(ids((await feed(guest.token, filters).expect(200)).body.data.items)).toEqual([publicEvent.post.id]);
    expect(ids((await feed(member.token, filters).expect(200)).body.data.items)).toEqual([own.post.id, publicEvent.post.id]);
    expect(ids((await feed(foreign.token, { ...filters, circle: 'campus' }).expect(200)).body.data.items)).toEqual([other.post.id]);
    await feed(guest.token, { ...filters, circle: 'campus' }).expect(403);
    await feed(member.token, { ...filters, schoolId: foreignSchoolId }).expect(403);
  });

  it('shares filters with admin listings while retaining admin school and moderation scope', async () => {
    const publicEvent = await activity(NOW);
    const pending = await activity(NOW, {}, { status: 'pending', circle: 'campus', city: null, visibility: 'school', schoolId });
    const other = await activity(NOW, {}, { status: 'pending', circle: 'campus', city: null, visibility: 'school', schoolId: foreignSchoolId });
    await activity(NOW, { status: 'cancelled' }, { status: 'pending', circle: 'campus', city: null, visibility: 'school', schoolId });
    const filters = { tag: '文化活动', eventTime: 'today', page: 1, pageSize: 1 };
    const admin = await adminFeed(adminToken, filters).expect(200);
    expect(admin.body.data).toMatchObject({ total: 3, hasMore: true });
    expect(ids(admin.body.data.items)).toEqual([other.post.id]);
    const operator = await adminFeed(operatorToken, { ...filters, status: 'pending' }).expect(200);
    expect(operator.body.data).toMatchObject({ total: 1, hasMore: false });
    expect(ids(operator.body.data.items)).toEqual([pending.post.id]);
    const legacy = await adminFeed(adminToken, { tag: '文化活动', eventTime: 'today', scope: 'platform' }).expect(200);
    expect(ids(legacy.body.data)).toEqual([publicEvent.post.id]);
    await adminFeed(operatorToken, { ...filters, schoolId: foreignSchoolId }).expect(403);
    await adminFeed(operatorToken, { ...filters, scope: 'platform' }).expect(403);
  });

  it('retains all-time semantics and legacy array contracts', async () => {
    const dynamic = await post();
    const cancelled = await activity(new Date(NOW.getTime() - 1), { status: 'cancelled' });
    const all = await feed(guest.token, { tag: '文化活动', eventTime: 'all' }).expect(200);
    expect(ids(all.body.data)).toEqual([cancelled.post.id, dynamic.id]);
    expect(ids((await feed(guest.token, { type: 'dynamic', eventTime: 'all' }).expect(200)).body.data)).toEqual([dynamic.id]);
    const ordinary = await feed(guest.token).expect(200);
    expect(ids(ordinary.body.data)).toEqual(ids(all.body.data));
  });

  it.each([
    { tag: '' }, { tag: '   ' }, { tag: '长'.repeat(81) },
    { eventTime: '' }, { eventTime: 'TODAY' }, { eventTime: 'tomorrow' }, { eventTime: ' today ' },
    { type: 'dynamic', eventTime: 'today' }, { type: 'market', eventTime: 'week' },
  ])('rejects invalid topic/time combinations with 400: %j', async (query) => {
    await feed(guest.token, query).expect(400);
    await adminFeed(adminToken, query).expect(400);
  });

  it.each(['tag=a&tag=b', 'eventTime=today&eventTime=week', 'tag%5Bvalue%5D=a', 'eventTime%5B%5D=today', 'unknown=a&unknown=b', 'unknown%5Bvalue%5D=a'])
    ('rejects array/object query representations with 400: %s', async (query) => {
      await request(app.getHttpServer()).get(`/api/v1/posts?${query}`).set('Authorization', `Bearer ${guest.token}`).expect(400);
      await request(app.getHttpServer()).get(`/api/v1/admin/posts?${query}`).set('Authorization', `Bearer ${adminToken}`).expect(400);
    });

  it('rejects object values reaching the service and authenticates both listings before querying', async () => {
    for (const query of [{ tag: {} }, { eventTime: [] }, { unknown: {} }, { unknown: [] }]) {
      await expect(service.listPosts({ id: guest.id, kind: 'user' }, query as any)).rejects.toMatchObject({ status: 400 });
    }
    await request(app.getHttpServer()).get('/api/v1/posts?tag=文化活动&eventTime=today').expect(401);
    await request(app.getHttpServer()).get('/api/v1/admin/posts?tag=文化活动&eventTime=today').expect(401);
    await adminFeed(guest.token, { eventTime: 'today' }).expect(401);
    await feed(adminToken, { eventTime: 'today' }).expect(401);
  });

  it('uses UTC Date parameters with TypeORM serialization for SQLite and MySQL, without applying generated-date offsets', async () => {
    expect(eventTimeBounds('today', NOW)).toEqual({ from: NOW, until: TODAY_END });
    expect(eventTimeBounds('week', NOW)).toEqual({ from: NOW, until: WEEK_END });
    const originalSource = (service as any).dataSource;
    try {
      for (const dataSource of [source, mysql]) {
        (service as any).dataSource = dataSource;
        const qb = dataSource.getRepository(Post).createQueryBuilder('post');
        (service as any).applyPostFilters(qb, { tag: '文化!%_', eventTime: 'today' });
        const [sql, parameters] = qb.getQueryAndParameters();
        expect(sql).toContain('startsAt');
        expect(parameters).toContain('文化!%_');
        if (dataSource.options.type === 'mysql') {
          expect(sql).toContain('BINARY');
          expect(parameters.filter((value: unknown) => value instanceof Date)).toEqual([NOW, TODAY_END]);
        } else {
          expect(parameters).toContain('2026-10-20 15:30:00.000');
          expect(parameters).toContain('2026-10-20 16:00:00.000');
        }
      }
    } finally { (service as any).dataSource = originalSource; }
  });
});
