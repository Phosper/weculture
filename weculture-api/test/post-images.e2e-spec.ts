import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { DataSource } from 'typeorm';
import { adminAuthVersion, createToken } from '../src/auth';
import { ApiErrorFilter, ResponseInterceptor } from '../src/common';
import { AdminAccount, User } from '../src/entities';

jest.setTimeout(30_000);

describe('Post multiple images', () => {
  let app: INestApplication, source: DataSource;
  let author: { token: string }, superAdmin: { token: string };
  let sequence = 0;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const create = (body: Record<string, unknown>) => request(app.getHttpServer()).post('/api/v1/posts').set(auth(author.token)).send({
    circle: 'city', city: '北京', type: 'dynamic', title: '多图测试', content: '多图测试正文', clientRequestId: `post-images-${++sequence}`, ...body,
  });
  const detail = (id: string) => request(app.getHttpServer()).get(`/api/v1/posts/${id}`).set(auth(author.token));

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = 'post-images-isolated-test-secret'; process.env.SEED_DEMO_DATA = 'false';
    const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); app.useGlobalInterceptors(new ResponseInterceptor()); app.useGlobalFilters(new ApiErrorFilter());
    await app.init(); source = app.get(DataSource);
    const user = await source.getRepository(User).save({ wechatOpenId: 'post-images-author', nickname: '多图作者' });
    author = { token: createToken({ id: user.id, kind: 'user' }) };
    const passwordHash = 'post-images-admin-password';
    const admin = await source.getRepository(AdminAccount).save({ username: 'post-images-admin', passwordHash, role: 'super_admin', schoolId: null });
    superAdmin = { token: createToken({ id: admin.id, kind: 'admin', role: 'super_admin', schoolId: null, authVersion: adminAuthVersion(passwordHash) }) };
  });
  afterAll(async () => { await app?.close(); });

  it('stores ordered images and returns the selected cover', async () => {
    const created = (await create({ imageUrls: ['cloud://image-a.jpg', 'cloud://image-b.jpg'], coverIndex: 1 }).expect(201)).body.data;
    const post = (await detail(created.id).expect(200)).body.data;
    expect(post.imageUrls).toEqual(['cloud://image-a.jpg', 'cloud://image-b.jpg']);
    expect(post.coverIndex).toBe(1);
    expect(post.coverUrl).toBe('cloud://image-b.jpg');
    expect(post.imageUrl).toBe('cloud://image-b.jpg');
  });

  it('keeps the legacy single imageUrl contract', async () => {
    const created = (await create({ imageUrl: 'cloud://legacy.jpg' }).expect(201)).body.data;
    const post = (await detail(created.id).expect(200)).body.data;
    expect(post.imageUrls).toEqual(['cloud://legacy.jpg']);
    expect(post.imageUrl).toBe('cloud://legacy.jpg');
    expect(post.coverIndex).toBe(0);
  });

  it('lets an administrator replace the image list and cover', async () => {
    const created = (await create({ imageUrls: ['cloud://old.jpg'] }).expect(201)).body.data;
    const updated = (await request(app.getHttpServer()).patch(`/api/v1/admin/posts/${created.id}`).set(auth(superAdmin.token))
      .send({ imageUrls: ['cloud://one.jpg', 'cloud://two.jpg', 'cloud://three.jpg'], coverIndex: 2 }).expect(200)).body.data;
    expect(updated.imageUrls).toEqual(['cloud://one.jpg', 'cloud://two.jpg', 'cloud://three.jpg']);
    expect(updated.imageUrl).toBe('cloud://three.jpg');
    expect((await detail(created.id).expect(200)).body.data.imageUrls).toHaveLength(3);
  });

  it('validates image count, type and cover index', async () => {
    await create({ imageUrls: Array.from({ length: 10 }, (_, index) => `cloud://${index}.jpg`) }).expect(400);
    await create({ imageUrls: [''] }).expect(400);
    await create({ imageUrls: 'not-an-array' }).expect(400);
    await create({ imageUrls: ['cloud://a', 'cloud://b'], coverIndex: 2 }).expect(400);
    await create({ imageUrls: ['cloud://a'], coverIndex: -1 }).expect(400);
    await create({ imageUrl: 'cloud://only.jpg', coverIndex: 1 }).expect(400);
    await create({ imageUrls: [42] }).expect(400);
  });
});
