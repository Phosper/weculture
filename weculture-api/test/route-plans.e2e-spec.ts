import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { DataSource, EntityManager } from 'typeorm';
import { createToken } from '../src/auth';
import { ApiErrorFilter, ResponseInterceptor } from '../src/common';
import { School, SchoolMembership, TravelRoute, User, UserPlan } from '../src/entities';

jest.setTimeout(30_000);

describe('Travel route plans', () => {
  let app: INestApplication, source: DataSource;
  let first: { id: string; token: string }, second: { id: string; token: string };
  let schoolId: string, sequence = 0;
  const plan = (token: string, routeId: string, body: unknown = {}) => request(app.getHttpServer())
    .post(`/api/v1/travel-routes/${routeId}/plans`).set('Authorization', `Bearer ${token}`).send(body as any);
  const mine = (token: string) => request(app.getHttpServer()).get('/api/v1/me/plans').set('Authorization', `Bearer ${token}`);
  const rows = (routeId: string) => source.getRepository(UserPlan).findBy({ targetType: 'route', targetId: routeId });
  const fixture = (values: Partial<TravelRoute> = {}) => source.getRepository(TravelRoute).save({
    title: `服务端旅行计划 ${++sequence}`, destination: '上海', days: '2天', budget: 800,
    preferences: '文化,美食', stops: '博物馆 -> 古街', highlights: '建筑,展览', schoolId: null, ...values,
  });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'route-plan-isolated-test-secret';
    process.env.SEED_DEMO_DATA = 'false';
    const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor()); app.useGlobalFilters(new ApiErrorFilter());
    await app.init(); source = app.get(DataSource);
    const account = async (name: string) => {
      const user = await source.getRepository(User).save({ wechatOpenId: `route-plan-${name}` });
      return { id: user.id, token: createToken({ id: user.id, kind: 'user' }) };
    };
    first = await account('first'); second = await account('second');
    schoolId = (await source.getRepository(School).save({ name: '旅行计划测试学校', shortName: 'ROUTE' })).id;
    await source.getRepository(SchoolMembership).save({ userId: first.id, schoolId });
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await app?.close(); });

  it('saves parameters on the server, supports partial edits and restores the same plan after cancellation', async () => {
    const route = await fixture();
    const details = { departDate: '2028-02-29', companions: 0 };
    expect((await plan(first.token, route.id, { planned: true, ...details }).expect(201)).body.data).toEqual({ planned: true, planMeta: details });
    const original = (await rows(route.id))[0];
    expect((await mine(first.token).expect(200)).body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'route', id: route.id, planned: true, planMeta: details }),
    ]));
    expect((await plan(first.token, route.id, { planned: true, companions: 20 }).expect(201)).body.data.planMeta).toEqual({ ...details, companions: 20 });
    expect((await plan(first.token, route.id, { planned: false }).expect(201)).body.data).toEqual({ planned: false, planMeta: null });
    expect((await mine(first.token).expect(200)).body.data.some((item: { id: string }) => item.id === route.id)).toBe(false);
    expect((await plan(first.token, route.id, { planned: true }).expect(201)).body.data.planMeta).toEqual({ ...details, companions: 20 });
    expect(await rows(route.id)).toEqual([expect.objectContaining({ id: original.id, userId: first.id, status: 'active', ...details, companions: 20 })]);
  });

  it('keeps legacy empty-body toggles and returns null metadata for old plans', async () => {
    const route = await fixture();
    const legacy = await source.getRepository(UserPlan).save({ userId: first.id, targetType: 'route', targetId: route.id });
    expect((await mine(first.token).expect(200)).body.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: route.id, planMeta: null })]));
    expect((await plan(first.token, route.id).expect(201)).body.data).toEqual({ planned: false, planMeta: null });
    const absentBody = await request(app.getHttpServer()).post(`/api/v1/travel-routes/${route.id}/plans`).set('Authorization', `Bearer ${first.token}`).expect(201);
    expect(absentBody.body.data).toEqual({ planned: true, planMeta: null });
    expect(await rows(route.id)).toEqual([expect.objectContaining({ id: legacy.id, departDate: null, companions: null, status: 'active' })]);
  });

  it('makes concurrent desired-state adds and cancellations idempotent without creating a row on an initial cancel', async () => {
    const route = await fixture();
    await plan(first.token, route.id, { planned: false }).expect(201);
    expect(await rows(route.id)).toEqual([]);
    const details = { departDate: '2027-01-15', companions: 3 };
    const added = await Promise.all(Array.from({ length: 5 }, () => plan(first.token, route.id, { planned: true, ...details })));
    expect(added.map((result) => result.status)).toEqual([201, 201, 201, 201, 201]);
    expect(added.every((result) => result.body.data.planned && result.body.data.planMeta.companions === 3)).toBe(true);
    const original = (await rows(route.id))[0];
    expect(await rows(route.id)).toHaveLength(1);
    const cancelled = await Promise.all(Array.from({ length: 5 }, () => plan(first.token, route.id, { planned: false })));
    expect(cancelled.map((result) => result.status)).toEqual([201, 201, 201, 201, 201]);
    expect(cancelled.every((result) => result.body.data.planned === false && result.body.data.planMeta === null)).toBe(true);
    expect(await rows(route.id)).toEqual([expect.objectContaining({ id: original.id, status: 'cancelled', ...details })]);
  });

  it('isolates parameters and cancellation by the authenticated user', async () => {
    const route = await fixture();
    await plan(first.token, route.id, { planned: true, departDate: '2027-05-01', companions: 2 }).expect(201);
    expect((await mine(second.token).expect(200)).body.data.some((item: { id: string }) => item.id === route.id)).toBe(false);
    await plan(second.token, route.id, { planned: true, departDate: '2027-06-01', companions: 5 }).expect(201);
    await plan(second.token, route.id, { planned: false }).expect(201);
    expect((await mine(first.token).expect(200)).body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: route.id, planMeta: { departDate: '2027-05-01', companions: 2 } }),
    ]));
    expect(await rows(route.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: first.id, status: 'active', departDate: '2027-05-01', companions: 2 }),
      expect.objectContaining({ userId: second.id, status: 'cancelled', departDate: '2027-06-01', companions: 5 }),
    ]));
  });

  it('requires login, an active account and current route school permissions', async () => {
    const route = await fixture({ visibility: 'school', schoolId });
    await request(app.getHttpServer()).post(`/api/v1/travel-routes/${route.id}/plans`).send({ planned: true }).expect(401);
    await plan(second.token, route.id, { planned: true }).expect(403);
    await plan(first.token, route.id, { planned: true, companions: 1 }).expect(201);
    await source.getRepository(SchoolMembership).update({ userId: first.id, schoolId }, { verificationStatus: 'revoked' });
    try {
      await plan(first.token, route.id, { planned: true, companions: 4 }).expect(403);
      expect((await mine(first.token).expect(200)).body.data.some((item: { id: string }) => item.id === route.id)).toBe(false);
      expect((await rows(route.id))[0]).toMatchObject({ companions: 1 });
    } finally { await source.getRepository(SchoolMembership).update({ userId: first.id, schoolId }, { verificationStatus: 'verified' }); }
    const disabled = await source.getRepository(User).save({ wechatOpenId: 'route-disabled', status: 'disabled' });
    await plan(createToken({ id: disabled.id, kind: 'user' }), route.id, { planned: true }).expect(403);
    await plan(first.token, 'missing-route', { planned: true }).expect(404);
    const offline = await fixture({ status: 'offline' });
    await plan(first.token, offline.id, { planned: true }).expect(404);
    expect(await rows(offline.id)).toEqual([]);
  });

  it('validates desired state, actual calendar dates and integer companion bounds without mutating existing metadata', async () => {
    const route = await fixture();
    await plan(first.token, route.id, { planned: true, departDate: '2028-02-29', companions: 2 }).expect(201);
    const original = await rows(route.id);
    for (const body of [
      [], { planned: 'true' }, { planned: 1 }, { departDate: '2027-01-01' }, { companions: 2 },
      { planned: true, departDate: '2027-02-29' }, { planned: true, departDate: '2028-02-30' },
      { planned: true, departDate: '2028-04-31' }, { planned: true, departDate: '2028-13-01' },
      { planned: true, departDate: '2028-1-01' }, { planned: true, departDate: '0000-01-01' },
      { planned: true, departDate: '2028-01-01T00:00:00Z' }, { planned: true, departDate: null },
      { planned: true, companions: -1 }, { planned: true, companions: 21 }, { planned: true, companions: 1.5 },
      { planned: true, companions: '2' }, { planned: true, companions: null }, { planned: false, userId: second.id },
    ]) await plan(first.token, route.id, body).expect(400);
    expect(await rows(route.id)).toEqual(original);
  });

  it('rolls back a failed parameter write and permits a subsequent retry', async () => {
    const route = await fixture();
    await plan(first.token, route.id, { planned: true, departDate: '2027-03-01', companions: 1 }).expect(201);
    const original = await rows(route.id), originalSave = EntityManager.prototype.save;
    jest.spyOn(Logger, 'error').mockImplementation(() => undefined);
    const failing = jest.spyOn(EntityManager.prototype, 'save').mockImplementation((async function (this: EntityManager, target: unknown, ...args: unknown[]) {
      if (target === UserPlan) throw new Error('isolated route metadata failure');
      return (originalSave as any).call(this, target, ...args);
    }) as any);
    await plan(first.token, route.id, { planned: true, companions: 4 }).expect(500);
    expect(await rows(route.id)).toEqual(original);
    failing.mockRestore();
    expect((await plan(first.token, route.id, { planned: true, companions: 4 }).expect(201)).body.data.planMeta).toEqual({ departDate: '2027-03-01', companions: 4 });
  });
});
