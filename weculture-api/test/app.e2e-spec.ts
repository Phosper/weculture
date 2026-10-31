import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { DataSource } from 'typeorm';
import { School, SchoolMembership } from '../src/entities';
import { ApiErrorFilter, ResponseInterceptor } from '../src/common';

type ApiResponse<T> = { code: string; message: string; data: T; requestId: string };
jest.setTimeout(20_000);

describe('Weculture API', () => {
  let app: INestApplication;
  let token = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'weculture-integration-test-secret';
    process.env.SEED_DEMO_DATA = 'true';
    process.env.SCHOOL_INVITE_CODE = 'BLCU2026';
    process.env.AUTO_APPROVE = 'false';
    process.env.ADMIN_INITIAL_PASSWORD = 'Weculture@2026';

    // Load the application only after the test environment is configured.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new ApiErrorFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('reports a healthy service', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(response.body).toMatchObject({ code: 'OK', data: { service: 'weculture-api', status: 'healthy' } });
    expect(response.body.requestId).toBeTruthy();
  });

  it('logs in a development user and protects the school feed', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/wechat/login')
      .send({ code: `dev-e2e-${Date.now()}` })
      .expect(201);
    token = (login.body as ApiResponse<{ token: string }>).data.token;
    expect(token).toBeTruthy();

    const restricted = await request(app.getHttpServer())
      .get('/api/v1/posts?scope=school')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(restricted.body.message).toContain('学校认证');
  });

  it('uses the trusted OpenID supplied by WeChat Cloud Run', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/wechat/login')
      .set('x-wx-openid', `cloud-e2e-${Date.now()}`)
      .send({})
      .expect(201);
    expect((response.body as ApiResponse<{ token: string }>).data.token).toBeTruthy();
  });

  it('verifies the school membership and exposes the school feed', async () => {
    const verified = await request(app.getHttpServer())
      .post('/api/v1/me/school-verifications')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'BLCU2026' })
      .expect(201);
    expect(verified.body.data).toMatchObject({ verified: true, school: { shortName: 'BLCU' } });

    const feed = await request(app.getHttpServer())
      .get('/api/v1/posts?scope=school')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(feed.body.data.some((post: { visibility: string }) => post.visibility === 'school')).toBe(true);
  });

  it('finds visible posts by the Weculture author name', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/posts?q=Weculture')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: '非遗扇艺工作坊开放报名', visibility: 'platform', author: expect.objectContaining({ nickname: 'Weculture' }) }),
      expect.objectContaining({ title: '本周校园文化活动清单', visibility: 'school', author: expect.objectContaining({ nickname: 'Weculture' }) }),
    ]));
  });

  it('lists posts saved by the current user', async () => {
    const feed = await request(app.getHttpServer())
      .get('/api/v1/posts?scope=school')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const postId = feed.body.data[0].id;
    await request(app.getHttpServer())
      .post(`/api/v1/posts/${postId}/favorite`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);
    const saved = await request(app.getHttpServer())
      .get('/api/v1/me/favorites')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(saved.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'post', data: expect.objectContaining({ id: postId, favorited: true }) }),
    ]));
  });

  it('returns travel recommendations', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/travel-routes/recommendations')
      .set('Authorization', `Bearer ${token}`)
      .send({ destination: '北京', days: '1-3天', preferences: ['文化'] })
      .expect(201);
    expect(response.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ destination: '北京' })]));
  });

  it('returns the updated event registration count immediately', async () => {
    const feed = await request(app.getHttpServer())
      .get('/api/v1/posts?scope=school&type=event')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const event = feed.body.data[0].event;
    const response = await request(app.getHttpServer())
      .post(`/api/v1/events/${event.id}/registrations`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);
    expect(response.body.data).toMatchObject({ registered: true, registeredCount: event.registeredCount + 1 });
  });

  it('rejects an invalid event without creating a post', async () => {
    const before = await request(app.getHttpServer())
      .get('/api/v1/me/posts')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/posts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'event',
        title: '无效活动',
        content: '这条内容不应写入数据库。',
        location: '测试地点',
        startsAt: '2024-01-01T09:00:00.000Z',
        endsAt: '2024-01-01T10:00:00.000Z',
        registrationDeadline: '2023-12-31T10:00:00.000Z',
        capacity: 'abc',
      })
      .expect(400);

    const after = await request(app.getHttpServer())
      .get('/api/v1/me/posts')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(after.body.data).toHaveLength(before.body.data.length);
  });

  it('U08/U14: exposes moderation results to the author and keeps unapproved posts private', async () => {
    const login = await request(app.getHttpServer()).post('/api/v1/auth/wechat/login').send({ code: 'dev-stage1-reader' }).expect(201);
    const reader = login.body.data.token;
    await request(app.getHttpServer()).post('/api/v1/me/school-verifications').set('Authorization', `Bearer ${reader}`).send({ code: 'BLCU2026' }).expect(201);
    const adminLogin = await request(app.getHttpServer()).post('/api/v1/admin/auth/login').send({ username: 'admin', password: 'Weculture@2026' }).expect(201);
    const admin = adminLogin.body.data.token;
    const create = () => request(app.getHttpServer()).post('/api/v1/posts').set('Authorization', `Bearer ${token}`).send({ type: 'dynamic', title: '审核反馈回归', content: '作者可以查看每一次审核结果。' });
    const read = (id: string, viewer = token) => request(app.getHttpServer()).get(`/api/v1/posts/${id}`).set('Authorization', `Bearer ${viewer}`);
    const review = (id: string, status: string, reason = '') => request(app.getHttpServer()).post(`/api/v1/admin/posts/${id}/review`).set('Authorization', `Bearer ${admin}`).send({ status, reason }).expect(201);
    const assertState = async (id: string, status: string, reason = '') => {
      const detail = await read(id).expect(200);
      expect(detail.body.data).toMatchObject({ id, status, rejectionReason: reason });
      const mine = await request(app.getHttpServer()).get('/api/v1/me/posts').set('Authorization', `Bearer ${token}`).expect(200);
      expect(mine.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ id, status, rejectionReason: reason, author: expect.objectContaining({ id: detail.body.data.authorId }) })]));
      const feed = await request(app.getHttpServer()).get('/api/v1/posts?scope=school').set('Authorization', `Bearer ${reader}`).expect(200);
      expect(feed.body.data.some((post: { id: string }) => post.id === id)).toBe(status === 'approved');
      await read(id, reader).expect(status === 'approved' ? 200 : 404);
    };
    const approved = await create().expect(201);
    expect(approved.body.data.status).toBe('pending');
    await assertState(approved.body.data.id, 'pending');
    await request(app.getHttpServer()).post(`/api/v1/posts/${approved.body.data.id}/likes`).set('Authorization', `Bearer ${token}`).send({}).expect(404);
    await review(approved.body.data.id, 'approved');
    await assertState(approved.body.data.id, 'approved');
    await review(approved.body.data.id, 'offline', '活动信息需要更新');
    await assertState(approved.body.data.id, 'offline', '活动信息需要更新');
    const rejected = await create().expect(201);
    await review(rejected.body.data.id, 'rejected', '请补充具体活动说明');
    await assertState(rejected.body.data.id, 'rejected', '请补充具体活动说明');
    const guest = await request(app.getHttpServer()).post('/api/v1/auth/wechat/login').send({ code: 'dev-stage1-guest' }).expect(201);
    await read(approved.body.data.id, guest.body.data.token).expect(404);
    await request(app.getHttpServer()).post('/api/v1/posts').set('Authorization', `Bearer ${guest.body.data.token}`).send({ title: '未认证投稿', content: '不能绕过认证。' }).expect(403);
    await review(rejected.body.data.id, 'approved');
    await read(rejected.body.data.id, guest.body.data.token).expect(403);
    const other = await request(app.getHttpServer()).post('/api/v1/auth/wechat/login').send({ code: 'dev-stage1-other-school' }).expect(201);
    const source = app.get(DataSource);
    const school = await source.getRepository(School).save({ name: '隔离回归学校', shortName: 'TEST' });
    await source.getRepository(SchoolMembership).save({ userId: other.body.data.user.id, schoolId: school.id });
    await read(rejected.body.data.id, other.body.data.token).expect(403);
    const otherFeed = await request(app.getHttpServer()).get('/api/v1/posts?scope=school').set('Authorization', `Bearer ${other.body.data.token}`).expect(200);
    expect(otherFeed.body.data.some((post: { id: string }) => post.id === rejected.body.data.id)).toBe(false);
  });

  it('U07: automatic approval returns the published status', async () => {
    const previous = process.env.AUTO_APPROVE;
    process.env.AUTO_APPROVE = 'true';
    try {
      const result = await request(app.getHttpServer()).post('/api/v1/posts').set('Authorization', `Bearer ${token}`).send({ title: '自动通过回归', content: '自动审核通过后校园圈可见。' }).expect(201);
      expect(result.body.data.status).toBe('approved');
      const feed = await request(app.getHttpServer()).get('/api/v1/posts?scope=school').set('Authorization', `Bearer ${token}`).expect(200);
      expect(feed.body.data.some((post: { id: string }) => post.id === result.body.data.id)).toBe(true);
    } finally { process.env.AUTO_APPROVE = previous; }
  });

  it('U07c: retries create one post and one event; a reused key cannot change content', async () => {
    const payload = { clientRequestId: 'stage1_retry_event', type: 'event', title: '网络重试回归', content: '相同投稿重试不产生重复记录。', location: '校园活动室', capacity: 20,
      startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 90000000).toISOString(), registrationDeadline: new Date(Date.now() + 3600000).toISOString() };
    const send = (body: object) => request(app.getHttpServer()).post('/api/v1/posts').set('Authorization', `Bearer ${token}`).send(body);
    const before = await request(app.getHttpServer()).get('/api/v1/me/posts').set('Authorization', `Bearer ${token}`).expect(200);
    const [first, retry] = await Promise.all([send(payload).expect(201), send(payload).expect(201)]);
    expect(retry.body.data).toEqual(first.body.data);
    const networkRetry = await send(payload).expect(201);
    expect(networkRetry.body.data).toEqual(first.body.data);
    await send({ ...payload, content: '不同内容不能复用同一个请求标识。' }).expect(409);
    const after = await request(app.getHttpServer()).get('/api/v1/me/posts').set('Authorization', `Bearer ${token}`).expect(200);
    expect(after.body.data).toHaveLength(before.body.data.length + 1);
    expect(after.body.data.find((post: { id: string }) => post.id === first.body.data.id).event).toMatchObject({ capacity: 20, postId: first.body.data.id });
    expect(after.body.data[0].clientRequestId).toBeUndefined();
    expect(after.body.data[0].submissionHash).toBeUndefined();
  });
});
