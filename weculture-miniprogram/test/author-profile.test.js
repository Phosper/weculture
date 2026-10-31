const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { authorPath, authorFromPath, authorProfilePath, readAuthorProfile, readAuthorPosts } = require('../utils/authors');
const { safeReturnPath, currentReturnPath, HOME_PATH } = require('../utils/return-path');

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const profile = (extra = {}) => ({ id: 'author-1', nickname: '文化同好', avatarUrl: '', visiblePostCount: 2, ...extra });
const post = (id, extra = {}) => ({ id, title: id, status: 'approved', author: { id: 'author-1', nickname: '文化同好', profileAvailable: true }, ...extra });
const response = (items, extra = {}) => ({ items, page: 1, pageSize: 20, total: items.length, hasMore: false, ...extra });
const event = id => ({ currentTarget: { dataset: { id } } });

function harness(get = async url => url.includes('/posts?') ? response([post('one')]) : profile(), name = 'author') {
  let definition;
  const app = { globalData: { user: { id: 'reader', nickname: '同学', verified: true, school: { id: 'campus-a' } } } };
  const storage = { token: 'reader-token' }, calls = [];
  const wx = { destinations: [], menus: [], refreshStopped: false,
    getStorageSync: key => storage[key], removeStorageSync: key => { delete storage[key]; }, navigateTo: options => wx.destinations.push(options.url),
    redirectTo: options => wx.destinations.push(options.url), reLaunch: options => wx.destinations.push(options.url),
    switchTab: options => wx.destinations.push(options.url), hideShareMenu: options => wx.menus.push(options),
    stopPullDownRefresh: () => { wx.refreshStopped = true; }, showToast() {},
    showModal: options => options.success({ confirm: true }) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages', name, 'index.js'), 'utf8'), {
    Page: value => { definition = value; }, wx, getApp: () => app,
    require: id => {
      if (id.endsWith('/typography')) return { withTypography: value => value };
      if (id.endsWith('/nav')) return { getNavMetrics: () => ({}) };
      if (id.endsWith('/guard')) return { requireLogin: () => app.login ? app.login() : Promise.resolve(app.globalData.user) };
      if (id.endsWith('/api')) return { api: { get: url => { calls.push(url); return get(url); }, post: get } };
      return require(path.resolve(__dirname, '../pages', name, id));
    }
  });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values); } };
  return { page, wx, app, calls, storage };
}

test('author routes are canonical and remain safe through login and verification returns', () => {
  for (const id of ['author-1', 'a_B', 'a'.repeat(80)]) {
    const url = authorPath(id);
    assert.equal(authorFromPath(url), id);
    assert.equal(safeReturnPath(url), url);
    assert.equal(safeReturnPath(encodeURIComponent(url)), url);
    assert.equal(currentReturnPath({ authorId: id }, { route: 'pages/author/index' }), url);
    assert.equal(currentReturnPath({ returnTo: url }, { route: 'pages/verify/index' }), url);
  }
  for (const id of ['', null, {}, '../admin', 'author&schoolId=other', 'a'.repeat(81), '%61uthor']) assert.equal(authorPath(id), '');
  for (const url of ['/pages/author/index', '/pages/author/index?id=good&schoolId=other', '/pages/author/index?id=good#x', '/pages/author/index?id=%2E%2E', '/pages/author/index?id=%E0%A4%A', '/pages/author/index?id=a/b']) assert.equal(safeReturnPath(url), HOME_PATH);
});

test('actual login guard preserves an author deep link and verification restores it', async () => {
  const login = harness(undefined, 'login');
  login.app.globalData.user = null; login.app.ensureLogin = async () => null;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/guard.js'), 'utf8'), {
    module, wx: login.wx, getApp: () => login.app,
    getCurrentPages: () => [{ route: 'pages/author/index', options: { id: 'author-1' } }],
    require: id => require(path.resolve(__dirname, '../utils', id))
  });
  await module.exports.requireLogin({ setData() {} });
  const next = new URL(login.wx.destinations[0], 'https://test.invalid').searchParams.get('next');
  login.app.login = async () => {};
  login.page.onLoad({ next }); await login.page.login();
  assert.equal(login.wx.destinations[1], authorPath('author-1'));
  const verified = harness(async () => ({ id: 'reader', verified: true, school: { id: 'campus-a', name: '学校' } }), 'verify');
  await verified.page.onLoad({ returnTo: encodeURIComponent(authorPath('author-1')) }); await verified.page.submit();
  assert.equal(verified.wx.destinations[0], authorPath('author-1'));
  await verified.page.onLoad({ returnTo: '/pages/author/index?id=author-1&admin=true' });
  assert.equal(verified.page.returnTo, '');
});

