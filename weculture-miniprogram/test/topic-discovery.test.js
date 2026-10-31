const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { normalizeTopic, topicPath, topicFromQuery, topicFromPath } = require('../utils/topics');
const { safeReturnPath, currentReturnPath, HOME_PATH } = require('../utils/return-path');

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const post = id => ({ id, title: id, tag: '文化体验', status: 'approved', visibility: 'platform', author: { nickname: '作者' } });
const result = (items, rest = {}) => ({ items, page: 1, total: items.length, hasMore: false, ...rest });
const event = (key, value) => ({ currentTarget: { dataset: { [key]: value } } });
const query = url => new URL(url, 'https://isolated.test').searchParams;

function harness(get, name = 'topic') {
  let definition;
  const app = { globalData: { user: { id: 'reader', nickname: '同学', verified: true } } };
  const storage = { token: 'reader-token' };
  const calls = [];
  const wx = { destinations: [], refreshStopped: false,
    getStorageSync: key => storage[key],
    navigateTo: options => wx.destinations.push(options.url),
    redirectTo: options => wx.destinations.push(options.url),
    reLaunch: options => wx.destinations.push(options.url),
    switchTab: options => wx.destinations.push(options.url),
    stopPullDownRefresh: () => { wx.refreshStopped = true; },
    hideShareMenu() {}, showShareMenu() {}, showToast() {},
    showModal: options => options.success({ confirm: true })
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages', name, 'index.js'), 'utf8'), {
    Page: value => { definition = value; }, wx, getApp: () => app,
    require: id => {
      if (id.endsWith('/typography')) return { withTypography: value => value };
      if (id.endsWith('/guard')) return { requireLogin: () => app.login ? app.login() : Promise.resolve(app.globalData.user) };
      if (id.endsWith('/nav')) return { getNavMetrics: () => ({}) };
      if (id.endsWith('/api')) return { api: { get: url => { calls.push(url); return get(url); }, post: get } };
      return require(path.resolve(__dirname, '../pages', name, id));
    }
  });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values); } };
  return { page, app, storage, wx, calls };
}

test('topic labels round-trip exactly through routes and login even with 80 Chinese characters or URL symbols', () => {
  for (const tag of ['文化体验', '文'.repeat(80), '100%_! & # + / ? =', '%20与%2F原样', '茶艺🌿']) {
    const route = topicPath(tag);
    assert.equal(topicFromPath(route), tag);
    assert.equal(topicFromQuery(route.slice(route.indexOf('=') + 1)), tag);
    assert.equal(safeReturnPath(route), route);
    assert.equal(safeReturnPath(encodeURIComponent(route)), route);
    assert.equal(currentReturnPath({ data: { tag } }, { route: 'pages/topic/index' }), route);
    assert.equal(currentReturnPath({ returnTo: route }, { route: 'pages/verify/index' }), route);
  }
  assert.equal(normalizeTopic('  文化  '), '文化');
});

test('invalid topics and extra navigation parameters cannot expand the login route whitelist', () => {
  for (const tag of ['', ' ', '文'.repeat(81), '文化\n活动', null, {}]) assert.equal(topicPath(tag), '');
  for (const route of ['/pages/topic/index', '/pages/topic/index?tag=good&scope=other', '/pages/topic/index?tag=good#other', '/pages/topic/index?tag=%E0%A4%A', '/pages/topic/index?tag=%20', '/pages/topic/index?tag=' + 'x'.repeat(81)]) assert.equal(safeReturnPath(route), HOME_PATH);
});

test('topic page asks the server for an exact complete tag, without substituting full-text search', async () => {
  const { page, calls } = harness(async () => result([post('one')]));
  page.onLoad({ tag: encodeURIComponent('100%_! & # +') }); await page.onShow();
  assert.equal(query(calls[0]).get('tag'), '100%_! & # +');
  assert.equal(query(calls[0]).has('q'), false);
  assert.equal(page.data.page, 1);
  assert.equal(page.data.posts[0].id, 'one');
});

test('topic filters combine permissions, type and event time and reset pagination', async () => {
  const { page, calls } = harness(async () => result([], { total: 0 }));
  page.onLoad({ tag: '文化' }); await page.onShow();
  await page.changeScope(event('scope', 'campus'));
  await page.changeType(event('type', 'event'));
  page.setData({ page: 3 }); await page.changeEventTime(event('time', 'week'));
  const values = query(calls.at(-1));
  assert.equal(values.get('circle'), 'campus');
  assert.equal(values.has('schoolId'), false);
  assert.equal(values.get('tag'), '文化');
  assert.equal(values.get('type'), 'event');
  assert.equal(values.get('eventTime'), 'week');
  assert.equal(values.get('page'), '1');
  await page.changeType(event('type', 'dynamic'));
  assert.equal(page.data.eventTime, 'all');
  assert.equal(query(calls.at(-1)).has('eventTime'), false);
});

test('topic pagination preserves order and deduplicates results while repeated taps submit once', async () => {
  const pending = deferred();
  const { page, calls } = harness(async url => query(url).get('page') === '1' ? result([post('two'), post('one')], { total: 3, hasMore: true }) : pending.promise);
  page.onLoad({ tag: '文化' }); await page.onShow();
  const loading = page.loadMore(); await page.loadMore();
  assert.equal(calls.length, 2);
  pending.resolve(result([post('one'), post('zero')], { page: 2, total: 3 })); await loading;
  assert.deepEqual(Array.from(page.data.posts, value => value.id), ['two', 'one', 'zero']);
  assert.equal(page.data.hasMore, false);
});

