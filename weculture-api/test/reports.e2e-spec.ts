import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { DataSource } from 'typeorm';
import { adminAuthVersion, createToken } from '../src/auth';
import { ApiErrorFilter, ResponseInterceptor } from '../src/common';
import { AdminAccount, AuditLog, ContentReport, Post, PostComment, School, SchoolMembership, User } from '../src/entities';

jest.setTimeout(30_000);

type Account = { id: string; token: string };
type Admin = { id: string; token: string; role: 'super_admin' | 'operator' | 'reviewer'; schoolId: string | null };
type Role = Admin['role'];

describe('Content reports', () => {
  let app: INestApplication, source: DataSource;
  let author: Account, reader: Account, outsider: Account, unverified: Account, sameSchool: Account, schoolBOther: Account;
  let schoolA: string, schoolB: string;
  let superAdmin: Admin, schoolAAdmin: Admin, schoolAReviewer: Admin, schoolBAdmin: Admin;
  let platformPost: Post, campusPostA: Post, campusPostB: Post, commentOnA: PostComment;
  let sequence = 0;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const report = (token: string, body: unknown) => request(app.getHttpServer()).post('/api/v1/reports').set(auth(token)).send(body as any);
  const list = (token: string, query = '') => request(app.getHttpServer()).get(`/api/v1/admin/reports${query}`).set(auth(token));
  const resolve = (token: string, id: string, body: unknown) => request(app.getHttpServer()).post(`/api/v1/admin/reports/${id}/resolve`).set(auth(token)).send(body as any);
  const dashboard = (token: string) => request(app.getHttpServer()).get('/api/v1/admin/dashboard').set(auth(token));
  const account = async (name: string): Promise<Account> => {
    const user = await source.getRepository(User).save({ wechatOpenId: `reports-${name}`, nickname: `${name}同学` });
    return { id: user.id, token: createToken({ id: user.id, kind: 'user' }) };
  };
  const admin = async (name: string, role: Role, schoolId: string | null): Promise<Admin> => {
    const passwordHash = `reports-password-${name}`;
    const row = await source.getRepository(AdminAccount).save({ username: name, passwordHash, role, schoolId });
    return { id: row.id, role, schoolId, token: createToken({ id: row.id, kind: 'admin', role, schoolId, authVersion: adminAuthVersion(passwordHash) }) };
  };
  const post = (values: Partial<Post> = {}) => source.getRepository(Post).save({
    title: `举报测试 ${++sequence}`, content: '举报治理回归内容', authorId: author.id,
    type: 'dynamic', status: 'approved', visibility: 'platform', circle: 'city', city: '北京', schoolId: null, ...values,
  });
  const comment = (postId: string, authorId: string, content = '举报治理回归评论') => source.getRepository(PostComment).save({
    postId, authorId, parentId: null, content, deleted: false,
    clientRequestId: `report-comment-${++sequence}`, clientRequestHash: 'a'.repeat(64), submissionHash: 'b'.repeat(64),
  });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = 'reports-isolated-test-secret'; process.env.SEED_DEMO_DATA = 'false';
    const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor()); app.useGlobalFilters(new ApiErrorFilter());
    await app.init(); source = app.get(DataSource);
    const schools = await source.getRepository(School).save([
      { name: '举报测试甲校', shortName: 'REPORTS_A' },
      { name: '举报测试乙校', shortName: 'REPORTS_B' },
    ]);
    schoolA = schools[0].id; schoolB = schools[1].id;
    author = await account('作者'); reader = await account('读者'); outsider = await account('外校'); unverified = await account('未认证'); sameSchool = await account('同校'); schoolBOther = await account('乙校作者');
    await source.getRepository(SchoolMembership).save([
      { userId: author.id, schoolId: schoolA }, { userId: reader.id, schoolId: schoolA },
      { userId: sameSchool.id, schoolId: schoolA }, { userId: outsider.id, schoolId: schoolB },
      { userId: schoolBOther.id, schoolId: schoolB },
    ]);
    superAdmin = await admin('reports-super', 'super_admin', null);
    schoolAAdmin = await admin('reports-operator-a', 'operator', schoolA);
    schoolAReviewer = await admin('reports-reviewer-a', 'reviewer', schoolA);
    schoolBAdmin = await admin('reports-operator-b', 'operator', schoolB);
    platformPost = await post();
    campusPostA = await post({ authorId: author.id, visibility: 'school', circle: 'campus', city: null, schoolId: schoolA });
    campusPostB = await post({ authorId: outsider.id, visibility: 'school', circle: 'campus', city: null, schoolId: schoolB });
    commentOnA = await comment(campusPostA.id, author.id);
  });
  afterAll(async () => { await app?.close(); });

  it('creates idempotent reports and rejects self or invalid targets', async () => {
    const first = (await report(reader.token, { targetType: 'post', targetId: platformPost.id, reason: 'spam' }).expect(201)).body.data;
    expect(first).toMatchObject({ status: 'pending', duplicate: false });
    const duplicate = (await report(reader.token, { targetType: 'post', targetId: platformPost.id, reason: 'harassment', detail: '补充说明' }).expect(201)).body.data;
    expect(duplicate).toEqual({ ...first, duplicate: true });
    expect((await report(author.token, { targetType: 'post', targetId: platformPost.id, reason: 'spam' }).expect(400)).body.message).toContain('自己');
    await report(reader.token, { targetType: 'post', targetId: 'missing-post', reason: 'spam' }).expect(404);
    await report(reader.token, { targetType: 'post', targetId: platformPost.id, reason: 'other' }).expect(400);
    await report(reader.token, { targetType: 'post', targetId: platformPost.id, reason: 'not-a-reason' }).expect(400);
    expect((await report(unverified.token, { targetType: 'post', targetId: platformPost.id, reason: 'false_info' }).expect(201)).body.data.duplicate).toBe(false);
    expect((await report(reader.token, { targetType: 'comment', targetId: commentOnA.id, reason: 'harassment' }).expect(201)).body.data.status).toBe('pending');
    await report(author.token, { targetType: 'comment', targetId: commentOnA.id, reason: 'spam' }).expect(400);
  });

  it('enforces visibility and school boundaries for posts and comments', async () => {
    await report(outsider.token, { targetType: 'post', targetId: campusPostA.id, reason: 'spam' }).expect(403);
    await report(unverified.token, { targetType: 'post', targetId: campusPostA.id, reason: 'spam' }).expect(403);
    const schoolReport = (await report(reader.token, { targetType: 'post', targetId: campusPostA.id, reason: 'inappropriate' }).expect(201)).body.data;
    expect((await source.getRepository(ContentReport).findOneByOrFail({ id: schoolReport.id })).schoolId).toBe(schoolA);
    await report(reader.token, { targetType: 'post', targetId: campusPostB.id, reason: 'spam' }).expect(403);
    const deleted = await comment(platformPost.id, author.id, '这条评论已被作者删除');
    await source.getRepository(PostComment).update(deleted.id, { deleted: true, content: '' });
    await report(reader.token, { targetType: 'comment', targetId: deleted.id, reason: 'spam' }).expect(409);
    const commentOnB = await comment(campusPostB.id, outsider.id);
    await report(reader.token, { targetType: 'comment', targetId: commentOnB.id, reason: 'spam' }).expect(403);
  });

  it('scopes admin lists by school and closes reports on dismiss and takedown', async () => {
    const postA = await post({ visibility: 'school', circle: 'campus', city: null, schoolId: schoolA });
    const postB = await post({ authorId: schoolBOther.id, visibility: 'school', circle: 'campus', city: null, schoolId: schoolB });
    const platform = await post();
    const reportA1 = (await report(reader.token, { targetType: 'post', targetId: postA.id, reason: 'spam' }).expect(201)).body.data;
    const reportA2 = (await report(sameSchool.token, { targetType: 'post', targetId: postA.id, reason: 'harassment' }).expect(201)).body.data;
    const reportB = (await report(outsider.token, { targetType: 'post', targetId: postB.id, reason: 'spam' }).expect(201)).body.data;
    const reportPlatform = (await report(reader.token, { targetType: 'post', targetId: platform.id, reason: 'false_info' }).expect(201)).body.data;

    const schoolList = (await list(schoolAAdmin.token).expect(200)).body.data;
    expect(schoolList.items.map((item: any) => item.id)).toEqual(expect.arrayContaining([reportA1.id, reportA2.id]));
    expect(schoolList.items.every((item: any) => item.school && item.school.id === schoolA)).toBe(true);
    expect(schoolList.items.some((item: any) => item.id === reportPlatform.id)).toBe(false);
    expect((await list(schoolBAdmin.token).expect(200)).body.data.items.map((item: any) => item.id)).toEqual([reportB.id]);
    const superList = (await list(superAdmin.token).expect(200)).body.data;
    expect(superList.items.map((item: any) => item.id)).toEqual(expect.arrayContaining([reportA1.id, reportA2.id, reportB.id, reportPlatform.id]));
    expect(superList.items.find((item: any) => item.id === reportPlatform.id).school).toBeNull();
    expect((await list(schoolAReviewer.token).expect(200)).body.data.items.map((item: any) => item.id)).toEqual(expect.arrayContaining([reportA1.id, reportA2.id]));

    await resolve(schoolBAdmin.token, reportA1.id, { action: 'dismiss', reason: '越权' }).expect(403);
    await resolve(schoolAAdmin.token, reportPlatform.id, { action: 'dismiss', reason: '越权' }).expect(403);
    expect((await resolve(schoolAAdmin.token, reportA1.id, { action: 'dismiss', reason: '举报不成立' }).expect(200)).body.data.status).toBe('dismissed');
    expect((await source.getRepository(ContentReport).findOneByOrFail({ id: reportA2.id })).status).toBe('pending');
    expect((await source.getRepository(AuditLog).findOneByOrFail({ resourceId: reportA1.id })).action).toBe('report.dismiss');
    await resolve(schoolAAdmin.token, reportA1.id, { action: 'dismiss', reason: '再次处理' }).expect(409);

    expect((await resolve(schoolAAdmin.token, reportA2.id, { action: 'takedown', reason: '含不当内容' }).expect(200)).body.data.status).toBe('removed');
    const offline = await source.getRepository(Post).findOneByOrFail({ id: postA.id });
    expect(offline.status).toBe('offline');
    expect(offline.rejectionReason).toContain('举报处理');
    expect(await source.getRepository(ContentReport).countBy({ targetType: 'post', targetId: postA.id, status: 'pending' })).toBe(0);
    const removed = (await list(schoolAAdmin.token, '?status=removed').expect(200)).body.data;
    expect(removed.items.map((item: any) => item.id)).toEqual(expect.arrayContaining([reportA2.id]));
    await request(app.getHttpServer()).get(`/api/v1/posts/${postA.id}`).set(auth(reader.token)).expect(404);
    expect((await resolve(superAdmin.token, reportPlatform.id, { action: 'dismiss', reason: '平台内容无问题' }).expect(200)).body.data.status).toBe('dismissed');
  });

  it('keeps deleted comment content out of the admin list after takedown', async () => {
    const postA = await post({ visibility: 'school', circle: 'campus', city: null, schoolId: schoolA });
    const target = await comment(postA.id, author.id, '这条评论应被删除');
    const created = (await report(reader.token, { targetType: 'comment', targetId: target.id, reason: 'harassment' }).expect(201)).body.data;
    expect((await resolve(schoolAAdmin.token, created.id, { action: 'takedown', reason: '评论含骚扰' }).expect(200)).body.data.status).toBe('removed');
    const stored = await source.getRepository(PostComment).findOneByOrFail({ id: target.id });
    expect(stored).toMatchObject({ deleted: true, content: '' });
    const row = (await list(superAdmin.token, '?status=removed&targetType=comment').expect(200)).body.data.items.find((item: any) => item.id === created.id);
    expect(row.target).toMatchObject({ commentDeleted: true, commentExcerpt: '', available: true });
    const comments = (await request(app.getHttpServer()).get(`/api/v1/posts/${postA.id}/comments`).set(auth(reader.token)).expect(200)).body.data.items;
    expect(comments.find((item: any) => item.id === target.id)).toMatchObject({ deleted: true, content: '', canReport: false });
  });

  it('validates admin filters, pagination and resolve input', async () => {
    await list(schoolAAdmin.token, '?pageSize=101').expect(400);
    await list(schoolAAdmin.token, '?status=unknown').expect(400);
    await list(schoolAAdmin.token, '?unknown=1').expect(400);
    await resolve(schoolAAdmin.token, 'missing-report', { action: 'dismiss', reason: '说明' }).expect(404);
    const target = await post();
    const pending = (await report(reader.token, { targetType: 'post', targetId: target.id, reason: 'privacy' }).expect(201)).body.data;
    await resolve(schoolAAdmin.token, pending.id, { action: 'unknown', reason: '说明' }).expect(400);
    await resolve(schoolAAdmin.token, pending.id, { action: 'dismiss' }).expect(400);
    await resolve(schoolAAdmin.token, pending.id, { action: 'dismiss', reason: '  ' }).expect(400);
  });

  it('counts pending reports within the administrator school scope', async () => {
    const schoolPending = await source.getRepository(ContentReport).countBy({ status: 'pending', schoolId: schoolA });
    const allPending = await source.getRepository(ContentReport).countBy({ status: 'pending' });
    expect((await dashboard(schoolAAdmin.token).expect(200)).body.data.pendingReports).toBe(schoolPending);
    expect((await dashboard(superAdmin.token).expect(200)).body.data.pendingReports).toBe(allPending);
  });
});
