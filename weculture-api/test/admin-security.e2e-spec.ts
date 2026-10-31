import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import request = require('supertest');
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { AdminAccount, AuditLog, Event, Post, School } from '../src/entities';
import { ApiErrorFilter, ResponseInterceptor } from '../src/common';
import { createToken } from '../src/auth';
import { AdminLoginLimiter, DEMO_ADMIN_PASSWORD, validNewAdminPassword } from '../src/admin-security';
import { DbRetry } from '../src/db-retry';

jest.setTimeout(30_000);

describe('Admin session, credential and media boundaries', () => {
  let app: INestApplication;
  let source: DataSource;
  let schoolA: string, schoolB: string;
  let counter = 0;
  const password = 'PrivateLocal!2026';
  const auth = (token: string) => `Bearer ${token}`;
  const login = (username: string, value = password) => request(app.getHttpServer()).post('/api/v1/admin/auth/login').send({ username, password: value });
  const get = (token: string, path: string) => request(app.getHttpServer()).get(`/api/v1/admin/${path}`).set('Authorization', auth(token));
  const change = (token: string, currentPassword: string, newPassword: string) => request(app.getHttpServer()).post('/api/v1/admin/me/password').set('Authorization', auth(token)).send({ currentPassword, newPassword });
  const account = async (role: AdminAccount['role'] = 'super_admin', schoolId: string | null = null, value = password) => {
    const admin = await source.getRepository(AdminAccount).save({ username: `security-${++counter}`, passwordHash: await bcrypt.hash(value, 4), role, schoolId });
    const response = await login(admin.username, value).expect(201);
    return { admin, token: response.body.data.token as string };
  };
  const post = async (schoolId: string | null, imageUrl: string) => source.getRepository(Post).save({
    circle: schoolId ? 'campus' : 'city', visibility: schoolId ? 'school' : 'platform', schoolId,
    city: schoolId ? null : '北京', contentLanguage: null, authorId: 'local-test-author',
    title: '安全边界测试', content: '只使用测试内存数据库', type: 'dynamic', status: 'pending', imageUrl,
  } as Partial<Post>);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'admin-security-isolated-test-secret-long-enough';
    process.env.SEED_DEMO_DATA = 'false';
    const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new ApiErrorFilter());
    await app.init();
    source = app.get(DataSource);
    schoolA = (await source.getRepository(School).save({ name: '安全测试甲校', shortName: 'SAFE_A' })).id;
    schoolB = (await source.getRepository(School).save({ name: '安全测试乙校', shortName: 'SAFE_B' })).id;
  });
  afterEach(() => { jest.restoreAllMocks(); delete process.env.CLOUD_STORAGE_ENV; delete process.env.CLOUD_STORAGE_PROXY_ENABLED; process.env.NODE_ENV = 'test'; });
  afterAll(async () => { await app?.close(); });

  const disconnected = (code = 'ECONNRESET') => new QueryFailedError('SELECT test_record', [], Object.assign(new Error('test database disconnect'), { code }));

  it('recovers administrator login from one stale database connection without replaying credential processing', async () => {
    const { admin } = await account();
    jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    for (const code of ['ECONNRESET', 'PROTOCOL_CONNECTION_LOST']) {
      const lookup = jest.spyOn(source.getRepository(AdminAccount), 'findOneBy').mockRejectedValueOnce(disconnected(code));
      const response = await login(admin.username).expect(201);
      expect(response.body.data.admin.id).toBe(admin.id);
      expect(response.body.data.token).toBeTruthy();
      expect(lookup).toHaveBeenCalledTimes(2);
      lookup.mockRestore();
    }
  });

  it('counts a failed login only once after a retried read and preserves the existing five-attempt limit', async () => {
    const { admin } = await account();
    jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    const lookup = jest.spyOn(source.getRepository(AdminAccount), 'findOneBy').mockRejectedValueOnce(disconnected());
    await login(admin.username, 'WrongPrivate!2026').expect(403);
    expect(lookup).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 4; i++) await login(admin.username, 'WrongPrivate!2026').expect(403);
    await login(admin.username).expect(429);
    expect(lookup).toHaveBeenCalledTimes(6);
  });

  it('retries guard reads before enforcing the latest account role, school and frozen status', async () => {
    const { admin, token } = await account();
    jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    await source.getRepository(AdminAccount).update(admin.id, { role: 'reviewer', schoolId: schoolB });
    const lookup = jest.spyOn(source.getRepository(AdminAccount), 'findOneBy').mockRejectedValueOnce(disconnected());
    expect((await get(token, 'me').expect(200)).body.data).toEqual({ id: admin.id, username: admin.username, role: 'reviewer', schoolId: schoolB });
    expect(lookup.mock.calls.filter(([where]) => !('status' in where))).toHaveLength(2);
    lookup.mockClear();
    await source.getRepository(AdminAccount).update(admin.id, { status: 'disabled' });
    lookup.mockRejectedValueOnce(disconnected());
    await get(token, 'me').expect(403);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('recovers authorized media database reads and still rejects another school after reconnection', async () => {
    const ownSchool = (await source.getRepository(School).save({ name: '瞬断恢复甲校', shortName: 'RETRY_A' })).id;
    const otherSchool = (await source.getRepository(School).save({ name: '瞬断恢复乙校', shortName: 'RETRY_B' })).id;
    const reviewer = await account('reviewer', ownSchool);
    const own = await post(ownSchool, 'https://images.example.com/recovered.jpg');
    const other = await post(otherSchool, 'https://images.example.com/private.jpg');
    jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    const admins = source.getRepository(AdminAccount);
    const originalFind = admins.findOneBy.bind(admins);
    let activeReadFailed = false;
    jest.spyOn(admins, 'findOneBy').mockImplementation((where) => {
      if ('status' in where && !activeReadFailed) { activeReadFailed = true; return Promise.reject(disconnected()); }
      return originalFind(where);
    });
    const lookup = jest.spyOn(source.getRepository(Post), 'findOneBy').mockRejectedValueOnce(disconnected());
    const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('media read must not fetch HTTPS images'));
    expect((await get(reviewer.token, `posts/${own.id}/media`).expect(200)).body.data.url).toBe(own.imageUrl);
    expect(activeReadFailed).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(2);
    lookup.mockClear(); lookup.mockRejectedValueOnce(disconnected());
    await get(reviewer.token, `posts/${other.id}/media`).expect(403);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bounds each read retry to one attempt and does not retry permanent database errors', async () => {
    jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    const reset = disconnected();
    const recurring = jest.fn().mockRejectedValue(reset);
    await expect(DbRetry.read(recurring)).rejects.toBe(reset);
    expect(recurring).toHaveBeenCalledTimes(2);
    const permanent = disconnected('ER_BAD_FIELD_ERROR');
    const invalid = jest.fn().mockRejectedValue(permanent);
    await expect(DbRetry.read(invalid)).rejects.toBe(permanent);
    expect(invalid).toHaveBeenCalledTimes(1);
  });

  it('does not replay review or password write transactions on a connection reset', async () => {
    const { admin, token } = await account();
    const stored = await post(null, '');
    jest.spyOn(Logger, 'error').mockImplementation(() => undefined);
    const originalSave = EntityManager.prototype.save;
    const save = jest.spyOn(EntityManager.prototype, 'save').mockImplementation(function (this: EntityManager, target: any, ...args: any[]) {
      if (target === Post) return Promise.reject(disconnected());
      return Reflect.apply(originalSave, this, [target, ...args]);
    } as any);
    await request(app.getHttpServer()).post(`/api/v1/admin/posts/${stored.id}/review`).set('Authorization', auth(token)).send({ status: 'approved' }).expect(500);
    expect(save.mock.calls.filter(([target]) => target === Post)).toHaveLength(1);
    expect((await source.getRepository(Post).findOneByOrFail({ id: stored.id })).status).toBe('pending');
    save.mockRestore();
    const originalUpdate = EntityManager.prototype.update;
    const update = jest.spyOn(EntityManager.prototype, 'update').mockImplementation(function (this: EntityManager, target: any, ...args: any[]) {
      if (target === AdminAccount) return Promise.reject(disconnected());
      return Reflect.apply(originalUpdate, this, [target, ...args]);
    } as any);
    await change(token, password, 'UncommittedPrivate!2026').expect(500);
    expect(update.mock.calls.filter(([target]) => target === AdminAccount)).toHaveLength(1);
    expect(await bcrypt.compare(password, (await source.getRepository(AdminAccount).findOneByOrFail({ id: admin.id })).passwordHash)).toBe(true);
    expect(await source.getRepository(AuditLog).countBy({ adminId: admin.id, action: 'admin.password.change' })).toBe(0);
    await get(token, 'me').expect(200);
  });

  it('revokes a frozen account on every guarded route, including legacy management routes', async () => {
    const { admin, token } = await account();
    await source.getRepository(AdminAccount).update(admin.id, { status: 'disabled' });
    for (const path of ['me', 'dashboard', 'posts', 'schools', 'invites', 'routes', 'knowledge', 'users', 'posts/missing/media']) await get(token, path).expect(403);
    await change(token, password, 'AnotherLocal!2026').expect(403);
  });

  it('uses current role and school instead of stale token claims across all admin endpoints', async () => {
    const { admin, token } = await account();
    const first = await post(schoolA, 'https://images.example.com/a.jpg');
    const second = await post(schoolB, 'https://images.example.com/b.jpg');
    await source.getRepository(AdminAccount).update(admin.id, { role: 'reviewer', schoolId: schoolA });
    const me = (await get(token, 'me').expect(200)).body.data;
    expect(me).toEqual({ id: admin.id, username: admin.username, role: 'reviewer', schoolId: schoolA });
    for (const path of ['invites', 'routes', 'knowledge', 'users']) await get(token, path).expect(403);
    await request(app.getHttpServer()).post('/api/v1/admin/posts').set('Authorization', auth(token)).send({}).expect(403);
    expect((await get(token, 'posts').expect(200)).body.data.map((item: Post) => item.id)).toEqual([first.id]);
    await get(token, `posts/${second.id}/media`).expect(403);
    await source.getRepository(AdminAccount).update(admin.id, { schoolId: schoolB });
    expect((await get(token, 'posts').expect(200)).body.data.map((item: Post) => item.id)).toEqual([second.id]);
    await get(token, `posts/${first.id}/media`).expect(403);
    await get(token, `posts/${second.id}/media`).expect(200);
  });

  it('requires legacy admin tokens to reauthenticate and keeps user tokens distinct', async () => {
    const { admin } = await account();
    await get(createToken({ id: admin.id, kind: 'admin', role: 'super_admin' }), 'me').expect(401);
    await get(createToken({ id: admin.id, kind: 'user' }), 'me').expect(401);
  });

  it('changes only the authenticated account password, audits no credentials, and invalidates all old tokens', async () => {
    const { admin, token } = await account();
    const secondToken = (await login(admin.username).expect(201)).body.data.token;
    const next = 'UpdatedPrivate!2026';
    await change(token, password, 'short!A1').expect(400);
    await change(token, password, 'NoSymbolPassword123').expect(400);
    await change(token, 'WrongPrivate!2026', next).expect(403);
    await change(token, password, password).expect(400);
    const response = await change(token, password, next).expect(201);
    expect(response.body.data).toEqual({ passwordChanged: true, reauthenticate: true });
    const updated = await source.getRepository(AdminAccount).findOneByOrFail({ id: admin.id });
    expect(await bcrypt.compare(next, updated.passwordHash)).toBe(true);
    expect(await bcrypt.compare(password, updated.passwordHash)).toBe(false);
    for (const old of [token, secondToken]) {
      await get(old, 'me').expect(401);
      await get(old, 'invites').expect(401);
    }
    const audit = await source.getRepository(AuditLog).findOneByOrFail({ adminId: admin.id, action: 'admin.password.change' });
    expect(audit.resourceId).toBe(admin.id);
    expect(audit.detail).toBe('');
    expect(JSON.stringify(audit)).not.toContain(password);
    expect(JSON.stringify(audit)).not.toContain(next);
    expect(JSON.stringify(audit)).not.toContain(updated.passwordHash);
    await login(admin.username, password).expect(403);
    const fresh = await login(admin.username, next).expect(201);
    await get(fresh.body.data.token, 'me').expect(200);
  });

  it('rolls back review, edit, and event creation if their audit record cannot be saved', async () => {
    const { token } = await account();
    const stored = await post(null, '');
    const originalSave = EntityManager.prototype.save;
    jest.spyOn(Logger, 'error').mockImplementation(() => undefined);
    jest.spyOn(EntityManager.prototype, 'save').mockImplementation(function (this: EntityManager, target: any, ...args: any[]) {
      if (target === AuditLog) return Promise.reject(new Error('injected audit persistence failure'));
      return Reflect.apply(originalSave, this, [target, ...args]);
    } as any);
    await request(app.getHttpServer()).post(`/api/v1/admin/posts/${stored.id}/review`).set('Authorization', auth(token)).send({ status: 'approved' }).expect(500);
    expect(await source.getRepository(Post).findOneByOrFail({ id: stored.id })).toMatchObject({ status: 'pending', reviewedBy: null });
    await request(app.getHttpServer()).patch(`/api/v1/admin/posts/${stored.id}`).set('Authorization', auth(token)).send({ title: '不应提交的改动', status: 'approved' }).expect(500);
    expect(await source.getRepository(Post).findOneByOrFail({ id: stored.id })).toMatchObject({ title: stored.title, status: 'pending', reviewedBy: null });
    const [postCount, eventCount] = await Promise.all([source.getRepository(Post).count(), source.getRepository(Event).count()]);
    await request(app.getHttpServer()).post('/api/v1/admin/posts').set('Authorization', auth(token)).send({
      title: '不应提交的活动', content: '只用于验证活动和审核记录事务回滚', circle: 'city', city: '北京', type: 'event', status: 'pending',
      startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 90000000).toISOString(),
      registrationDeadline: new Date(Date.now() + 3600000).toISOString(), location: '测试活动室', capacity: 20,
    }).expect(500);
    expect(await source.getRepository(Post).count()).toBe(postCount);
    expect(await source.getRepository(Event).count()).toBe(eventCount);
  });

  it('rejects known demonstration credentials in production without issuing a setup token', async () => {
    const { admin } = await account('super_admin', null, DEMO_ADMIN_PASSWORD);
    const strong = await account();
    process.env.NODE_ENV = 'production';
    const blocked = await login(admin.username, DEMO_ADMIN_PASSWORD).expect(403);
    expect(blocked.body.message).toContain('配置管理员密码');
    expect(blocked.body.data).toBeUndefined();
    expect((await login(strong.admin.username).expect(201)).body.data.token).toBeTruthy();
  });

  it('caps concurrent and unknown-account attempts and never lets a correct password bypass the active window', async () => {
    const { admin } = await account();
    const failures = await Promise.all(Array.from({ length: 6 }, () => login(admin.username, 'WrongPrivate!2026')));
    expect(failures.map((response) => response.status).sort()).toEqual([403, 403, 403, 403, 403, 429]);
    await login(admin.username).expect(429);
    for (let i = 0; i < 5; i++) await login(i % 2 ? '  UnknownCase  ' : 'unknowncase').expect(403);
    await login('UNKNOWNCASE').expect(429);
  });

  it('expires failure windows, bounds distinct usernames without evicting their caps, and resets successful accounts', () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const limiter = new AdminLoginLimiter(2, 1000, 2);
    limiter.reserve('a'); limiter.reserve('A'); limiter.reserve('b');
    expect(() => limiter.reserve('a')).toThrow('登录尝试过多');
    expect(() => limiter.reserve('c')).toThrow('登录尝试过多');
    limiter.success('B'); limiter.reserve('c');
    expect(() => limiter.reserve('a')).toThrow('登录尝试过多');
    clock.mockReturnValue(2000);
    expect(() => limiter.reserve('a')).not.toThrow();
    expect(() => limiter.reserve('new')).not.toThrow();
    for (const invalid of [DEMO_ADMIN_PASSWORD, 'onlylowercase123!', 'ONLYUPPERCASE123!', 'NoNumbersHere!', 'NoSymbolsHere123', `Aa1!${'x'.repeat(69)}`, 'Aa1!long\npassword']) expect(validNewAdminPassword(invalid)).toBe(false);
    expect(validNewAdminPassword('PersonEntered!2026')).toBe(true);
  });

  it('returns only a stored HTTPS URL and checks cross-school/public scope before any media network request', async () => {
    const platform = await account();
    const reviewer = await account('reviewer', schoolA);
    const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('unexpected network'));
    const own = await post(schoolA, 'https://images.example.com/a.jpg');
    const other = await post(schoolB, 'cloud://preview-env.bucket/weculture/posts/b.jpg');
    const publicPost = await post(null, 'https://images.example.com/public.jpg');
    const result = await get(reviewer.token, `posts/${own.id}/media?url=https://evil.example.com&fileid=arbitrary`).expect(200);
    expect(result.body.data).toEqual({ url: own.imageUrl, expiresIn: null, expiresAt: null });
    await get(reviewer.token, `posts/${other.id}/media`).expect(403);
    await get(reviewer.token, `posts/${publicPost.id}/media`).expect(403);
    await get(platform.token, `posts/${publicPost.id}/media`).expect(200);
    expect(fetchMock).not.toHaveBeenCalled();
    for (const url of ['http://images.example.com/a.jpg', 'https://user:pass@images.example.com/a.jpg', 'https://127.0.0.1/a.jpg', 'https://localhost/a.jpg', 'https://service.internal/a.jpg', 'javascript:alert(1)', 'data:image/png;base64,AA', 'asset://demo.jpg', 'https://images.example.com\\evil/a.jpg']) {
      const invalid = await post(null, url);
      await get(platform.token, `posts/${invalid.id}/media`).expect(422);
    }
    await get(platform.token, `posts/${(await post(null, '')).id}/media`).expect(404);
  });

  it('allows only the configured cloud environment and exact upload prefix, fails closed while disabled', async () => {
    const { token } = await account();
    const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('unexpected network'));
    const allowed = await post(null, 'cloud://preview-env.bucket/weculture/posts/123-test.jpg');
    await get(token, `posts/${allowed.id}/media`).expect(503);
    process.env.CLOUD_STORAGE_ENV = 'preview-env';
    await get(token, `posts/${allowed.id}/media`).expect(503);
    process.env.CLOUD_STORAGE_PROXY_ENABLED = 'true';
    for (const file of ['cloud://other-env.bucket/weculture/posts/a.jpg', 'cloud://preview-env-other.bucket/weculture/posts/a.jpg', 'cloud://preview-env.bucket/private/a.jpg', 'cloud://preview-env.bucket/weculture/posts/../a.jpg', 'cloud://preview-env.bucket/weculture/posts/%2e%2e.jpg', 'cloud://preview-env.bucket/weculture/posts/a.jpg?token=x']) {
      await get(token, `posts/${(await post(null, file)).id}/media`).expect(422);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the fixed sidecar contract with a timeout and returns a temporary HTTPS preview, ignoring client file IDs', async () => {
    process.env.CLOUD_STORAGE_ENV = 'preview-env'; process.env.CLOUD_STORAGE_PROXY_ENABLED = 'true';
    const { token } = await account();
    const stored = await post(null, 'cloud://preview-env.bucket/weculture/posts/123-test.jpg');
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ errcode: 0, file_list: [{ fileid: stored.imageUrl, status: 0, download_url: 'https://storage.example.com/123-test.jpg?sign=temporary' }] })));
    const result = await get(token, `posts/${stored.id}/media?fileid=cloud://other.bucket/private.jpg`).expect(200);
    expect(result.body.data).toMatchObject({ url: 'https://storage.example.com/123-test.jpg?sign=temporary', expiresIn: 600 });
    expect(Date.parse(result.body.data.expiresAt) - Date.now()).toBeGreaterThan(590_000);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.weixin.qq.com/tcb/batchdownloadfile');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' } });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init?.body as string)).toEqual({ env: 'preview-env', file_list: [{ fileid: stored.imageUrl, max_age: 600 }] });
  });

  it('sanitizes storage errors, wrong echoed file IDs, unsafe downloads and timeouts without leaking signed URLs', async () => {
    process.env.CLOUD_STORAGE_ENV = 'preview-env'; process.env.CLOUD_STORAGE_PROXY_ENABLED = 'true';
    const { token } = await account();
    const stored = await post(null, 'cloud://preview-env.bucket/weculture/posts/private.jpg');
    const fetchMock = jest.spyOn(global, 'fetch');
    for (const response of [
      { errcode: 40001, errmsg: `secret ${stored.imageUrl}`, file_list: [] },
      { errcode: 0, file_list: [{ fileid: 'cloud://other.bucket/private.jpg', status: 0, download_url: 'https://storage.example.com/a.jpg?sign=secret' }] },
      { errcode: 0, file_list: [{ fileid: stored.imageUrl, status: 1, errmsg: 'secret' }] },
      { errcode: 0, file_list: [{ fileid: stored.imageUrl, status: 0, download_url: 'http://storage.example.com/a.jpg?sign=secret' }] },
    ]) {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(response)));
      const failed = await get(token, `posts/${stored.id}/media`).expect(503);
      expect(JSON.stringify(failed.body)).not.toMatch(/secret|cloud:\/\/|sign=/);
    }
    fetchMock.mockRejectedValueOnce(new DOMException('secret fileid', 'AbortError'));
    const timeout = await get(token, `posts/${stored.id}/media`).expect(503);
    expect(timeout.body.message).toContain('暂时不可用');
    expect(JSON.stringify(timeout.body)).not.toContain('secret');
  });
});
