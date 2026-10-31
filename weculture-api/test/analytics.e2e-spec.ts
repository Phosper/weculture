import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { DataSource } from 'typeorm';
import { adminAuthVersion, createToken } from '../src/auth';
import { ApiErrorFilter, ResponseInterceptor } from '../src/common';
import { AdminAccount, AnalyticsEvent, Event, Post, School, SchoolMembership, User } from '../src/entities';

jest.setTimeout(30_000);

type Account = { id: string; token: string };
type Admin = { id: string; token: string; role: 'super_admin' | 'operator' | 'reviewer'; schoolId: string | null };

describe('Analytics events and aggregation', () => {
  let app: INestApplication, source: DataSource;
  let author: Account, reader: Account, outsider: Account;
  let schoolA: string, schoolB: string;
  let superAdmin: Admin, operatorA: Admin, reviewerA: Admin;
  let campusPost: Post, platformPost: Post, eventPost: Post, event: Event;
  let sequence = 0;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const today = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const account = async (name: string): Promise<Account> => {
    const user = await source.getRepository(User).save({ wechatOpenId: `analytics-${name}`, nickname: `${name}同学` });
    return { id: user.id, token: createToken({ id: user.id, kind: 'user' }) };
  };
  const admin = async (name: string, role: Admin['role'], schoolId: string | null): Promise<Admin> => {
    const passwordHash = `analytics-password-${name}`;
    const row = await source.getRepository(AdminAccount).save({ username: name, passwordHash, role, schoolId });
    return { id: row.id, role, schoolId, token: createToken({ id: row.id, kind: 'admin', role, schoolId, authVersion: adminAuthVersion(passwordHash) }) };
  };
  const post = (values: Partial<Post> = {}) => source.getRepository(Post).save({
    title: `统计测试 ${++sequence}`, content: '统计回归内容', authorId: author.id,
    type: 'dynamic', status: 'approved', visibility: 'platform', circle: 'city', city: '北京', schoolId: null, ...values,
  });
  const analytics = (token: string, query = `from=${today()}&to=${today()}`) => request(app.getHttpServer()).get(`/api/v1/admin/analytics?${query}`).set(auth(token));

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = 'analytics-isolated-test-secret'; process.env.SEED_DEMO_DATA = 'false';
    const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); app.useGlobalInterceptors(new ResponseInterceptor()); app.useGlobalFilters(new ApiErrorFilter());
    await app.init(); source = app.get(DataSource);
    const schools = await source.getRepository(School).save([
      { name: '统计甲校', shortName: 'ANALYTICS_A' }, { name: '统计乙校', shortName: 'ANALYTICS_B' },
    ]);
    schoolA = schools[0].id; schoolB = schools[1].id;
    author = await account('作者'); reader = await account('读者'); outsider = await account('外校');
    await source.getRepository(SchoolMembership).save([
      { userId: author.id, schoolId: schoolA }, { userId: reader.id, schoolId: schoolA }, { userId: outsider.id, schoolId: schoolB },
    ]);
    superAdmin = await admin('analytics-super', 'super_admin', null);
    operatorA = await admin('analytics-operator-a', 'operator', schoolA);
    reviewerA = await admin('analytics-reviewer-a', 'reviewer', schoolA);
    campusPost = await post({ authorId: author.id, visibility: 'school', circle: 'campus', city: null, schoolId: schoolA });
    platformPost = await post({ authorId: author.id });
    const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), end = new Date(start.getTime() + 2 * 60 * 60 * 1000), deadline = new Date(start.getTime() - 60 * 60 * 1000);
    eventPost = await post({ authorId: author.id, type: 'event', visibility: 'school', circle: 'campus', city: null, schoolId: schoolA, title: '统计活动' });
    event = await source.getRepository(Event).save({ postId: eventPost.id, startsAt: start, endsAt: end, registrationDeadline: deadline, location: '统计教室', capacity: 10, status: 'active' });
  });
  beforeEach(async () => { await source.getRepository(AnalyticsEvent).clear(); });
  afterAll(async () => { await app?.close(); });

  it('records business events without raw search or comment text and deduplicates retries', async () => {
    await request(app.getHttpServer()).get('/api/v1/posts?q=文化统计&page=1&pageSize=20').set(auth(reader.token)).expect(200);
    await request(app.getHttpServer()).get(`/api/v1/posts/${campusPost.id}`).set(auth(reader.token)).expect(200);
    await request(app.getHttpServer()).get(`/api/v1/posts/${platformPost.id}`).set(auth(reader.token)).expect(200);
    const comment = { content: '统计评论正文', clientRequestId: `analytics-comment-${++sequence}` };
    await request(app.getHttpServer()).post(`/api/v1/posts/${campusPost.id}/comments`).set(auth(reader.token)).send(comment).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/posts/${campusPost.id}/comments`).set(auth(reader.token)).send(comment).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/events/${event.id}/registrations`).set(auth(reader.token)).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/events/${event.id}/registrations`).set(auth(reader.token)).expect(201);
    await request(app.getHttpServer()).delete(`/api/v1/events/${event.id}/registrations/me`).set(auth(reader.token)).expect(200);
    const created = { circle: 'city', city: '北京', type: 'dynamic', title: '统计投稿', content: '统计投稿正文', clientRequestId: `analytics-post-${++sequence}` };
    const pending = (await request(app.getHttpServer()).post('/api/v1/posts').set(auth(author.token)).send(created).expect(201)).body.data;
    await request(app.getHttpServer()).post(`/api/v1/admin/posts/${pending.id}/review`).set(auth(superAdmin.token)).send({ status: 'approved', reason: '' }).expect(201);

    const events = await source.getRepository(AnalyticsEvent).find();
    const counts = events.reduce((map, item) => map.set(item.eventCode, (map.get(item.eventCode) || 0) + 1), new Map<string, number>());
    expect(counts.get('search_performed')).toBe(1);
    expect(counts.get('post_viewed')).toBe(2);
    expect(counts.get('comment_created')).toBe(1);
    expect(counts.get('event_registered')).toBe(1);
    expect(counts.get('event_cancelled')).toBe(1);
    expect(counts.get('post_published')).toBe(1);
    expect(counts.get('post_reviewed')).toBe(1);
    const properties = events.map((item) => item.properties).join('');
    expect(properties).not.toContain('文化统计');
    expect(properties).not.toContain('统计评论正文');
    expect(properties).not.toContain('统计投稿正文');
    expect(events.find((item) => item.eventCode === 'search_performed')?.properties).toContain('resultBucket');
  });

  it('aggregates by Beijing date and keeps platform events out of school scope', async () => {
    const repo = source.getRepository(AnalyticsEvent), now = new Date();
    const fixture = async (keys: Array<{ code: string; schoolId: string | null; actor: string | null; count: number }>) => {
      for (const item of keys) for (let index = 0; index < item.count; index += 1) {
        await repo.save({ eventCode: item.code, schoolId: item.schoolId, actorHash: item.actor, targetType: null, targetId: null, properties: '{}', dedupeKey: `fixture-${item.code}-${item.schoolId || 'platform'}-${item.actor || 'none'}-${index}-${Math.random()}` });
      }
    };
    await fixture([
      { code: 'search_performed', schoolId: schoolA, actor: 'actor-a', count: 2 },
      { code: 'post_viewed', schoolId: schoolA, actor: 'actor-a', count: 1 },
      { code: 'post_viewed', schoolId: null, actor: 'actor-b', count: 3 },
      { code: 'comment_created', schoolId: schoolB, actor: 'actor-c', count: 1 },
    ]);
    expect(await repo.count()).toBe(7);
    const all = (await analytics(superAdmin.token).expect(200)).body.data;
    expect(all.totals.find((item: any) => item.eventCode === 'post_viewed')).toMatchObject({ count: 4, uniqueActors: 2 });
    expect(all.items.every((item: any) => item.date === today())).toBe(true);
    expect(all.items.reduce((sum: number, item: any) => sum + item.count, 0)).toBe(7);
    const own = (await analytics(operatorA.token).expect(200)).body.data;
    expect(own.totals.find((item: any) => item.eventCode === 'search_performed')).toMatchObject({ count: 2, uniqueActors: 1 });
    expect(own.totals.find((item: any) => item.eventCode === 'post_viewed')).toMatchObject({ count: 1, uniqueActors: 1 });
    expect(own.totals.find((item: any) => item.eventCode === 'comment_created')).toBeUndefined();
    expect(own.schoolId).toBe(schoolA);
    const json = JSON.stringify(all);
    expect(json).not.toContain('actorHash');
    expect(json).not.toContain('properties');
    expect(json).not.toContain('文化统计');
  });

  it('enforces analytics permissions and date validation', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/analytics').expect(401);
    await analytics(reviewerA.token).expect(403);
    await analytics(operatorA.token, `from=${today()}&to=${today()}&schoolId=${schoolB}`).expect(403);
    await analytics(superAdmin.token, 'from=bad&to=2026-11-01').expect(400);
    await analytics(superAdmin.token, 'from=2026-01-01&to=2026-03-01').expect(400);
    await analytics(superAdmin.token, `from=${today()}&to=2026-10-01`).expect(400);
    await analytics(superAdmin.token, `from=${today()}&to=${today()}&unknown=1`).expect(400);
  });
});
