import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { DataSource } from 'typeorm';
import { adminAuthVersion, createToken } from '../src/auth';
import { ApiErrorFilter, ResponseInterceptor } from '../src/common';
import { AdminAccount, Event, Post, User } from '../src/entities';

jest.setTimeout(30_000);

describe('Event change notes', () => {
  let app: INestApplication, source: DataSource;
  let author: { id: string; token: string }, superAdmin: { token: string };
  let post: Post, event: Event;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = 'event-changes-isolated-test-secret'; process.env.SEED_DEMO_DATA = 'false';
    const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); app.useGlobalInterceptors(new ResponseInterceptor()); app.useGlobalFilters(new ApiErrorFilter());
    await app.init(); source = app.get(DataSource);
    const user = await source.getRepository(User).save({ wechatOpenId: 'event-change-author', nickname: '活动作者' });
    author = { id: user.id, token: createToken({ id: user.id, kind: 'user' }) };
    const passwordHash = 'event-change-admin-password';
    const admin = await source.getRepository(AdminAccount).save({ username: 'event-change-admin', passwordHash, role: 'super_admin', schoolId: null });
    superAdmin = { token: createToken({ id: admin.id, kind: 'admin', role: 'super_admin', schoolId: null, authVersion: adminAuthVersion(passwordHash) }) };
    post = await source.getRepository(Post).save({ authorId: user.id, type: 'event', status: 'approved', visibility: 'platform', circle: 'city', city: '北京', title: '活动变更测试', content: '活动变更正文' });
    const start = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000), end = new Date(start.getTime() + 2 * 60 * 60 * 1000), deadline = new Date(start.getTime() - 60 * 60 * 1000);
    event = await source.getRepository(Event).save({ postId: post.id, startsAt: start, endsAt: end, registrationDeadline: deadline, location: '原地点', capacity: 20, status: 'active' });
  });
  afterAll(async () => { await app?.close(); });

  it('updates a changed event and exposes the note on user detail', async () => {
    const response = await request(app.getHttpServer()).patch(`/api/v1/admin/posts/${post.id}`).set('Authorization', `Bearer ${superAdmin.token}`)
      .send({ eventStatus: 'changed', changeNote: '地点改到新教室', location: '新教室' }).expect(200);
    expect(response.body.data.event).toMatchObject({ status: 'changed', changeNote: '地点改到新教室', location: '新教室' });
    expect(response.body.data.event.changedAt).toBeTruthy();
    const detail = (await request(app.getHttpServer()).get(`/api/v1/posts/${post.id}`).set('Authorization', `Bearer ${author.token}`).expect(200)).body.data;
    expect(detail.event).toMatchObject({ status: 'changed', changeNote: '地点改到新教室', location: '新教室' });
    expect(detail.event.cancellationReason).toBe('');
  });

  it('cancels with a reason and rejects missing or oversized notes', async () => {
    await request(app.getHttpServer()).patch(`/api/v1/admin/posts/${post.id}`).set('Authorization', `Bearer ${superAdmin.token}`)
      .send({ eventStatus: 'cancelled', cancellationReason: '' }).expect(400);
    const cancelled = await request(app.getHttpServer()).patch(`/api/v1/admin/posts/${post.id}`).set('Authorization', `Bearer ${superAdmin.token}`)
      .send({ eventStatus: 'cancelled', cancellationReason: '天气原因取消' }).expect(200);
    expect(cancelled.body.data.event).toMatchObject({ status: 'cancelled', cancellationReason: '天气原因取消' });
    await request(app.getHttpServer()).patch(`/api/v1/admin/posts/${post.id}`).set('Authorization', `Bearer ${superAdmin.token}`)
      .send({ eventStatus: 'changed', changeNote: '' }).expect(400);
    await request(app.getHttpServer()).patch(`/api/v1/admin/posts/${post.id}`).set('Authorization', `Bearer ${superAdmin.token}`)
      .send({ eventStatus: 'changed', changeNote: '长'.repeat(501) }).expect(400);
  });

  it('keeps existing event fields when only the note changes', async () => {
    const before = await source.getRepository(Event).findOneByOrFail({ id: event.id });
    await request(app.getHttpServer()).patch(`/api/v1/admin/posts/${post.id}`).set('Authorization', `Bearer ${superAdmin.token}`)
      .send({ eventStatus: 'active', changeNote: '', cancellationReason: '' }).expect(200);
    const after = await source.getRepository(Event).findOneByOrFail({ id: event.id });
    expect(+after.startsAt).toBe(+before.startsAt);
    expect(+after.endsAt).toBe(+before.endsAt);
    expect(after.location).toBe(before.location);
    expect(after.capacity).toBe(before.capacity);
  });
});
