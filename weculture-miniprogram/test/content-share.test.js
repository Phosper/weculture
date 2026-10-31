const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { contentShare } = require('../utils/share');
const { HOME_PATH, safeReturnPath, currentReturnPath } = require('../utils/return-path');

const approved = changes => ({ id: 'content-123', title: '公开文化活动', status: 'approved', visibility: 'platform', circle: 'city', imageUrl: 'https://example.test/cover.jpg', ...changes });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function harness(name, api = {}) {
  let definition;
  const app = { globalData: { user: { id: 'reader', nickname: '同学', verified: true } }, login: async () => {} };
  const wx = { destinations: [], menus: [], modals: [],
    navigateTo: options => wx.destinations.push(options.url),
    redirectTo: options => wx.destinations.push(options.url),
    reLaunch: options => wx.destinations.push(options.url),
    switchTab: options => wx.destinations.push(options.url),
    showShareMenu: options => wx.menus.push({ show: true, ...options }),
    hideShareMenu: options => wx.menus.push({ show: false, ...options }),
    showModal: options => wx.modals.push(options), showToast() {}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages', name, 'index.js'), 'utf8'), {
    Page: value => { definition = value; }, wx, getApp: () => app,
    require: id => {
      if (id.endsWith('/typography')) return { withTypography: value => value };
      if (id.endsWith('/nav')) return { getNavMetrics: () => ({}) };
      if (id.endsWith('/guard')) return { requireLogin: async () => app.globalData.user };
      if (id.endsWith('/api')) return { api };
      return require(path.resolve(__dirname, '../pages', name, id));
    }
  });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values); } };
  return { page, wx, app };
}

test('public content and activity shares open their exact detail with a cover', () => {
  for (const type of ['dynamic', 'event', 'market']) {
    const payload = contentShare(approved({ type }));
    assert.equal(payload.path, '/pages/detail/index?id=content-123');
    assert.equal(payload.title, '公开文化活动');
    assert.equal(payload.imageUrl, 'https://example.test/cover.jpg');
  }
});

test('campus chat cards do not reveal protected title or image before school authentication', () => {
  for (const scope of [{ circle: 'campus' }, { visibility: 'school' }, { schoolId: 'school-a' }]) {
    const payload = contentShare(approved({ ...scope, title: '校内私密标题', imageUrl: 'https://example.test/private.jpg' }));
    assert.equal(payload.title, '校园圈内容 · 需本校认证后查看');
    assert.equal(payload.imageUrl, '/assets/home-tea.jpg');
    assert.equal(payload.path, '/pages/detail/index?id=content-123');
  }
});

test('unpublished or malformed content cannot be included in a chat card', () => {
  for (const value of [null, approved({ status: 'pending' }), approved({ status: 'rejected' }), approved({ status: 'offline' }), approved({ id: '../private?x=y' })]) {
    const payload = contentShare(value);
    assert.equal(payload.path, HOME_PATH);
    assert.equal(payload.imageUrl, '/assets/home-tea.jpg');
    assert.equal(payload.title, 'Weculture · 发现文化生活');
  }
  assert.equal(contentShare(approved({ imageUrl: 'cloud://temporary' })).imageUrl, '/assets/home-tea.jpg');
});

test('login return targets keep only known pages and the detail identifier', () => {
  assert.equal(safeReturnPath(encodeURIComponent('/pages/detail/index?id=abc-123')), '/pages/detail/index?id=abc-123');
  assert.equal(safeReturnPath('/pages/community/index'), '/pages/community/index');
  for (const value of ['%', '%E0%A4%A', 'https://example.test', '//example.test', '/pages/login/index', '/pages/unknown/index', '/pages/detail/index', '/pages/detail/index?id=abc&schoolId=other', '/pages/detail/index?id=../secret']) {
    assert.equal(safeReturnPath(value), HOME_PATH);
  }
});

test('the actual login guard preserves an incoming share id through the login page', async () => {
  const { page, app, wx } = harness('login');
  app.globalData.user = null;
  app.ensureLogin = async () => null;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/guard.js'), 'utf8'), {
    module, wx, getApp: () => app,
    getCurrentPages: () => [{ route: 'pages/detail/index', options: { id: 'shared-post' } }],
    require: id => require(path.resolve(__dirname, '../utils', id))
  });
  await module.exports.requireLogin({ setData() {} });
  const next = new URL(wx.destinations[0], 'https://isolated.test').searchParams.get('next');
  page.onLoad({ next });
  await page.login();
  assert.equal(wx.destinations[1], '/pages/detail/index?id=shared-post');
  page.onLoad({ next: '%E0%A4%A' });
  assert.equal(page.data.next, HOME_PATH);
});

