import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { DataSource } from 'typeorm';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createToken } from '../src/auth';
import { ApiErrorFilter, ResponseInterceptor } from '../src/common';
import { Post, School, SchoolMembership, User } from '../src/entities';

jest.setTimeout(30_000);

describe('Comments through the actual mini-program detail and local HTTP API', () => {
  let app: INestApplication, source: DataSource;
  let author: any, reader: any, outsider: any;
  let schoolId: string, sequence = 0;
  const miniRoot = resolve(__dirname, '../../weculture-miniprogram');
  const identity = async (name: string) => {
    const user = await source.getRepository(User).save({ wechatOpenId: `comment-client-${name}`, nickname: `${name}同学` });
    return { user: { id: user.id, nickname: user.nickname, verified: true }, token: createToken({ id: user.id, kind: 'user' }) };
  };
  const fixture = (campus = false) => source.getRepository(Post).save({
    authorId: author.user.id, circle: campus ? 'campus' : 'city', city: campus ? null : '北京',
    schoolId: campus ? schoolId : null, visibility: campus ? 'school' : 'platform', status: 'approved',
    type: 'dynamic', title: `跨层评论回归${++sequence}`, content: '真实详情页面与隔离HTTP API联调。', tag: '文化',
  });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = 'comments-client-local-test-secret'; process.env.SEED_DEMO_DATA = 'false';
    const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor()); app.useGlobalFilters(new ApiErrorFilter());
    await app.init(); source = app.get(DataSource);
    author = await identity('作者'); reader = await identity('读者'); outsider = await identity('外校');
    schoolId = (await source.getRepository(School).save({ name: '评论跨层甲校', shortName: 'COMMENT_CLIENT_A' })).id;
    const otherSchool = (await source.getRepository(School).save({ name: '评论跨层乙校', shortName: 'COMMENT_CLIENT_B' })).id;
    await source.getRepository(SchoolMembership).save([
      { userId: author.user.id, schoolId }, { userId: reader.user.id, schoolId }, { userId: outsider.user.id, schoolId: otherSchool },
    ]);
  });
  afterAll(async () => { await app?.close(); });

  function detail(account: any) {
    let definition: any;
    const state = { globalData: { user: account.user } };
    const calls: Array<{ method: string; path: string; body: any }> = [];
    const reads: Promise<any>[] = [];
    let lostResponse = false;
    const invoke = async (method: 'get' | 'post' | 'delete', path: string, body?: any) => {
      calls.push({ method, path, body });
      let pending = request(app.getHttpServer())[method](`/api/v1${path}`).set('Authorization', `Bearer ${account.token}`);
      if (body !== undefined) pending = pending.send(body);
      const response = await pending;
      if (response.status >= 400) throw Object.assign(new Error(response.body.message), { statusCode: response.status });
      if (lostResponse && method === 'post' && path.endsWith('/comments')) { lostResponse = false; throw new Error('网络中断，未收到发送结果'); }
      return response.body.data;
    };
    const wx = {
      getStorageSync: (key: string) => key === 'token' ? account.token : '',
      showToast() {}, showShareMenu() {}, hideShareMenu() {}, navigateTo() {},
      showModal: (options: any) => options.success({ confirm: true }),
    };
    // Execute the actual CommonJS utilities outside Jest's project-local resolver.
    const modules = new Map<string, any>();
    const miniRequire = (id: string, directory = resolve(miniRoot, 'pages/detail')): any => {
      const filename = resolve(directory, `${id}.js`);
      if (modules.has(filename)) return modules.get(filename).exports;
      const module = { exports: {} }; modules.set(filename, module);
      runInNewContext(readFileSync(filename, 'utf8'), { module, exports: module.exports, wx, getApp: () => state,
        require: (next: string) => miniRequire(next, dirname(filename)) });
      return module.exports;
    };
    runInNewContext(readFileSync(resolve(miniRoot, 'pages/detail/index.js'), 'utf8'), {
      Page: (value: any) => { definition = value; }, getApp: () => state, wx,
      require: (id: string) => {
        if (id.endsWith('/typography')) return { withTypography: (value: any) => value };
        if (id.endsWith('/guard')) return { requireLogin: async () => state.globalData.user };
        if (id.endsWith('/api')) return { api: { get: (path: string) => invoke('get', path), post: (path: string, body: any) => invoke('post', path, body), delete: (path: string) => invoke('delete', path) } };
        return miniRequire(id);
      },
    });
    const page: any = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values: any) {
      for (const [key, value] of Object.entries(values)) {
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.'); let target = this.data;
        while (parts.length > 1) { const next = parts.shift()!; if (!target[next]) target[next] = {}; target = target[next]; }
        target[parts[0]] = value;
      }
    } };
    const originalRead = page.loadComments;
    page.loadComments = function (...args: any[]) { const reading = Promise.resolve(originalRead.apply(this, args)); reads.push(reading); return reading; };
    const settle = async () => { while (reads.length) await Promise.all(reads.splice(0)); };
    const open = async (id: string) => { page.onLoad({ id }); await page.onShow(); await settle(); };
    const submit = async (content: string) => { page.commentInput({ detail: { value: content } }); await page.submitComment(); await settle(); };
    return { page, calls, state, settle, open, submit, loseNextResponse: () => { lostResponse = true; } };
  }

  it('publishes a comment and reply, then erases only the deleted body while preserving reply context', async () => {
    const post = await fixture();
    const first = detail(author); await first.open(post.id); await first.submit('欢迎分享你的文化体验');
    expect(first.page.data.commentCount).toBe(1);
    const parent = first.page.data.comments.find((item: any) => item.content === '欢迎分享你的文化体验');
    expect(parent).toMatchObject({ isPostAuthor: true, canDelete: true, deleted: false });
    const second = detail(reader); await second.open(post.id);
    second.page.replyComment({ currentTarget: { dataset: { id: parent.id } } }); await second.submit('下次我也想参加');
    expect(second.page.data.commentCount).toBe(2);
    expect(second.page.data.comments.find((item: any) => item.content === '下次我也想参加').parent).toMatchObject({ id: parent.id, deleted: false });
    await first.page.loadComments(); await first.page.deleteComment({ currentTarget: { dataset: { id: parent.id } } }); await first.settle();
    expect(first.page.data.commentCount).toBe(1);
    const deleted = first.page.data.comments.find((item: any) => item.id === parent.id);
    expect(deleted).toMatchObject({ content: '', deleted: true, canDelete: false, canReply: false });
    expect(first.page.data.comments.find((item: any) => item.content === '下次我也想参加').parent).toMatchObject({ id: parent.id, deleted: true });
    expect(JSON.stringify(first.page.data.comments)).not.toContain('欢迎分享你的文化体验');
  });

  it('reuses the same request identity when the server committed but the client lost its response', async () => {
    const post = await fixture(); const client = detail(reader); await client.open(post.id);
    client.loseNextResponse(); await client.submit('只创建一次的评论');
    expect(client.page.data.commentContent).toBe('只创建一次的评论');
    expect(client.page.data.commentError).toBeTruthy();
    await client.page.submitComment(); await client.settle();
    const writes = client.calls.filter(call => call.method === 'post' && call.path.endsWith('/comments'));
    expect(writes).toHaveLength(2);
    expect(writes[1].body.clientRequestId).toBe(writes[0].body.clientRequestId);
    expect(client.page.data.commentCount).toBe(1);
    expect(client.page.data.comments.filter((item: any) => item.content === '只创建一次的评论')).toHaveLength(1);
    expect(client.page.data.commentContent).toBe('');
  });

  it('keeps the original reply request when its parent was deleted after the reply committed without a response', async () => {
    const post = await fixture(); const first = detail(author); await first.open(post.id); await first.submit('即将删除的原评论');
    const parentId = first.page.data.comments[0].id;
    const second = detail(reader); await second.open(post.id);
    second.page.replyComment({ currentTarget: { dataset: { id: parentId } } }); second.loseNextResponse(); await second.submit('只保留一条的回复');
    await first.page.deleteComment({ currentTarget: { dataset: { id: parentId } } }); await first.settle();
    await second.page.loadComments(); await second.settle();
    await second.page.submitComment(); await second.settle();
    const writes = second.calls.filter(call => call.method === 'post' && call.path.endsWith('/comments'));
    expect(writes).toHaveLength(2);
    expect(writes[1].body).toEqual(writes[0].body);
    expect(second.page.data.commentCount).toBe(1);
    expect(second.page.data.comments.filter((item: any) => item.content === '只保留一条的回复')).toHaveLength(1);
    expect(second.page.data.comments.find((item: any) => item.content === '只保留一条的回复').parent).toMatchObject({ id: parentId, deleted: true });
  });

  it('clears comments and protected detail when a school post is taken offline, and never opens it for another school', async () => {
    const post = await fixture(true); const client = detail(reader); await client.open(post.id); await client.submit('校内讨论');
    expect(client.page.data.comments).toHaveLength(1);
    const denied = detail(outsider); await denied.open(post.id);
    expect(denied.page.data.post).toBeNull(); expect(denied.page.data.comments).toHaveLength(0);
    expect(denied.calls.some(call => call.path.includes('/comments'))).toBe(false);
    await source.getRepository(Post).update(post.id, { status: 'offline' });
    await client.page.loadComments(); await client.settle();
    expect(client.page.data.comments).toHaveLength(0); expect(client.page.data.commentContent).toBe('');
    expect(client.page.data.post).toBeNull(); expect(client.page.data.canShare).toBe(false);
  });
});