test('only available authors can be opened from cards, details and active comments', () => {
  let component; const wx = { destinations: [], navigateTo: value => wx.destinations.push(value.url) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../components/post-card/index.js'), 'utf8'), {
    wx, Component: value => { component = value; },
    require: id => id.endsWith('/api') ? { api: {} } : require(path.resolve(__dirname, '../components/post-card', id))
  });
  for (const author of [{ id: 'author-1', profileAvailable: true }]) {
    component.methods.openAuthor.call({ data: { post: { author } } });
    assert.equal(wx.destinations.at(-1), authorPath('author-1'));
  }
  const count = wx.destinations.length;
  for (const author of [undefined, { id: 'author-1' }, { id: 'platform', profileAvailable: false }, { id: '../bad', profileAvailable: true }]) {
    assert.equal(authorProfilePath(author), '');
    component.methods.openAuthor.call({ data: { post: { author } } });
  }
  assert.equal(wx.destinations.length, count);
  const detail = harness(undefined, 'detail');
  detail.page.setData({ post: post('one'), comments: [{ id: 'active', deleted: false, author: { id: 'author-1', profileAvailable: true } }, { id: 'deleted', deleted: true, author: { id: 'author-1', profileAvailable: true } }, { id: 'disabled', deleted: false, author: { id: 'author-1', profileAvailable: false } }] });
  detail.page.openAuthor(); detail.page.openCommentAuthor(event('active')); detail.page.openCommentAuthor(event('deleted')); detail.page.openCommentAuthor(event('disabled'));
  assert.deepEqual(detail.wx.destinations, [authorPath('author-1'), authorPath('author-1')]);
  const cardMarkup = fs.readFileSync(path.join(__dirname, '../components/post-card/index.wxml'), 'utf8');
  const detailMarkup = fs.readFileSync(path.join(__dirname, '../pages/detail/index.wxml'), 'utf8');
  assert.match(cardMarkup, /class="author-link" catchtap="openAuthor"/);
  assert.match(detailMarkup, /catchtap="openCommentAuthor"/);
  assert.match(detailMarkup, /bindtap="replyComment"/);
  assert.match(detailMarkup, /bindtap="deleteComment"/);
});

test('profile requests contain only the requested author and display a valid zero-work profile', async () => {
  const { page, calls, wx } = harness(async url => url.includes('/posts?') ? response([]) : profile({ visiblePostCount: 0, school: { name: 'private' } }));
  page.onLoad({ id: 'author-1' }); await page.onShow();
  assert.deepEqual(calls, ['/users/author-1', '/users/author-1/posts?page=1&pageSize=20']);
  assert.equal(page.data.author.visiblePostCount, 0); assert.equal(page.data.page, 1);
  assert.equal(page.data.posts.length, 0); assert.equal(page.data.error, '');
  assert.equal(Object.hasOwn(page.data.author, 'school'), false);
  assert.equal(page.onShareAppMessage, undefined); assert.ok(wx.menus.length > 0);
  const markup = fs.readFileSync(path.join(__dirname, '../pages/author/index.wxml'), 'utf8');
  assert.match(markup, /暂时没有可见作品/); assert.match(markup, /公开内容/);
});

test('pagination deduplicates posts, ignores repeated taps, and retries the failed next page', async () => {
  const pending = deferred(); let attempt = 0;
  const { page, calls } = harness(async url => {
    if (!url.includes('/posts?')) return profile();
    if (url.includes('page=1&')) return response([post('two'), post('one')], { total: 3, hasMore: true });
    if (++attempt === 1) throw new Error('网络失败');
    return pending.promise;
  });
  page.onLoad({ id: 'author-1' }); await page.onShow(); await page.loadMore();
  assert.equal(page.data.page, 1); assert.match(page.data.error, /网络失败/);
  const loading = page.retry(); const duplicate = page.loadMore();
  assert.equal(calls.length, 4);
  pending.resolve(response([post('one'), post('zero')], { page: 2, total: 3 })); await Promise.all([loading, duplicate]);
  assert.deepEqual(Array.from(page.data.posts, value => value.id), ['two', 'one', 'zero']);
  assert.equal(page.data.page, 2); assert.equal(page.data.hasMore, false); assert.equal(page.data.error, '');
});

