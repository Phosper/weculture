import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
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
});