test('failed pagination keeps loaded items and retries the same next page', async () => {
  let attempts = 0;
  const { page, calls } = harness(async url => {
    if (query(url).get('page') === '1') return result([post('one')], { total: 2, hasMore: true });
    if (++attempts === 1) throw new Error('网络失败');
    return result([post('two')], { page: 2, total: 2 });
  });
  page.onLoad({ tag: '文化' }); await page.onShow(); await page.loadMore();
  assert.equal(page.data.page, 1);
  assert.equal(page.data.posts[0].id, 'one');
  await page.retry();
  assert.equal(query(calls.at(-1)).get('page'), '2');
  assert.equal(page.data.posts.length, 2);
});

test('a slow old filter cannot overwrite newer results or their loading state', async () => {
  const pending = deferred(); let count = 0;
  const { page } = harness(async () => ++count === 2 ? pending.promise : result([post('current')]));
  page.onLoad({ tag: '文化' }); await page.onShow();
  const old = page.changeType(event('type', 'event'));
  await page.changeType(event('type', 'market'));
  pending.resolve(result([post('stale')])); await old;
  assert.equal(page.data.posts[0].id, 'current');
  assert.equal(page.data.type, 'market');
  assert.equal(page.data.loading, false);
});

test('unverified users can view public topics but cannot request school content', async () => {
  const { page, app, calls, wx } = harness(async () => result([]));
  app.globalData.user.verified = false;
  page.onLoad({ tag: encodeURIComponent('文化 & 生活') }); await page.onShow();
  await page.changeScope(event('scope', 'campus'));
  assert.equal(calls.length, 1);
  page.toVerify();
  assert.equal(query(wx.destinations[0]).get('returnTo'), topicPath('文化 & 生活'));
  await page.clearFilters();
  assert.equal(calls.length, 2);
  assert.equal(page.data.scope, 'latest');
});

test('leaving or losing the session rejects late topic reads', async () => {
  for (const mode of ['hide', 'account']) {
    const pending = deferred(), started = deferred();
    const { page, app } = harness(() => { started.resolve(); return pending.promise; });
    page.onLoad({ tag: '文化' }); const loading = page.onShow(); await started.promise;
    if (mode === 'hide') page.onHide(); else app.globalData.user = { id: 'other', verified: true };
    pending.resolve(result([post('private')])); await loading;
    assert.equal(page.data.posts.length, 0);
    assert.equal(page.data.loading, false);
  }
});

test('login completion after leaving and malformed topic links never start a request', async () => {
  const { page, app, calls } = harness(async () => result([]));
  const login = deferred(); app.login = () => login.promise;
  page.onLoad({ tag: '文化' }); const showing = page.onShow(); page.onHide(); login.resolve({ id: 'reader', verified: true }); await showing;
  assert.equal(calls.length, 0);
  page.onLoad({ tag: '%E0%A4%A' }); await page.onShow();
  assert.equal(calls.length, 0);
  assert.match(page.data.error, /话题链接无效/);
});

test('switching accounts clears the old topic scope while the same account retains it', async () => {
  const { page, app, storage, calls } = harness(async () => result([]));
  page.onLoad({ tag: '文化' }); await page.onShow();
  await page.changeScope(event('scope', 'campus')); await page.changeType(event('type', 'event')); await page.changeEventTime(event('time', 'today'));
  page.onHide(); await page.onShow();
  assert.equal(query(calls.at(-1)).get('eventTime'), 'today');
  page.onHide(); app.globalData.user = { id: 'another', verified: false }; storage.token = 'another-token'; await page.onShow();
  assert.equal(page.data.scope, 'latest'); assert.equal(page.data.type, 'all'); assert.equal(page.data.eventTime, 'all');
  assert.equal(query(calls.at(-1)).has('circle'), false);
});

test('malformed API responses show retry state and pull-down errors always release the spinner', async () => {
  const { page, wx } = harness(async () => []);
  page.onLoad({ tag: '文化' }); await page.onShow();
  assert.match(page.data.error, /暂时无法加载/);
  await page.onPullDownRefresh();
  assert.equal(wx.refreshStopped, true); assert.equal(page.data.loading, false);
});

test('school verification can return to a long topic label without accepting arbitrary targets', async () => {
  const route = topicPath('文'.repeat(80));
  const { page, wx } = harness(async () => ({ id: 'reader', verified: true, school: { name: '学校' } }), 'verify');
  await page.onLoad({ returnTo: encodeURIComponent(route) }); await page.submit();
  assert.equal(wx.destinations[0], route);
  await page.onLoad({ returnTo: '/pages/topic/index?tag=x&admin=true' });
  assert.equal(page.returnTo, '');
});

test('card labels and approved detail labels navigate to the complete topic while pending previews do not', () => {
  const wx = { destinations: [], navigateTo: value => wx.destinations.push(value.url) };
  let component;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../components/post-card/index.js'), 'utf8'), {
    Component: value => { component = value; }, wx,
    require: id => id.endsWith('/api') ? { api: {} } : require(path.resolve(__dirname, '../components/post-card', id))
  });
  component.methods.openTopic.call({ data: { post: { tag: '100%_! & # +' } } });
  assert.equal(wx.destinations[0], topicPath('100%_! & # +'));
  const detail = harness(() => {}, 'detail');
  detail.page.setData({ post: { tag: '文化', status: 'pending' } }); detail.page.openTopic();
  assert.equal(detail.wx.destinations.length, 0);
  detail.page.setData({ post: { tag: '文化', status: 'approved' } }); detail.page.openTopic();
  assert.equal(detail.wx.destinations[0], topicPath('文化'));
});