test('profile and work errors can retry, while unavailable authors clear prior data', async () => {
  let attempt = 0;
  const { page } = harness(async url => {
    if (!url.includes('/posts?')) { if (++attempt === 1) throw new Error('暂时断网'); return profile(); }
    return response([post('one')], { total: 2, hasMore: true });
  });
  page.onLoad({ id: 'author-1' }); await page.onShow(); assert.equal(page.data.author, null);
  await page.retry(); assert.equal(page.data.posts.length, 1);
  const unavailable = harness(async url => { if (url.includes('/posts?')) throw Object.assign(new Error('禁用'), { statusCode: 404 }); return profile(); });
  unavailable.page.onLoad({ id: 'author-1' }); await unavailable.page.onShow();
  assert.equal(unavailable.page.data.author, null); assert.equal(unavailable.page.data.posts.length, 0);
  assert.equal(unavailable.page.data.unavailable, true); assert.match(unavailable.page.data.error, /暂不可访问/);
});

test('malformed profiles and unpublished or mismatched work payloads never become visible', async () => {
  for (const value of [null, profile({ id: 'another' }), profile({ nickname: '' }), profile({ visiblePostCount: -1 }), profile({ visiblePostCount: 1.5 }), profile({ profileAvailable: false })]) assert.throws(() => readAuthorProfile(value, 'author-1'));
  for (const value of [response([post('one', { status: 'pending' })]), response([post('one', { author: { id: 'another' } })]), response([post('one', { author: { id: 'author-1', profileAvailable: false } })]), response([], { pageSize: 100 }), response([], { page: 2 }), []]) assert.throws(() => readAuthorPosts(value, 'author-1', 1));
  const { page, calls } = harness(async () => profile({ id: 'another' }));
  page.onLoad({ id: 'author-1' }); await page.onShow();
  assert.equal(calls.length, 1); assert.equal(page.data.author, null); assert.match(page.data.error, /作者资料/);
});

test('hiding immediately clears all profile content and late old requests cannot refill it', async () => {
  for (const phase of ['profile', 'posts']) {
    const pending = deferred(), started = deferred();
    const { page } = harness(url => {
      if ((phase === 'profile') === !url.includes('/posts?')) { started.resolve(); return pending.promise; }
      return Promise.resolve(profile());
    });
    page.onLoad({ id: 'author-1' }); const loading = page.onShow(); await started.promise; page.onHide();
    assert.equal(page.data.author, null); assert.equal(page.data.posts.length, 0);
    pending.resolve(phase === 'profile' ? profile() : response([post('old')])); await loading;
    assert.equal(page.data.author, null); assert.equal(page.data.posts.length, 0); assert.equal(page.data.loading, false);
  }
});

test('account, token and membership changes invalidate in-flight or already loaded content', async () => {
  for (const mode of ['account', 'token', 'verified', 'school']) {
    const pending = deferred(), started = deferred();
    const { page, app, storage } = harness(url => {
      if (!url.includes('/posts?')) return Promise.resolve(profile());
      started.resolve(); return pending.promise;
    });
    page.onLoad({ id: 'author-1' }); const loading = page.onShow(); await started.promise;
    if (mode === 'account') app.globalData.user.id = 'another';
    if (mode === 'token') storage.token = 'another-token';
    if (mode === 'verified') app.globalData.user.verified = false;
    if (mode === 'school') app.globalData.user.school.id = 'campus-b';
    pending.resolve(response([post('old-campus')])); await loading;
    assert.equal(page.data.author, null); assert.equal(page.data.posts.length, 0); assert.equal(page.data.loading, false);
    assert.match(page.data.error, /状态已变化/);
  }
  const { page, app } = harness();
  page.onLoad({ id: 'author-1' }); await page.onShow(); app.globalData.user.verified = false;
  await page.loadMore(); assert.equal(page.data.author, null); assert.equal(page.data.posts.length, 0);
});

