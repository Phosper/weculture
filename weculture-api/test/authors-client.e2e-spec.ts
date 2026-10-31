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

describe('User search and author pages through the actual client and isolated HTTP API', () => {
  let app: INestApplication, source: DataSource;
  let author: any, local: any, outside: any, guest: any, membershipId: string;
  let publicId: string, campusId: string;
  const miniRoot = resolve(__dirname, '../../weculture-miniprogram');
  const identity = async (name: string, verified: boolean, schoolId?: string) => {
    const user = await source.getRepository(User).save({ wechatOpenId: `authors-client-${name}`, nickname: `${name}文化作者` });
    return { user: { id: user.id, nickname: user.nickname, verified, school: schoolId ? { id: schoolId } : null }, token: createToken({ id: user.id, kind: 'user', schoolId: schoolId || null }) };
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = 'authors-client-local-test-secret'; process.env.SEED_DEMO_DATA = 'false';
    const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor()); app.useGlobalFilters(new ApiErrorFilter());
    await app.init(); source = app.get(DataSource);
    const school = await source.getRepository(School).save({ name: '作者跨层甲校', shortName: 'AUTHOR_CLIENT_A' });
    const other = await source.getRepository(School).save({ name: '作者跨层乙校', shortName: 'AUTHOR_CLIENT_B' });
    author = await identity('青竹', true, school.id); local = await identity('同校', true, school.id);
    outside = await identity('外校', true, other.id); guest = await identity('未认证', false);
    await source.getRepository(SchoolMembership).save({ userId: author.user.id, schoolId: school.id });
    membershipId = (await source.getRepository(SchoolMembership).save({ userId: local.user.id, schoolId: school.id })).id;
    await source.getRepository(SchoolMembership).save({ userId: outside.user.id, schoolId: other.id });
    const post = (status: Post['status'], campus = false) => source.getRepository(Post).save({
      authorId: author.user.id, circle: campus ? 'campus' : 'city', city: campus ? null : '北京',
      schoolId: campus ? school.id : null, visibility: campus ? 'school' : 'platform', status,
      type: 'dynamic', title: `${status}${campus ? '校内' : '公开'}作品`, content: '本地作者页面与HTTP联调。', tag: '文化',
    });
    publicId = (await post('approved')).id; campusId = (await post('approved', true)).id;
    for (const status of ['draft', 'pending', 'rejected', 'offline'] as const) await post(status);
  });
  afterAll(async () => { await app?.close(); });

  function client(route: 'home' | 'author', account: any) {
    let definition: any;
    const state = { globalData: { user: account.user } };
    const calls: string[] = [], destinations: string[] = [];
    const invoke = async (path: string) => {
      calls.push(path);
      const response = await request(app.getHttpServer()).get(`/api/v1${path}`).set('Authorization', `Bearer ${account.token}`);
      if (response.status >= 400) throw Object.assign(new Error(response.body.message), { statusCode: response.status });
      return response.body.data;
    };
    const wx = {
      getStorageSync: (key: string) => key === 'token' ? account.token : '',
      showToast() {}, hideShareMenu() {}, showShareMenu() {}, stopPullDownRefresh() {},
      navigateTo: ({ url }: any) => destinations.push(url), switchTab: ({ url }: any) => destinations.push(url),
    };
    const modules = new Map<string, any>();
    const miniRequire = (id: string, directory: string): any => {
      if (id.endsWith('/typography')) return { withTypography: (value: any) => value };
      if (id.endsWith('/guard')) return { requireLogin: async () => state.globalData.user };
      if (id.endsWith('/nav')) return { getNavMetrics: () => ({}), selectTab() {} };
      if (id.endsWith('/api')) return { api: { get: invoke } };
      const filename = resolve(directory, `${id}.js`);
      if (modules.has(filename)) return modules.get(filename).exports;
      const module = { exports: {} }; modules.set(filename, module);
      runInNewContext(readFileSync(filename, 'utf8'), {
        module, exports: module.exports, wx, getApp: () => state,
        require: (next: string) => miniRequire(next, dirname(filename)),
      });
      return module.exports;
    };
    const filename = resolve(miniRoot, `pages/${route}/index.js`);
    runInNewContext(readFileSync(filename, 'utf8'), {
      Page: (value: any) => { definition = value; }, wx, getApp: () => state,
      require: (id: string) => miniRequire(id, dirname(filename)),
    });
    const page: any = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values: any) { Object.assign(this.data, values); } };
    return { page, calls, destinations, state };
  }
  const event = (key: string, value: string) => ({ currentTarget: { dataset: { [key]: value } } });
  const ids = (page: any) => Array.from(page.data.posts, (post: any) => post.id).sort();
  const open = async (account: any) => { const result = client('author', account); result.page.onLoad({ id: author.user.id }); await result.page.onShow(); return result; };

  it('finds the author by nickname then opens the profile and only its publicly visible works', async () => {
    const home = client('home', guest); await home.page.onShow();
    await home.page.changeSearchMode(event('mode', 'users'));
    home.page.searchInput({ detail: { value: '  青竹  ' } }); await home.page.search();
    expect(home.page.data.users).toHaveLength(1);
    expect(home.page.data.users[0]).toMatchObject({ id: author.user.id, nickname: author.user.nickname, visiblePostCount: 1 });
    home.page.openAuthor(event('id', author.user.id));
    expect(home.destinations).toEqual([`/pages/author/index?id=${author.user.id}`]);
    const profile = await open(guest);
    expect(profile.page.data.author).toMatchObject({ id: author.user.id, visiblePostCount: 1 });
    expect(ids(profile.page)).toEqual([publicId]);
    expect(profile.page.data.posts[0].author.profileAvailable).toBe(true);
    expect(profile.page.data.author).not.toHaveProperty('wechatOpenId');
    expect(profile.page.data.author).not.toHaveProperty('school');
  });

  it('shows the viewer own school works, never other school works or the author own pending previews', async () => {
    const localPage = await open(local), outsidePage = await open(outside), ownPage = await open(author);
    expect(ids(localPage.page)).toEqual([publicId, campusId].sort());
    expect(localPage.page.data.author.visiblePostCount).toBe(2);
    expect(ids(outsidePage.page)).toEqual([publicId]);
    expect(outsidePage.page.data.author.visiblePostCount).toBe(1);
    expect(ids(ownPage.page)).toEqual([publicId, campusId].sort());
    expect(ownPage.page.data.total).toBe(2);
  });

  it('rechecks current membership on returning despite the old school claim in the token', async () => {
    const profile = await open(local);
    expect(ids(profile.page)).toContain(campusId);
    profile.page.onHide();
    await source.getRepository(SchoolMembership).update(membershipId, { verificationStatus: 'revoked' });
    try {
      await profile.page.onShow();
      expect(ids(profile.page)).toEqual([publicId]);
      expect(profile.page.data.author.visiblePostCount).toBe(1);
    } finally { await source.getRepository(SchoolMembership).update(membershipId, { verificationStatus: 'verified' }); }
  });

  it('removes a disabled author profile and its previous list when the page returns', async () => {
    const profile = await open(guest); expect(ids(profile.page)).toEqual([publicId]);
    profile.page.onHide();
    await source.getRepository(User).update(author.user.id, { status: 'disabled' });
    try {
      await profile.page.onShow();
      expect(profile.page.data.author).toBeNull();
      expect(ids(profile.page)).toEqual([]);
      expect(profile.page.data.error).toBeTruthy();
    } finally { await source.getRepository(User).update(author.user.id, { status: 'active' }); }
  });
});
