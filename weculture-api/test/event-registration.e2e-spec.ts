import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { DataSource, EntityManager } from 'typeorm';
import { adminAuthVersion, createToken } from '../src/auth';
import { AppService } from '../src/app.service';
import { ApiErrorFilter, ResponseInterceptor } from '../src/common';
import { AdminAccount, AuditLog, Event, EventRegistration, Post, School, SchoolMembership, User, UserPlan } from '../src/entities';

jest.setTimeout(30_000);

describe('Event registration and cancellation', () => {
  let app: INestApplication;
  let source: DataSource;
  let service: AppService;
  let adminToken: string;
  let first: { id: string; token: string }, second: { id: string; token: string }, campus: { id: string; token: string };
  let schoolA: string, schoolB: string;
  let sequence = 0;
  const auth = (token: string) => `Bearer ${token}`;
  const register = (token: string, eventId: string) => request(app.getHttpServer()).post(`/api/v1/events/${eventId}/registrations`).set('Authorization', auth(token)).send({});
  const cancel = (token: string, eventId: string) => request(app.getHttpServer()).delete(`/api/v1/events/${eventId}/registrations/me`).set('Authorization', auth(token));
  const plans = (token: string) => request(app.getHttpServer()).get('/api/v1/me/plans').set('Authorization', auth(token));
  const edit = (postId: string, values: object) => request(app.getHttpServer()).patch(`/api/v1/admin/posts/${postId}`).set('Authorization', auth(adminToken)).send(values);
  const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((yes) => { resolve = yes; }); return { promise, resolve }; };
  const holdFirstTransaction = () => {
    const entered = deferred(), queued = deferred(), release = deferred();
    const originalTransaction = source.transaction.bind(source), originalEventTransaction = (service as any).eventTransaction.bind(service);
    let calls = 0;
    jest.spyOn(source, 'transaction').mockImplementation((async (...args: any[]) => {
      if (!calls++) { entered.resolve(); await release.promise; }
      return (originalTransaction as any)(...args);
    }) as any);
    let scheduled = 0;
    jest.spyOn(service as any, 'eventTransaction').mockImplementation((operation: any) => {
      if (++scheduled === 2) queued.resolve();
      return originalEventTransaction(operation);
    });
    return { entered: entered.promise, queued: queued.promise, release: release.resolve };
  };
  const fixture = async (values: Partial<Event> = {}, schoolId: string | null = null, postStatus: Post['status'] = 'approved') => {
    const post = await source.getRepository(Post).save({
      circle: schoolId ? 'campus' : 'city', visibility: schoolId ? 'school' : 'platform', schoolId,
      city: schoolId ? null : '北京', contentLanguage: null, authorId: first.id, type: 'event', status: postStatus,
      title: `报名回归活动 ${++sequence}`, content: '隔离内存数据库中的活动。',
    } as Partial<Post>);
    const event = await source.getRepository(Event).save({
      postId: post.id, startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000),
      registrationDeadline: new Date(Date.now() + 3_600_000), location: '文化活动室', capacity: 3, registeredCount: 0,
      ...values,
    });
    return { post, event };
  };
  const state = async (eventId: string) => ({
    event: await source.getRepository(Event).findOneByOrFail({ id: eventId }),
    registrations: await source.getRepository(EventRegistration).findBy({ eventId }),
    plans: await source.getRepository(UserPlan).findBy({ targetType: 'event', targetId: eventId }),
  });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'event-registration-isolated-test-secret';
    process.env.SEED_DEMO_DATA = 'false';
    const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new ApiErrorFilter());
    await app.init();
    source = app.get(DataSource);
    service = app.get(AppService);
    const admin = await source.getRepository(AdminAccount).save({ username: 'event-regression-admin', passwordHash: 'isolated-unused-password-hash', role: 'super_admin', schoolId: null });
    adminToken = createToken({ id: admin.id, kind: 'admin', role: admin.role, schoolId: null, authVersion: adminAuthVersion(admin.passwordHash) });
    const account = async (name: string) => {
      const user = await source.getRepository(User).save({ wechatOpenId: `event-regression-${name}` });
      return { id: user.id, token: createToken({ id: user.id, kind: 'user' }) };
    };
    first = await account('first'); second = await account('second'); campus = await account('campus');
    schoolA = (await source.getRepository(School).save({ name: '报名测试甲校', shortName: 'REG_A' })).id;
    schoolB = (await source.getRepository(School).save({ name: '报名测试乙校', shortName: 'REG_B' })).id;
    await source.getRepository(SchoolMembership).save([{ userId: campus.id, schoolId: schoolA }, { userId: second.id, schoolId: schoolB }]);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await app?.close(); });

  it('lets an unverified public user cancel and rejoin with the same registration and plan', async () => {
    const { event, post } = await fixture();
    expect((await register(first.token, event.id).expect(201)).body.data).toMatchObject({ registered: true, registeredCount: 1, capacity: 3, eventId: event.id, postId: post.id });
    const original = await state(event.id);
    const activePlans = (await plans(first.token).expect(200)).body.data;
    expect(activePlans).toEqual(expect.arrayContaining([expect.objectContaining({ id: event.id, postId: post.id, registered: true, capacity: 3, registeredCount: 1, startsAt: event.startsAt.toISOString(), endsAt: event.endsAt.toISOString(), registrationDeadline: event.registrationDeadline.toISOString() })]));
    expect((await cancel(first.token, event.id).expect(200)).body.data).toMatchObject({ registered: false, registeredCount: 0, capacity: 3, eventId: event.id, postId: post.id });
    expect((await plans(first.token).expect(200)).body.data.some((item: { id: string }) => item.id === event.id)).toBe(false);
    expect((await register(first.token, event.id).expect(201)).body.data).toMatchObject({ registered: true, registeredCount: 1 });
    const restored = await state(event.id);
    expect(restored.event.registeredCount).toBe(1);
    expect(restored.registrations).toEqual([expect.objectContaining({ id: original.registrations[0].id, status: 'registered' })]);
    expect(restored.plans).toEqual([expect.objectContaining({ id: original.plans[0].id, status: 'active' })]);
    const detail = await request(app.getHttpServer()).get(`/api/v1/posts/${post.id}`).set('Authorization', auth(first.token)).expect(200);
    expect(detail.body.data.event).toMatchObject({ registered: true, registeredCount: 1 });
  });

  it('returns an existing registration even when the activity is now full or closed', async () => {
    const { event } = await fixture({ capacity: 1 });
    await register(first.token, event.id).expect(201);
    expect((await register(first.token, event.id).expect(201)).body.data).toMatchObject({ registered: true, registeredCount: 1, message: '已报名' });
    await source.getRepository(Event).update(event.id, { status: 'cancelled', registrationDeadline: new Date(Date.now() - 1_000) });
    expect((await register(first.token, event.id).expect(201)).body.data).toMatchObject({ registered: true, registeredCount: 1 });
    await cancel(first.token, event.id).expect(200);
    const final = await state(event.id);
    expect(final.event.registeredCount).toBe(0);
    expect(final.registrations[0].status).toBe('cancelled');
  });

  it('counts concurrent duplicate registrations and cancellations once', async () => {
    const { event } = await fixture({ capacity: 1 });
    const registrations = await Promise.all(Array.from({ length: 4 }, () => register(first.token, event.id)));
    expect(registrations.map((result) => result.status)).toEqual([201, 201, 201, 201]);
    const joined = await state(event.id);
    expect(joined.event.registeredCount).toBe(1);
    expect(joined.registrations).toHaveLength(1); expect(joined.plans).toHaveLength(1);
    const cancellations = await Promise.all(Array.from({ length: 4 }, () => cancel(first.token, event.id)));
    expect(cancellations.map((result) => result.status)).toEqual([200, 200, 200, 200]);
    expect(cancellations.every((result) => result.body.data.registeredCount === 0)).toBe(true);
    const cancelled = await state(event.id);
    expect(cancelled.event.registeredCount).toBe(0);
    expect(cancelled.registrations).toEqual([expect.objectContaining({ status: 'cancelled' })]);
    expect(cancelled.plans).toEqual([expect.objectContaining({ status: 'cancelled' })]);
  });

  it('reserves the final place for only one user and releases it on cancellation', async () => {
    const { event } = await fixture({ capacity: 1 });
    const results = await Promise.all([register(first.token, event.id), register(second.token, event.id)]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const joined = await state(event.id);
    expect(joined.event.registeredCount).toBe(1); expect(joined.registrations).toHaveLength(1); expect(joined.plans).toHaveLength(1);
    const winner = results[0].status === 201 ? first : second, loser = winner === first ? second : first;
    expect(joined.registrations[0].userId).toBe(winner.id);
    await cancel(winner.token, event.id).expect(200);
    await register(loser.token, event.id).expect(201);
    const final = await state(event.id);
    expect(final.event.registeredCount).toBe(1);
    expect(final.registrations.filter((registration) => registration.status === 'registered').map((registration) => registration.userId)).toEqual([loser.id]);
  });

  it.each([
    { capacity: 1, registeredCount: 1 },
    { registrationDeadline: new Date(Date.now() - 1_000) },
    { startsAt: new Date(Date.now() - 1_000) },
    { status: 'changed' as const },
    { status: 'cancelled' as const },
  ])('rejects unavailable activities without creating registration or plan: %o', async (values) => {
    const { event } = await fixture(values);
    await register(first.token, event.id).expect(409);
    const final = await state(event.id);
    expect(final.event.registeredCount).toBe(event.registeredCount);
    expect(final.registrations).toEqual([]); expect(final.plans).toEqual([]);
  });

  it('keeps a cancelled registration and plan unchanged when a late rejoin fails', async () => {
    const { event } = await fixture();
    await register(first.token, event.id).expect(201); await cancel(first.token, event.id).expect(200);
    await source.getRepository(Event).update(event.id, { registrationDeadline: new Date(Date.now() - 1_000) });
    await register(first.token, event.id).expect(409);
    const final = await state(event.id);
    expect(final.event.registeredCount).toBe(0);
    expect(final.registrations[0].status).toBe('cancelled'); expect(final.plans[0].status).toBe('cancelled');
  });

  it('checks school visibility on registration and cancellation, including revoked membership', async () => {
    const { event } = await fixture({}, schoolA);
    for (const token of [first.token, second.token]) {
      await register(token, event.id).expect(403); await cancel(token, event.id).expect(403);
    }
    await register(campus.token, event.id).expect(201);
    await source.getRepository(SchoolMembership).update({ userId: campus.id, schoolId: schoolA }, { verificationStatus: 'revoked' });
    await register(campus.token, event.id).expect(403); await cancel(campus.token, event.id).expect(403);
    expect((await state(event.id)).event.registeredCount).toBe(1);
    expect((await plans(campus.token).expect(200)).body.data.some((item: { id: string }) => item.id === event.id)).toBe(false);
    await source.getRepository(SchoolMembership).update({ userId: campus.id, schoolId: schoolA }, { verificationStatus: 'verified' });
    await cancel(campus.token, event.id).expect(200);
  });

  it('rejects missing credentials, inactive users, hidden posts and missing registration without writes', async () => {
    const { event } = await fixture();
    await request(app.getHttpServer()).post(`/api/v1/events/${event.id}/registrations`).send({}).expect(401);
    await request(app.getHttpServer()).delete(`/api/v1/events/${event.id}/registrations/me`).expect(401);
    await cancel(first.token, event.id).expect(404);
    await register(first.token, 'missing-event').expect(404); await cancel(first.token, 'missing-event').expect(404);
    await source.getRepository(User).update(first.id, { status: 'disabled' });
    await register(first.token, event.id).expect(403); await cancel(first.token, event.id).expect(403);
    await source.getRepository(User).update(first.id, { status: 'active' });
    for (const status of ['pending', 'rejected', 'offline'] as const) {
      const hidden = await fixture({}, null, status);
      await register(first.token, hidden.event.id).expect(404); await cancel(first.token, hidden.event.id).expect(404);
      expect((await state(hidden.event.id)).registrations).toEqual([]);
    }
    const final = await state(event.id);
    expect(final.event.registeredCount).toBe(0); expect(final.registrations).toEqual([]); expect(final.plans).toEqual([]);
  });

  it('rolls back the reserved place and registration when saving the plan fails', async () => {
    const { event } = await fixture();
    jest.spyOn(Logger, 'error').mockImplementation(() => undefined);
    const original = EntityManager.prototype.save;
    jest.spyOn(EntityManager.prototype, 'save').mockImplementation(function (this: EntityManager, target: unknown, ...args: unknown[]) {
      if (target === UserPlan) return Promise.reject(new Error('isolated plan write failure'));
      return original.call(this, target as any, ...args as [any]) as any;
    } as any);
    await register(first.token, event.id).expect(500);
    const final = await state(event.id);
    expect(final.event.registeredCount).toBe(0); expect(final.registrations).toEqual([]); expect(final.plans).toEqual([]);
    jest.restoreAllMocks();
    await register(first.token, event.id).expect(201);
  });

  it('rolls back cancellation and the released place when updating the plan fails', async () => {
    const { event } = await fixture();
    await register(first.token, event.id).expect(201);
    jest.spyOn(Logger, 'error').mockImplementation(() => undefined);
    const original = EntityManager.prototype.update;
    jest.spyOn(EntityManager.prototype, 'update').mockImplementation(function (this: EntityManager, target: any, criteria: any, values: any) {
      if (target === UserPlan) return Promise.reject(new Error('isolated plan update failure'));
      return original.call(this, target, criteria, values);
    });
    await cancel(first.token, event.id).expect(500);
    const final = await state(event.id);
    expect(final.event.registeredCount).toBe(1);
    expect(final.registrations[0].status).toBe('registered'); expect(final.plans[0].status).toBe('active');
    jest.restoreAllMocks();
    await cancel(first.token, event.id).expect(200);
  });

  it('keeps concurrent cancel and rejoin consistent with the stored registration', async () => {
    const { event } = await fixture();
    await register(first.token, event.id).expect(201);
    const results = await Promise.all([cancel(first.token, event.id), register(first.token, event.id), cancel(first.token, event.id)]);
    expect(results.map((result) => result.status)).toEqual([200, 201, 200]);
    const final = await state(event.id);
    const active = final.registrations[0].status === 'registered';
    expect(final.registrations).toHaveLength(1); expect(final.plans).toHaveLength(1);
    expect(final.event.registeredCount).toBe(active ? 1 : 0); expect(final.plans[0].status).toBe(active ? 'active' : 'cancelled');
  });

  it('keeps signup and cancellation counts when an administrator edits the same activity concurrently', async () => {
    const { event, post } = await fixture();
    const barrier = holdFirstTransaction();
    const editing = edit(post.id, { title: '与报名同时更新的活动', status: 'approved' }).then((response) => response);
    await barrier.entered;
    const joining = register(first.token, event.id).then((response) => response);
    await barrier.queued;
    barrier.release();
    expect((await editing).status).toBe(200); expect((await joining).status).toBe(201);
    const joined = await state(event.id);
    expect(joined.event.registeredCount).toBe(1);
    expect(joined.registrations).toEqual([expect.objectContaining({ status: 'registered' })]);
    expect(joined.plans).toEqual([expect.objectContaining({ status: 'active' })]);
    jest.restoreAllMocks();
    const anotherBarrier = holdFirstTransaction();
    const cancelling = cancel(first.token, event.id).then((response) => response);
    await anotherBarrier.entered;
    const anotherEdit = edit(post.id, { title: '与取消同时更新的活动', status: 'approved' }).then((response) => response);
    await anotherBarrier.queued;
    anotherBarrier.release();
    expect((await cancelling).status).toBe(200); expect((await anotherEdit).status).toBe(200);
    const final = await state(event.id);
    expect(final.event.registeredCount).toBe(0);
    expect(final.registrations).toEqual([expect.objectContaining({ status: 'cancelled' })]);
    expect(final.event.startsAt).toEqual(event.startsAt); expect(final.event.capacity).toBe(event.capacity);
    expect((await source.getRepository(Post).findOneByOrFail({ id: post.id })).title).toBe('与取消同时更新的活动');
  });

  it('rechecks reduced capacity after a competing signup and rejects the edit without partial writes', async () => {
    const { event, post } = await fixture({ capacity: 3 });
    await register(first.token, event.id).expect(201);
    const barrier = holdFirstTransaction();
    const joining = register(second.token, event.id).then((response) => response);
    await barrier.entered;
    const editing = edit(post.id, { title: '人数已变化时不能保存这个标题', capacity: 1, status: 'pending' }).then((response) => response);
    await barrier.queued;
    barrier.release();
    expect((await joining).status).toBe(201);
    expect((await editing).status).toBe(400);
    const final = await state(event.id);
    expect(final.event).toMatchObject({ capacity: 3, registeredCount: 2 });
    expect(final.registrations.filter((registration) => registration.status === 'registered')).toHaveLength(2);
    expect((await source.getRepository(Post).findOneByOrFail({ id: post.id }))).toMatchObject({ title: post.title, status: 'approved' });
    expect(await source.getRepository(AuditLog).countBy({ resourceId: post.id, action: 'post.edit' })).toBe(0);
  });

  it('permits capacity equal to the latest count and preserves cancelled activity status during metadata edits', async () => {
    const { event, post } = await fixture({ capacity: 3 });
    await register(first.token, event.id).expect(201); await register(second.token, event.id).expect(201);
    const edited = await edit(post.id, { title: '容量等于人数仍可保存', capacity: 2, status: 'approved' }).expect(200);
    expect(edited.body.data.event).toMatchObject({ registeredCount: 2, capacity: 2 });
    await register(campus.token, event.id).expect(409);
    await source.getRepository(Event).update(event.id, { status: 'cancelled' });
    await edit(post.id, { title: '仅补充活动说明', status: 'approved' }).expect(200);
    expect((await state(event.id)).event).toMatchObject({ registeredCount: 2, capacity: 2, status: 'cancelled' });
    await cancel(first.token, event.id).expect(200);
  });
});
