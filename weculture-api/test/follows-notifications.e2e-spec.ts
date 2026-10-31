import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { DataSource } from 'typeorm';
import { adminAuthVersion, createToken } from '../src/auth';
import { ApiErrorFilter, ResponseInterceptor } from '../src/common';
import { AdminAccount, Event, Follow, Post, School, SchoolMembership, User, UserNotification } from '../src/entities';

jest.setTimeout(30_000);

type Account = { id: string; token: string };
type Admin = { token: string };

describe('Follows and in-app notifications', () => {
  let app: INestApplication, source: DataSource;
  let author: Account, follower: Account, reader: Account;
  let superAdmin: Admin;
  let sequence = 0;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const account = async (name: string): Promise<Account> => {
    const user = await source.getRepository(User).save({ wechatOpenId: `follow-${name}`, nickname: `${name}同学` });
    return { id: user.id, token: createToken({ id: user.id, kind: 'user' }) };
  };
  const admin = async (): Promise<Admin> => {
    const passwordHash = 'follow-admin-password';
    const row = await source.getRepository(AdminAccount).save({ username: 'follow-admin', passwordHash, role: 'super_admin', schoolId: null });
    return { token: createToken({ id: row.id, kind: 'admin', role: 'super_admin', schoolId: null, authVersion: adminAuthVersion(passwordHash) }) };
  };
  const post = (values: Partial<Post> = {}) => source.getRepository(Post).save({
    authorId: author.id, type: 'dynamic', status: 'approved', visibility: 'platform', circle: 'city', city: '北京',
    title: `通知测试 ${++sequence}`, content: '通知测试正文', ...values,
  });
  const follow = (token: string, id: string) => request(app.getHttpServer()).post(`/api/v1/users/${id}/follow`).set(auth(token));
  const unfollow = (token: string, id: string) => request(app.getHttpServer()).delete(`/api/v1/users/${id}/follow`).set(auth(token));
  const notifications = (token: string, query = '') => request(app.getHttpServer()).get(`/api/v1/me/notifications${query}`).set(auth(token));
  const comment = (token: string, postId: string, content: string, parentId?: string) => request(app.getHttpServer()).post(`/api/v1/posts/${postId}/comments`).set(auth(token)).send({ content, clientRequestId: `follow-comment-${++sequence}`, ...(parentId ? { parentId } : {}) });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = 'follows-isolated-test-secret'; process.env.SEED_DEMO_DATA = 'false';
    const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); app.useGlobalInterceptors(new ResponseInterceptor()); app.useGlobalFilters(new ApiErrorFilter());
    await app.init(); source = app.get(DataSource);
    const school = await source.getRepository(School).save({ name: '关注测试学校', shortName: 'FOLLOW' });
    author = await account('作者'); follower = await account('关注者'); reader = await account('读者');
    await source.getRepository(SchoolMembership).save([{ userId: author.id, schoolId: school.id }, { userId: follower.id, schoolId: school.id }]);
    superAdmin = await admin();
  });
  beforeEach(async () => { await source.getRepository(Follow).clear(); await source.getRepository(UserNotification).clear(); });
  afterAll(async () => { await app?.close(); });

  it('follows and unfollows idempotently and exposes the viewer state', async () => {
    expect((await follow(follower.token, author.id).expect(201)).body.data).toEqual({ following: true });
    expect((await follow(follower.token, author.id).expect(201)).body.data).toEqual({ following: true });
    expect((await request(app.getHttpServer()).get(`/api/v1/users/${author.id}`).set(auth(follower.token)).expect(200)).body.data.following).toBe(true);
    expect((await unfollow(follower.token, author.id).expect(200)).body.data).toEqual({ following: false });
    expect((await request(app.getHttpServer()).get(`/api/v1/users/${author.id}`).set(auth(follower.token)).expect(200)).body.data.following).toBe(false);
    await follow(author.token, author.id).expect(400);
    await follow(follower.token, 'missing-user').expect(404);
  });

  it('notifies the post author for comments and the parent author for replies', async () => {
    const target = await post();
    const top = (await comment(reader.token, target.id, '顶层评论').expect(201)).body.data;
    const authorList = (await notifications(author.token).expect(200)).body.data;
    expect(authorList.unreadCount).toBe(1);
    expect(authorList.items).toEqual([expect.objectContaining({ type: 'comment', objectType: 'post', objectId: target.id, postId: target.id, postTitle: target.title, available: true, actor: expect.objectContaining({ id: reader.id }) })]);
    const reply = (await comment(follower.token, target.id, '回复顶层评论', top.id).expect(201)).body.data;
    const readerList = (await notifications(reader.token).expect(200)).body.data;
    expect(readerList.items).toEqual([expect.objectContaining({ type: 'reply', objectType: 'comment', objectId: top.id, postId: target.id, actor: expect.objectContaining({ id: follower.id }) })]);
    expect(readerList.unreadCount).toBe(1);
    expect((await request(app.getHttpServer()).post(`/api/v1/me/notifications/${readerList.items[0].id}/read`).set(auth(reader.token)).expect(201)).body.data).toEqual({ read: true, id: readerList.items[0].id });
    expect((await request(app.getHttpServer()).get('/api/v1/me/notifications/unread-count').set(auth(reader.token)).expect(200)).body.data).toEqual({ count: 0 });
    expect((await request(app.getHttpServer()).post(`/api/v1/me/notifications/${authorList.items[0].id}/read`).set(auth(reader.token)).expect(404)).body.message).toContain('通知');
    expect((await request(app.getHttpServer()).post('/api/v1/me/notifications/read-all').set(auth(author.token)).expect(201)).body.data).toEqual({ count: 1 });
    expect(reply.id).toBeTruthy();
  });

  it('notifies followers once when a post is approved', async () => {
    await follow(follower.token, author.id).expect(201);
    const pending = await post({ status: 'pending' });
    await request(app.getHttpServer()).post(`/api/v1/admin/posts/${pending.id}/review`).set(auth(superAdmin.token)).send({ status: 'approved', reason: '' }).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/admin/posts/${pending.id}/review`).set(auth(superAdmin.token)).send({ status: 'approved', reason: '' }).expect(201);
    const list = (await notifications(follower.token).expect(200)).body.data;
    expect(list.items.filter((item: any) => item.type === 'follow_post' && item.objectId === pending.id)).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ type: 'follow_post', postId: pending.id, postTitle: pending.title, available: true, actor: expect.objectContaining({ id: author.id }) });
  });

  it('notifies registered users on event changes and hides unavailable objects', async () => {
    const eventPost = await post({ type: 'event' });
    const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), end = new Date(start.getTime() + 2 * 60 * 60 * 1000), deadline = new Date(start.getTime() - 60 * 60 * 1000);
    const event = await source.getRepository(Event).save({ postId: eventPost.id, startsAt: start, endsAt: end, registrationDeadline: deadline, location: '原地点', capacity: 10, status: 'active' });
    await request(app.getHttpServer()).post(`/api/v1/events/${event.id}/registrations`).set(auth(reader.token)).expect(201);
    await request(app.getHttpServer()).patch(`/api/v1/admin/posts/${eventPost.id}`).set(auth(superAdmin.token)).send({ eventStatus: 'changed', changeNote: '地点变更', location: '新地点' }).expect(200);
    const list = (await notifications(reader.token).expect(200)).body.data;
    expect(list.items).toEqual([expect.objectContaining({ type: 'event_change', objectType: 'event', objectId: event.id, postId: eventPost.id, postTitle: eventPost.title, available: true })]);
    await source.getRepository(Post).update(eventPost.id, { status: 'offline' });
    expect((await notifications(reader.token).expect(200)).body.data.items[0].available).toBe(false);
  });

  it('requires login and validates pagination', async () => {
    await request(app.getHttpServer()).get('/api/v1/me/notifications').expect(401);
    await notifications(author.token, '?pageSize=51').expect(400);
    await notifications(author.token, '?unknown=1').expect(400);
  });
});
