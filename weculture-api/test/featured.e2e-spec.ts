import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { DataSource } from 'typeorm';
import { adminAuthVersion, createToken } from '../src/auth';
import { ApiErrorFilter, ResponseInterceptor } from '../src/common';
import { AdminAccount, FeaturedPost, Post, School, SchoolMembership, User } from '../src/entities';

jest.setTimeout(30_000);

type Account = { id: string; token: string };
type Admin = { id: string; token: string; role: 'super_admin' | 'operator' | 'reviewer'; schoolId: string | null };
type Role = Admin['role'];

describe('Featured content', () => {
  let app: INestApplication, source: DataSource;
  let author: Account, platformReader: Account, schoolAReader: Account, schoolBReader: Account, schoolBOther: Account;
  let schoolA: string, schoolB: string;
  let superAdmin: Admin, operatorA: Admin, operatorB: Admin, reviewerA: Admin;
  let sequence = 0;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const add = (token: string, body: unknown) => request(app.getHttpServer()).post('/api/v1/admin/featured').set(auth(token)).send(body as any);
  const adminList = (token: string) => request(app.getHttpServer()).get('/api/v1/admin/featured').set(auth(token));
  const patch = (token: string, id: string, body: unknown) => request(app.getHttpServer()).patch(`/api/v1/admin/featured/${id}`).set(auth(token)).send(body as any);
  const remove = (token: string, id: string) => request(app.getHttpServer()).delete(`/api/v1/admin/featured/${id}`).set(auth(token));
  const userFeatured = (token: string) => request(app.getHttpServer()).get('/api/v1/featured').set(auth(token));
  const account = async (name: string): Promise<Account> => {
    const user = await source.getRepository(User).save({ wechatOpenId: `featured-${name}`, nickname: `${name}同学` });
    return { id: user.id, token: createToken({ id: user.id, kind: 'user' }) };
  };
  const admin = async (name: string, role: Role, schoolId: string | null): Promise<Admin> => {
    const passwordHash = `featured-password-${name}`;
    const row = await source.getRepository(AdminAccount).save({ username: name, passwordHash, role, schoolId });
    return { id: row.id, role, schoolId, token: createToken({ id: row.id, kind: 'admin', role, schoolId, authVersion: adminAuthVersion(passwordHash) }) };
  };
  const post = (values: Partial<Post> = {}) => source.getRepository(Post).save({
    title: `精选测试 ${++sequence}`, content: '精选运营回归内容', authorId: author.id,
    type: 'dynamic', status: 'approved', visibility: 'platform', circle: 'city', city: '北京', schoolId: null, ...values,
  });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = 'featured-isolated-test-secret'; process.env.SEED_DEMO_DATA = 'false';
    const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor()); app.useGlobalFilters(new ApiErrorFilter());
    await app.init(); source = app.get(DataSource);
    const schools = await source.getRepository(School).save([
      { name: '精选测试甲校', shortName: 'FEATURED_A' },
      { name: '精选测试乙校', shortName: 'FEATURED_B' },
    ]);
    schoolA = schools[0].id; schoolB = schools[1].id;
    author = await account('作者'); platformReader = await account('未认证'); schoolAReader = await account('甲校'); schoolBReader = await account('乙校'); schoolBOther = await account('乙校作者');
    await source.getRepository(SchoolMembership).save([
      { userId: author.id, schoolId: schoolA }, { userId: schoolAReader.id, schoolId: schoolA },
      { userId: schoolBReader.id, schoolId: schoolB }, { userId: schoolBOther.id, schoolId: schoolB },
    ]);
    superAdmin = await admin('featured-super', 'super_admin', null);
    operatorA = await admin('featured-operator-a', 'operator', schoolA);
    operatorB = await admin('featured-operator-b', 'operator', schoolB);
    reviewerA = await admin('featured-reviewer-a', 'reviewer', schoolA);
  });
  beforeEach(async () => { await source.getRepository(FeaturedPost).clear(); });
  afterAll(async () => { await app?.close(); });

  it('features platform content for every logged-in reader and upserts duplicates', async () => {
    const platform = await post();
    const created = (await add(superAdmin.token, { postId: platform.id, sortOrder: 2 }).expect(201)).body.data;
    expect(created).toMatchObject({ postId: platform.id, scope: 'platform', schoolId: null, sortOrder: 2, status: 'active' });
    const again = (await add(superAdmin.token, { postId: platform.id, sortOrder: 1 }).expect(201)).body.data;
    expect(again.id).toBe(created.id);
    expect(again.sortOrder).toBe(1);
    expect((await adminList(superAdmin.token).expect(200)).body.data).toHaveLength(1);
    for (const reader of [platformReader, schoolAReader, schoolBReader]) {
      expect((await userFeatured(reader.token).expect(200)).body.data.items.map((item: any) => item.id)).toContain(platform.id);
    }
  });

  it('scopes campus featured content to the school and its operator', async () => {
    const campusA = await post({ visibility: 'school', circle: 'campus', city: null, schoolId: schoolA });
    const campusB = await post({ authorId: schoolBOther.id, visibility: 'school', circle: 'campus', city: null, schoolId: schoolB });
    const platform = await post();
    const created = (await add(operatorA.token, { postId: campusA.id }).expect(201)).body.data;
    expect(created).toMatchObject({ scope: 'school', schoolId: schoolA });
    expect((await userFeatured(schoolAReader.token).expect(200)).body.data.items.map((item: any) => item.id)).toEqual([campusA.id]);
    expect((await userFeatured(platformReader.token).expect(200)).body.data.items).toEqual([]);
    expect((await userFeatured(schoolBReader.token).expect(200)).body.data.items).toEqual([]);
    await add(operatorA.token, { postId: campusB.id }).expect(403);
    await add(operatorA.token, { postId: platform.id }).expect(403);
    await add(operatorB.token, { postId: campusA.id }).expect(403);
    await add(reviewerA.token, { postId: campusA.id }).expect(403);
    expect((await adminList(operatorA.token).expect(200)).body.data.map((item: any) => item.id)).toEqual([created.id]);
    expect((await adminList(operatorB.token).expect(200)).body.data).toEqual([]);
    expect((await adminList(reviewerA.token).expect(200)).body.data.map((item: any) => item.id)).toEqual([created.id]);
    expect((await adminList(superAdmin.token).expect(200)).body.data.map((item: any) => item.id)).toEqual([created.id]);
    await patch(operatorB.token, created.id, { status: 'inactive' }).expect(403);
    await remove(operatorB.token, created.id).expect(403);
  });

  it('orders by sort order, toggles status and hides offline content', async () => {
    const first = await post(), second = await post();
    await add(superAdmin.token, { postId: second.id, sortOrder: 2 }).expect(201);
    const firstEntry = (await add(superAdmin.token, { postId: first.id, sortOrder: 1 }).expect(201)).body.data;
    expect((await userFeatured(schoolAReader.token).expect(200)).body.data.items.map((item: any) => item.id)).toEqual([first.id, second.id]);
    expect((await patch(superAdmin.token, firstEntry.id, { status: 'inactive' }).expect(200)).body.data.status).toBe('inactive');
    expect((await userFeatured(schoolAReader.token).expect(200)).body.data.items.map((item: any) => item.id)).toEqual([second.id]);
    await patch(superAdmin.token, firstEntry.id, { status: 'active' }).expect(200);
    expect((await userFeatured(schoolAReader.token).expect(200)).body.data.items.map((item: any) => item.id)).toEqual([first.id, second.id]);
    await source.getRepository(Post).update(first.id, { status: 'offline' });
    expect((await userFeatured(schoolAReader.token).expect(200)).body.data.items.map((item: any) => item.id)).toEqual([second.id]);
    const listed = (await adminList(superAdmin.token).expect(200)).body.data.find((item: any) => item.id === firstEntry.id);
    expect(listed.post).toMatchObject({ id: first.id, status: 'offline' });
    await remove(superAdmin.token, firstEntry.id).expect(200);
    expect((await userFeatured(schoolAReader.token).expect(200)).body.data.items.map((item: any) => item.id)).toEqual([second.id]);
  });

  it('limits the public strip to ten visible entries', async () => {
    const posts = await Promise.all(Array.from({ length: 12 }, () => post()));
    for (const [index, item] of posts.entries()) await add(superAdmin.token, { postId: item.id, sortOrder: index }).expect(201);
    const items = (await userFeatured(schoolAReader.token).expect(200)).body.data.items;
    expect(items).toHaveLength(10);
    expect(items.map((item: any) => item.id)).toEqual(posts.slice(0, 10).map((item) => item.id));
  });

  it('validates input and requires login', async () => {
    await request(app.getHttpServer()).get('/api/v1/featured').expect(401);
    await request(app.getHttpServer()).get('/api/v1/admin/featured').expect(401);
    await add(superAdmin.token, { postId: 'missing-post' }).expect(404);
    const platform = await post();
    await add(superAdmin.token, { postId: platform.id, sortOrder: -1 }).expect(400);
    await add(superAdmin.token, { postId: platform.id, unknown: true }).expect(400);
    const pending = await post({ status: 'pending' });
    await add(superAdmin.token, { postId: pending.id }).expect(400);
    const created = (await add(superAdmin.token, { postId: platform.id }).expect(201)).body.data;
    await patch(superAdmin.token, created.id, { status: 'unknown' }).expect(400);
    await patch(superAdmin.token, created.id, {}).expect(400);
    await patch(superAdmin.token, 'missing-featured', { status: 'active' }).expect(404);
  });
});