test('an expired verification session returns through the original detail after login', () => {
  assert.equal(currentReturnPath({ returnTo: '/pages/detail/index?id=shared-post' }, { route: 'pages/verify/index' }), '/pages/detail/index?id=shared-post');
  assert.equal(currentReturnPath({ returnTo: 'https://example.test' }, { route: 'pages/verify/index' }), '/pages/verify/index');
});

test('share menu appears only after a successful approved detail read and hides on leaving', async () => {
  const response = deferred();
  const { page, wx } = harness('detail', { get: () => response.promise });
  page.onLoad({ id: 'content-123' });
  const loading = page.onShow();
  assert.equal(page.data.canShare, false);
  assert.equal(page.onShareAppMessage().path, HOME_PATH);
  response.resolve(approved()); await loading;
  assert.equal(page.data.canShare, true);
  assert.equal(page.onShareAppMessage().path, '/pages/detail/index?id=content-123');
  assert.equal(wx.menus.at(-1).show, true);
  page.onHide();
  assert.equal(page.data.canShare, false);
  assert.equal(page.onShareAppMessage().path, HOME_PATH);
  assert.equal(wx.menus.at(-1).show, false);
});

test('pending author previews, revoked access and account changes never reuse a previous share', async () => {
  let value = approved();
  const { page, app } = harness('detail', { get: async () => { if (value instanceof Error) throw value; return value; } });
  page.onLoad({ id: 'content-123' }); await page.onShow();
  value = approved({ status: 'pending' }); await page.load();
  assert.equal(page.data.canShare, false);
  assert.equal(page.onShareAppMessage().path, HOME_PATH);
  value = approved(); await page.load();
  app.globalData.user = { id: 'different-account' };
  assert.equal(page.onShareAppMessage().path, HOME_PATH);
  value = Object.assign(new Error('无权查看此内容'), { statusCode: 403 }); await page.onShow();
  assert.equal(page.data.post, null);
  assert.equal(page.data.canShare, false);
  app.globalData.user = null; await page.onShow();
  assert.equal(page.onShareAppMessage().path, HOME_PATH);
});

test('invalid detail links and hidden-page responses cannot expose a share card', async () => {
  let calls = 0;
  const invalid = harness('detail', { get: async () => { calls++; } });
  invalid.page.onLoad({ id: '../invalid' }); await invalid.page.onShow();
  assert.equal(calls, 0);
  assert.match(invalid.page.data.error, /链接无效/);
  const response = deferred();
  const { page } = harness('detail', { get: () => response.promise });
  page.onLoad({ id: 'content-123' }); const loading = page.onShow();
  await Promise.resolve(); page.onHide(); response.resolve(approved()); await loading;
  assert.equal(page.data.post, null);
  assert.equal(page.data.canShare, false);
});

test('a detail response from a previous account cannot populate the current account page', async () => {
  const response = deferred();
  const started = deferred();
  const { page, app } = harness('detail', { get: () => { started.resolve(); return response.promise; } });
  page.onLoad({ id: 'content-123' }); const loading = page.onShow();
  await started.promise; app.globalData.user = { id: 'other-user' };
  response.resolve(approved()); await loading;
  assert.equal(page.data.post, null);
  assert.equal(page.data.canShare, false);
  assert.match(page.data.error, /登录状态已变化/);
});

test('an unverified recipient can verify and return to the shared detail for another permission check', async () => {
  const recipient = harness('detail', { get: async () => { throw Object.assign(new Error('请先完成学校认证'), { statusCode: 403 }); } });
  recipient.app.globalData.user.verified = false;
  recipient.page.onLoad({ id: 'content-123' }); await recipient.page.onShow();
  assert.equal(recipient.page.data.post, null);
  assert.equal(recipient.page.data.canVerify, true);
  recipient.page.toVerify();
  const returnTo = new URL(recipient.wx.destinations[0], 'https://isolated.test').searchParams.get('returnTo');
  const verification = harness('verify', { post: async () => ({ id: 'reader', verified: true, school: { name: '测试学校' } }) });
  await verification.page.onLoad({ returnTo }); await verification.page.submit();
  verification.wx.modals[0].success({ confirm: true });
  assert.equal(verification.wx.destinations[0], '/pages/detail/index?id=content-123');
  assert.equal(verification.app.globalData.user.verified, true);
});