test('a previous visit cannot replace a new visit, and invalid links or delayed login do not fetch', async () => {
  const pending = deferred(), started = deferred(); let reads = 0;
  const { page, calls } = harness(url => {
    if (!url.includes('/posts?')) { if (++reads === 1) { started.resolve(); return pending.promise; } return Promise.resolve(profile()); }
    return Promise.resolve(response([post('current')]));
  });
  page.onLoad({ id: 'author-1' }); const old = page.onShow(); await started.promise;
  page.onHide(); await page.onShow(); pending.resolve(profile({ nickname: 'old' })); await old;
  assert.equal(page.data.author.nickname, '文化同好'); assert.equal(page.data.posts[0].id, 'current');
  const count = calls.length; page.onLoad({ id: '../bad' }); await page.onShow(); assert.equal(calls.length, count);
  const login = deferred(), delayed = harness(); delayed.app.login = () => login.promise;
  delayed.page.onLoad({ id: 'author-1' }); const showing = delayed.page.onShow(); delayed.page.onHide(); login.resolve(delayed.app.globalData.user); await showing;
  assert.equal(delayed.calls.length, 0);
});

test('pull-to-refresh releases its spinner after failure and school verification keeps the author target', async () => {
  const { page, wx } = harness(async () => { throw new Error('断网'); });
  page.onLoad({ id: 'author-1' }); await page.onShow(); await page.onPullDownRefresh();
  assert.equal(wx.refreshStopped, true); assert.equal(page.data.loading, false);
  page.toVerify();
  assert.equal(new URL(wx.destinations[0], 'https://test.invalid').searchParams.get('returnTo'), authorPath('author-1'));
});

test('login from an older account cannot start an author request for the new session', async () => {
  const login = deferred(), { page, app, calls } = harness();
  const oldUser = { ...app.globalData.user };
  app.login = () => login.promise;
  page.onLoad({ id: 'author-1' }); const loading = page.onShow();
  app.globalData.user = { id: 'other-reader', verified: false };
  login.resolve(oldUser); await loading;
  assert.equal(calls.length, 0); assert.equal(page.data.user, null); assert.equal(page.data.loading, false);
  assert.match(page.data.error, /登录状态已变化/);
});

test('expired author access clears only its own token and retries through the real login guard', async () => {
  const { page, app, wx, storage } = harness(async url => {
    if (!url.includes('/posts?')) return profile();
    if (url.includes('page=1&')) return response([post('one')], { total: 2, hasMore: true });
    throw Object.assign(new Error('expired'), { statusCode: 401 });
  });
  page.onLoad({ id: 'author-1' }); await page.onShow(); await page.loadMore();
  assert.equal(storage.token, undefined); assert.equal(app.globalData.user, null);
  assert.equal(page.data.author, null); assert.equal(page.data.posts.length, 0); assert.equal(page.data.loading, false);
  assert.match(page.data.error, /登录已过期/);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/guard.js'), 'utf8'), {
    module, wx, getApp: () => app,
    getCurrentPages: () => [{ route: 'pages/author/index', options: { id: 'author-1' } }],
    require: id => require(path.resolve(__dirname, '../utils', id))
  });
  app.ensureLogin = async () => null;
  app.login = () => module.exports.requireLogin(page);
  await page.retry();
  const destination = new URL(wx.destinations[0], 'https://test.invalid');
  assert.equal(destination.pathname, '/pages/login/index');
  assert.equal(destination.searchParams.get('next'), authorPath('author-1'));

  const pending = deferred(), started = deferred();
  const newer = harness(url => {
    if (!url.includes('/posts?')) return Promise.resolve(profile());
    started.resolve(); return pending.promise;
  });
  newer.page.onLoad({ id: 'author-1' }); const old = newer.page.onShow(); await started.promise;
  newer.app.globalData.user = { id: 'new-reader', verified: false };
  newer.storage.token = 'new-token';
  pending.reject(Object.assign(new Error('old expired'), { statusCode: 401 })); await old;
  assert.equal(newer.storage.token, 'new-token'); assert.equal(newer.app.globalData.user.id, 'new-reader');
  assert.equal(newer.page.data.author, null); assert.equal(newer.page.data.posts.length, 0);
});
