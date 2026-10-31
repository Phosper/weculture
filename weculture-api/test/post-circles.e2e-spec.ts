import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AdminAccount, Event, Post, School, SchoolMembership } from '../src/entities';
import { ApiErrorFilter, ResponseInterceptor } from '../src/common';

jest.setTimeout(30_000);

describe('Phase 2 circle classification and isolation', () => {
  let app: INestApplication;
  let source: DataSource;
  let a: string, b: string, guest: string, publicReader: string;
  let admin: string, reviewer: string, operator: string;
  let schoolA: string, schoolB: string, userA: string;
  let campusA: string, campusB: string, cityPost: string, internationalPost: string;
  const auth = (token: string) => `Bearer ${token}`;
  const payload = { title: '圈层隔离回归内容', content: '公开和校园投稿按明确分类进入正确的审核范围。', type: 'dynamic' };
  const send = (token: string, body: object) => request(app.getHttpServer()).post('/api/v1/posts').set('Authorization', auth(token)).send(body);
  const read = (token: string, id: string) => request(app.getHttpServer()).get(`/api/v1/posts/${id}`).set('Authorization', auth(token));
  const feed = (token: string, query: string) => request(app.getHttpServer()).get(`/api/v1/posts${query}`).set('Authorization', auth(token));
  const review = (token: string, id: string, status = 'approved') => request(app.getHttpServer()).post(`/api/v1/admin/posts/${id}/review`).set('Authorization', auth(token)).send({ status, reason: status === 'rejected' ? '请补充来源' : '' });
  const eventFields = () => ({ startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 90000000).toISOString(), registrationDeadline: new Date(Date.now() + 3600000).toISOString(), location: '文化活动室', capacity: 20 });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'circle-regression-secret';
    process.env.SEED_DEMO_DATA = 'true';
    process.env.AUTO_APPROVE = 'true';
    process.env.ADMIN_INITIAL_PASSWORD = 'Weculture@2026';
    process.env.OPERATOR_INITIAL_PASSWORD = 'Weculture@2026';
    process.env.REVIEWER_INITIAL_PASSWORD = 'Weculture@2026';
    const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new ApiErrorFilter());
    await app.init();
    source = app.get(DataSource);
    const school = await source.getRepository(School).findOneByOrFail({ shortName: 'BLCU' });
    schoolA = school.id;
    schoolB = (await source.getRepository(School).save({ name: '第二所测试学校', shortName: 'SCHOOL_B' })).id;
    const login = async (name: string) => (await request(app.getHttpServer()).post('/api/v1/auth/wechat/login').send({ code: `dev-circle-${name}` }).expect(201)).body.data;
    const first = await login('a'), second = await login('b'), third = await login('guest'), fourth = await login('public-reader');
    a = first.token; b = second.token; guest = third.token; publicReader = fourth.token; userA = first.user.id;
    await source.getRepository(SchoolMembership).save([{ userId: first.user.id, schoolId: schoolA }, { userId: second.user.id, schoolId: schoolB }]);
    const adminLogin = async (username: string) => (await request(app.getHttpServer()).post('/api/v1/admin/auth/login').send({ username, password: 'Weculture@2026' }).expect(201)).body.data.token;
    admin = await adminLogin('admin'); reviewer = await adminLogin('blcu-reviewer'); operator = await adminLogin('blcu-operator');
  });
  afterAll(async () => { await app?.close(); });

  it('allows logged unverified public submissions, always pending, and keeps automatic school approval', async () => {
    const city = await send(guest, { ...payload, circle: 'city', city: ' 北京 ' }).expect(201);
    const international = await send(guest, { ...payload, circle: 'international', contentLanguage: 'en' }).expect(201);
    const schoolOne = await send(a, { ...payload, circle: 'campus', schoolId: schoolA }).expect(201);
    const schoolTwo = await send(b, { ...payload, circle: 'campus' }).expect(201);
    cityPost = city.body.data.id; internationalPost = international.body.data.id; campusA = schoolOne.body.data.id; campusB = schoolTwo.body.data.id;
    expect(city.body.data.status).toBe('pending');
    expect(international.body.data.status).toBe('pending');
    expect(schoolOne.body.data.status).toBe('approved');
    expect((await read(guest, cityPost).expect(200)).body.data).toMatchObject({ circle: 'city', city: '北京', contentLanguage: null, schoolId: null, visibility: 'platform' });
    await read(publicReader, cityPost).expect(404);
    await send(guest, payload).expect(403);
    await send(guest, { ...payload, circle: 'campus' }).expect(403);
    await send(a, { ...payload, circle: 'campus', schoolId: schoolB }).expect(403);
    await send(guest, { ...payload, circle: 'city' }).expect(400);
    await send(guest, { ...payload, circle: 'city', city: '北'.repeat(51) }).expect(400);
    await send(guest, { ...payload, circle: 'international', contentLanguage: 'xx' }).expect(400);
    await send(guest, { ...payload, circle: 'international', contentLanguage: 'en', city: '北京' }).expect(400);
    await send(a, { ...payload, circle: 'city', city: '北京', schoolId: schoolA }).expect(400);
    expect((await feed(guest, '?circle=city').expect(200)).body.data.items).toEqual([]);
  });

  it('isolates each school on direct links, filters, likes and favorites', async () => {
    for (const token of [b, guest]) {
      await read(token, campusA).expect(403);
      await request(app.getHttpServer()).post(`/api/v1/posts/${campusA}/likes`).set('Authorization', auth(token)).send({}).expect(403);
      await request(app.getHttpServer()).post(`/api/v1/posts/${campusA}/favorite`).set('Authorization', auth(token)).send({}).expect(403);
      await feed(token, `?circle=campus&schoolId=${schoolA}`).expect(403);
      await feed(token, `?schoolId=${schoolA}`).expect(403);
    }
    await feed(guest, '?circle=campus').expect(403);
    const own = await feed(a, `?circle=campus&schoolId=${schoolA}&type=dynamic&pageSize=100`).expect(200);
    expect(own.body.data.items.some((post: Post) => post.id === campusA)).toBe(true);
    expect(own.body.data.items.every((post: Post) => post.schoolId === schoolA && post.circle === 'campus')).toBe(true);
    const other = await feed(b, '?scope=school').expect(200);
    expect(Array.isArray(other.body.data)).toBe(true);
    expect(other.body.data.some((post: Post) => post.id === campusB)).toBe(true);
    expect(other.body.data.some((post: Post) => post.id === campusA)).toBe(false);
  });

  it('limits school reviewers to their campus and permits platform review of public posts', async () => {
    await review(reviewer, cityPost).expect(403);
    await review(operator, internationalPost).expect(403);
    await review(reviewer, campusB).expect(403);
    await review(reviewer, campusA).expect(201);
    await review(admin, cityPost).expect(201);
    await review(admin, internationalPost).expect(201);
    await read(publicReader, cityPost).expect(200);
    await request(app.getHttpServer()).post(`/api/v1/posts/${cityPost}/likes`).set('Authorization', auth(publicReader)).send({}).expect(201);
    const reviewRows = await request(app.getHttpServer()).get('/api/v1/admin/posts').set('Authorization', auth(reviewer)).expect(200);
    expect(reviewRows.body.data.every((post: Post) => post.schoolId === schoolA && post.circle === 'campus')).toBe(true);
    await request(app.getHttpServer()).get('/api/v1/admin/posts?circle=city').set('Authorization', auth(reviewer)).expect(403);
    await request(app.getHttpServer()).get(`/api/v1/admin/posts?schoolId=${schoolB}`).set('Authorization', auth(operator)).expect(403);
    const platform = await request(app.getHttpServer()).get('/api/v1/admin/posts?circle=city&scope=platform&status=approved').set('Authorization', auth(admin)).expect(200);
    expect(platform.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: cityPost, schoolId: null, circle: 'city' })]));
    const ownSchools = await request(app.getHttpServer()).get('/api/v1/admin/schools').set('Authorization', auth(reviewer)).expect(200);
    expect(ownSchools.body.data.map((school: School) => school.id)).toEqual([schoolA]);
    const allSchools = await request(app.getHttpServer()).get('/api/v1/admin/schools').set('Authorization', auth(admin)).expect(200);
    expect(allSchools.body.data.map((school: School) => school.id)).toEqual(expect.arrayContaining([schoolA, schoolB]));
    const unclassified = await source.getRepository(Post).findOneByOrFail({ title: '非遗扇艺工作坊开放报名' });
    await review(admin, unclassified.id).expect(400);
    await review(admin, unclassified.id, 'offline').expect(201);
    const classify = await request(app.getHttpServer()).patch(`/api/v1/admin/posts/${unclassified.id}`).set('Authorization', auth(admin)).send({ circle: 'city', city: '北京', status: 'pending' }).expect(200);
    expect(classify.body.data).toMatchObject({ circle: 'city', city: '北京', status: 'pending' });
    await review(admin, unclassified.id).expect(201);
    const malformed = await source.getRepository(Post).save({ authorId: 'legacy-admin', title: '错误范围旧投稿', content: '圈层和可见范围必须一致。', type: 'dynamic', status: 'pending', visibility: 'school', circle: 'international', contentLanguage: 'en', schoolId: null });
    await review(admin, malformed.id).expect(400);
    await review(admin, malformed.id, 'rejected').expect(201);
  });

  it('paginates explicit circle/city/type filters and leaves unknown historical content in discovery', async () => {
    const second = await send(guest, { ...payload, title: '圈层隔离回归第二条', circle: 'city', city: '北京' }).expect(201);
    const elsewhere = await send(guest, { ...payload, circle: 'city', city: '上海' }).expect(201);
    await review(admin, second.body.data.id).expect(201);
    await review(admin, elsewhere.body.data.id).expect(201);
    const page = await feed(guest, '?circle=city&city=北京&type=dynamic&page=1&pageSize=1&q=圈层隔离回归').expect(200);
    expect(page.body.data).toMatchObject({ page: 1, pageSize: 1, total: 2, hasMore: true });
    expect(page.body.data.items).toHaveLength(1);
    const next = await feed(guest, '?circle=city&city=北京&type=dynamic&page=2&pageSize=1&q=圈层隔离回归').expect(200);
    expect(next.body.data).toMatchObject({ total: 2, hasMore: false });
    expect(next.body.data.items[0].id).not.toBe(page.body.data.items[0].id);
    const beyond = await feed(guest, '?circle=city&city=北京&type=dynamic&page=3&pageSize=1&q=圈层隔离回归').expect(200);
    expect(beyond.body.data.items).toEqual([]);
    const international = await feed(guest, '?circle=international').expect(200);
    expect(international.body.data.items).toEqual([expect.objectContaining({ id: internationalPost, contentLanguage: 'en' })]);
    const legacy = await feed(guest, '').expect(200);
    const demos = legacy.body.data.filter((post: Post) => post.circle === null);
    expect(demos.length).toBeGreaterThan(0);
    expect(demos).toEqual(expect.arrayContaining([expect.objectContaining({ title: '剪纸艺术进校园，这就是指尖上的中国魅力！', visibility: 'platform', circle: null })]));
    const cityIds = (await feed(guest, '?circle=city&pageSize=100').expect(200)).body.data.items.map((post: Post) => post.id);
    expect(demos.some((post: Post) => cityIds.includes(post.id))).toBe(false);
    expect(Array.isArray(legacy.body.data)).toBe(true);
    await feed(guest, '?circle=city&page=0').expect(400);
    await feed(guest, '?circle=city&pageSize=101').expect(400);
    await feed(guest, '?circle=invalid').expect(400);
    await feed(guest, '?type=invalid').expect(400);
    await feed(guest, '?circle=city&scope=school').expect(400);
  });

  it('matches short and official city names in public and admin filters without crossing city boundaries', async () => {
    const prefix = '城市名称兼容回归';
    const rows = await source.getRepository(Post).save(['北京', '北京市', '广州', '广州市', '上海市', '北京市东城区'].map((city) => ({
      ...payload, type: 'dynamic' as const, title: `${prefix} ${city}`, authorId: 'historical-city-author', circle: 'city' as const, city,
      visibility: 'platform' as const, schoolId: null, status: 'approved' as const,
    })));
    for (const city of ['北京', ' 北京市 ', '广州', '广州市']) {
      const shortCity = city.trim().replace(/市$/, '');
      const expectedIds = rows.filter((post) => [shortCity, `${shortCity}市`].includes(post.city!)).map((post) => post.id).sort();
      const query = `?circle=city&city=${encodeURIComponent(city)}&q=${encodeURIComponent(prefix)}&pageSize=100`;
      const publicRows = await feed(publicReader, query).expect(200);
      const adminRows = await request(app.getHttpServer()).get(`/api/v1/admin/posts${query}`).set('Authorization', auth(admin)).expect(200);
      for (const response of [publicRows, adminRows]) {
        expect(response.body.data.total).toBe(2);
        expect(response.body.data.items.map((post: Post) => post.id).sort()).toEqual(expectedIds);
      }
    }
    expect((await read(publicReader, rows[1].id).expect(200)).body.data.city).toBe('北京市');
  });

  it('keeps autonomous prefecture, prefecture and league names exact', async () => {
    const prefix = '地区完整名称回归';
    const cities = ['阿坝藏族羌族自治州', '阿里地区', '锡林郭勒盟'];
    const rows = await source.getRepository(Post).save(cities.flatMap((city) => [city, `${city}市`]).map((city) => ({
      ...payload, type: 'dynamic' as const, title: `${prefix} ${city}`, authorId: 'historical-region-author', circle: 'city' as const, city,
      visibility: 'platform' as const, schoolId: null, status: 'approved' as const,
    })));
    for (const city of cities) {
      const response = await feed(publicReader, `?circle=city&city=${encodeURIComponent(city)}&q=${encodeURIComponent(prefix)}&pageSize=100`).expect(200);
      expect(response.body.data.total).toBe(1);
      expect(response.body.data.items).toEqual([expect.objectContaining({ id: rows.find((post) => post.city === city)!.id, city })]);
    }
  });

  it('includes circle metadata in request identity and never infers a user circle from a demo title', async () => {
    const cityPayload = { ...payload, title: '剪纸艺术进校园，这就是指尖上的中国魅力！', circle: 'city', city: '北京', clientRequestId: 'circle_replay_123' };
    const [first, second] = await Promise.all([send(guest, cityPayload).expect(201), send(guest, cityPayload).expect(201)]);
    expect(first.body.data).toEqual(second.body.data);
    await send(guest, { ...cityPayload, city: '上海' }).expect(409);
    await send(guest, { ...cityPayload, circle: 'international', city: '', contentLanguage: 'en' }).expect(409);
    const detail = await read(guest, first.body.data.id).expect(200);
    expect(detail.body.data).toMatchObject({ circle: 'city', city: '北京', schoolId: null });
    const internationalPayload = { ...payload, circle: 'international', contentLanguage: 'en', clientRequestId: 'language_replay_123' };
    await send(guest, internationalPayload).expect(201);
    await send(guest, { ...internationalPayload, contentLanguage: 'zh' }).expect(409);
    const oldPayload = { title: '阶段一待审投稿重试', content: '迁移后的校园请求标识仍然能正确重试。', type: 'dynamic', clientRequestId: 'stage1_existing_key' };
    const created = await send(a, oldPayload).expect(201);
    const originalHash = createHash('sha256').update(JSON.stringify({ schoolId: schoolA, type: oldPayload.type, title: oldPayload.title, content: oldPayload.content, tag: '校园动态', imageUrl: '' })).digest('hex');
    await source.getRepository(Post).update(created.body.data.id, { submissionHash: originalHash });
    expect((await send(a, oldPayload).expect(201)).body.data).toEqual(created.body.data);
    await send(a, { ...oldPayload, circle: 'city', city: '北京' }).expect(409);
  });

  it('creates and edits scoped admin posts, clearing irrelevant metadata when switching circles', async () => {
    const write = (token: string, body: object) => request(app.getHttpServer()).post('/api/v1/admin/posts').set('Authorization', auth(token)).send(body);
    const edit = (token: string, id: string, body: object) => request(app.getHttpServer()).patch(`/api/v1/admin/posts/${id}`).set('Authorization', auth(token)).send(body);
    await write(reviewer, { ...payload, circle: 'campus', schoolId: schoolA }).expect(403);
    await write(operator, { ...payload, circle: 'city', city: '北京' }).expect(403);
    await write(operator, { ...payload, circle: 'campus', schoolId: schoolB }).expect(403);
    const own = await write(operator, { ...payload, circle: 'campus', status: 'pending' }).expect(201);
    expect(own.body.data).toMatchObject({ circle: 'campus', schoolId: schoolA, visibility: 'school', status: 'pending' });
    await edit(reviewer, own.body.data.id, { title: '审核员不能编辑正文' }).expect(403);
    await edit(operator, campusB, { title: '校内运营不能改别校' }).expect(403);
    const published = await write(admin, { ...payload, circle: 'campus', schoolId: schoolB }).expect(201);
    const id = published.body.data.id;
    const city = await edit(admin, id, { circle: 'city', city: '上海', status: 'pending' }).expect(200);
    expect(city.body.data).toMatchObject({ circle: 'city', city: '上海', contentLanguage: null, schoolId: null, visibility: 'platform', status: 'pending' });
    const intl = await edit(admin, id, { circle: 'international', contentLanguage: 'fr' }).expect(200);
    expect(intl.body.data).toMatchObject({ circle: 'international', city: null, schoolId: null, contentLanguage: 'fr' });
    const campus = await edit(admin, id, { circle: 'campus', schoolId: schoolA }).expect(200);
    expect(campus.body.data).toMatchObject({ circle: 'campus', city: null, contentLanguage: null, schoolId: schoolA, visibility: 'school' });
    await edit(admin, id, { circle: 'international', contentLanguage: 'en', city: '北京' }).expect(400);
    await edit(admin, id, { type: 'event' }).expect(400);
  });

  it('allows public event registration without school verification and preserves event details on admin metadata edit', async () => {
    const created = await send(guest, { ...payload, type: 'event', circle: 'international', contentLanguage: 'en', ...eventFields() }).expect(201);
    const id = created.body.data.id;
    await review(admin, id).expect(201);
    const detail = await read(publicReader, id).expect(200);
    const event = detail.body.data.event;
    await request(app.getHttpServer()).post(`/api/v1/events/${event.id}/registrations`).set('Authorization', auth(publicReader)).send({}).expect(201);
    const plans = await request(app.getHttpServer()).get('/api/v1/me/plans').set('Authorization', auth(publicReader)).expect(200);
    expect(plans.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: event.id, postId: id, circle: 'international', contentLanguage: 'en', schoolId: null })]));
    const edit = await request(app.getHttpServer()).patch(`/api/v1/admin/posts/${id}`).set('Authorization', auth(admin)).send({ title: '公开活动正文更新', status: 'pending' }).expect(200);
    expect(edit.body.data.event).toMatchObject({ id: event.id, startsAt: event.startsAt, location: event.location, capacity: event.capacity, registeredCount: 1 });
    expect((await request(app.getHttpServer()).get('/api/v1/me/plans').set('Authorization', auth(publicReader)).expect(200)).body.data).toEqual([]);
    await request(app.getHttpServer()).post(`/api/v1/events/${event.id}/registrations`).set('Authorization', auth(publicReader)).send({}).expect(404);
    // An expired event still accepts a metadata-only edit without inventing new dates.
    await source.getRepository(Event).update(event.id, { startsAt: new Date(Date.now() - 7200000), endsAt: new Date(Date.now() - 3600000), registrationDeadline: new Date(Date.now() - 10800000) });
    await request(app.getHttpServer()).patch(`/api/v1/admin/posts/${id}`).set('Authorization', auth(admin)).send({ title: '已结束活动补充来源', status: 'pending' }).expect(200);
  });

  it('prevents campus event access through registration, plans and saved posts after membership revocation', async () => {
    const created = await send(a, { ...payload, type: 'event', circle: 'campus', ...eventFields() }).expect(201);
    const id = created.body.data.id;
    const detail = await read(a, id).expect(200);
    const eventId = detail.body.data.event.id;
    for (const token of [b, guest]) await request(app.getHttpServer()).post(`/api/v1/events/${eventId}/registrations`).set('Authorization', auth(token)).send({}).expect(403);
    await request(app.getHttpServer()).post(`/api/v1/events/${eventId}/registrations`).set('Authorization', auth(a)).send({}).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/posts/${id}/favorite`).set('Authorization', auth(a)).send({}).expect(201);
    await source.getRepository(SchoolMembership).update({ userId: userA, schoolId: schoolA }, { verificationStatus: 'revoked' });
    await read(a, id).expect(403);
    await request(app.getHttpServer()).post(`/api/v1/posts/${id}/likes`).set('Authorization', auth(a)).send({}).expect(403);
    expect((await request(app.getHttpServer()).get('/api/v1/me/plans').set('Authorization', auth(a)).expect(200)).body.data).toEqual([]);
    expect((await request(app.getHttpServer()).get('/api/v1/me/favorites').set('Authorization', auth(a)).expect(200)).body.data).toEqual([]);
    await source.getRepository(SchoolMembership).update({ userId: userA, schoolId: schoolA }, { verificationStatus: 'verified' });
  });

  it('uses current server-side admin scope and excludes other-school counts and audit records', async () => {
    const dashboard = await request(app.getHttpServer()).get('/api/v1/admin/dashboard').set('Authorization', auth(reviewer)).expect(200);
    expect(dashboard.body.data.recentAudits.every((row: { schoolId: string | null }) => row.schoolId === schoolA)).toBe(true);
    const reviewerAccount = await source.getRepository(AdminAccount).findOneByOrFail({ username: 'blcu-reviewer' });
    await source.getRepository(AdminAccount).update(reviewerAccount.id, { status: 'disabled' });
    await request(app.getHttpServer()).get('/api/v1/admin/posts').set('Authorization', auth(reviewer)).expect(403);
    await review(reviewer, campusA).expect(403);
    await source.getRepository(AdminAccount).update(reviewerAccount.id, { status: 'active' });
  });
});
