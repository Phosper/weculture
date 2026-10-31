const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { formatPost } = require('../utils/format');

const query = url => new URL(url, 'https://isolated.example').searchParams;
const tap = (key, value) => ({ currentTarget: { dataset: { [key]: value } } });
const ids = page => Array.from(page.data.posts, item => item.id);
const result = (items = [], fields = {}) => ({ items, page: 1, total: items.length, hasMore: false, ...fields });
const post = id => ({ id, title: id, type: 'event', status: 'approved', author: { nickname: '同学' } });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(name, get = async () => result()) {
  let definition;
  const calls = [], storage = new Map([['wecultureCity', '北京']]);
  const app = { globalData: { user: { id: 'alice', verified: true } } };
  const wx = {
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value),
    stopPullDownRefresh() {}, showToast() {}, navigateTo() {}, switchTab() {},
    openSetting() { throw new Error('Automatic location must stay disabled'); }
  };
  const circles = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/circles.js'), 'utf8'), { wx, module: circles });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, `../pages/${name}/index.js`), 'utf8'), {
    Page: options => { definition = options; }, wx, getApp: () => app,
    require: id => {
      if (id.endsWith('/typography')) return { withTypography: options => options };
      if (id.endsWith('/guard')) return { requireLogin: () => app.login ? app.login() : Promise.resolve(app.globalData.user) };
      if (id.endsWith('/nav')) return { getNavMetrics: () => ({}), selectTab() {} };
      if (id.endsWith('/format')) return { formatPost };
      if (id.endsWith('/return-path')) return require('../utils/return-path');
      if (id.endsWith('/api')) return { api: { get: url => { if (url === '/featured') return Promise.resolve({ items: [] }); calls.push(url); return get(url); } } };
      if (id.endsWith('/circles')) return circles.exports;
      if (id.endsWith('/features')) return { FEATURES: { automaticCityLocation: false } };
      if (id.endsWith('/location')) return { getCurrentCity() { throw new Error('Automatic location must stay disabled'); }, LOCATION_SCOPE: 'scope.userFuzzyLocation' };
      throw new Error(`Unexpected module ${id}`);
    }
  });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values); } };
  return { page, calls, app, storage };
}

for (const name of ['home', 'community']) {
  test(`${name}: time choices only request events and all time omits the parameter`, async () => {
    const { page, calls } = harness(name);
    await page.onShow();
    const initialReads = calls.length;
    await page.changeEventTime(tap('eventTime', 'today'));
    assert.equal(calls.length, initialReads);
    await page.changeType(tap('type', 'event'));
    assert.equal(query(calls.at(-1)).has('eventTime'), false);
    for (const value of ['upcoming', 'today', 'week']) {
      await page.changeEventTime(tap('eventTime', value));
      assert.equal(query(calls.at(-1)).get('eventTime'), value);
      assert.equal(query(calls.at(-1)).get('type'), 'event');
      assert.equal(query(calls.at(-1)).get('page'), '1');
    }
    const reads = calls.length;
    await page.changeEventTime(tap('eventTime', 'week'));
    await page.changeEventTime(tap('eventTime', 'tomorrow'));
    await page.changeType(tap('type', 'invalid'));
    assert.equal(calls.length, reads);
    await page.changeEventTime(tap('eventTime', 'all'));
    assert.equal(query(calls.at(-1)).has('eventTime'), false);
    await page.changeEventTime(tap('eventTime', 'today'));
    await page.changeType(tap('type', 'dynamic'));
    assert.equal(page.data.eventTime, 'all');
    assert.equal(query(calls.at(-1)).has('eventTime'), false);
    await page.changeType(tap('type', 'event'));
    assert.equal(query(calls.at(-1)).has('eventTime'), false);
  });

  test(`${name}: rapid time changes and old pagination cannot replace the current filter`, async () => {
    const upcoming = deferred(), today = deferred(), week = deferred(), nextPage = deferred();
    const { page, calls } = harness(name, url => {
      const params = query(url);
      if (params.get('page') === '2') return nextPage.promise;
      if (params.get('eventTime') === 'upcoming') return upcoming.promise;
      if (params.get('eventTime') === 'today') return today.promise;
      if (params.get('eventTime') === 'week') return week.promise;
      return Promise.resolve(result());
    });
    await page.onShow(); await page.changeType(tap('type', 'event'));
    const old = page.changeEventTime(tap('eventTime', 'upcoming'));
    const current = page.changeEventTime(tap('eventTime', 'today'));
    upcoming.resolve(result([post('stale-upcoming')])); await old;
    assert.deepEqual(ids(page), []);
    assert.equal(page.data.loading, true);
    today.resolve(result([post('today')], { total: 3, hasMore: true })); await current;
    const loadingMore = page.loadMore();
    await page.loadMore();
    assert.equal(query(calls.at(-1)).get('page'), '2');
    assert.equal(query(calls.at(-1)).get('eventTime'), 'today');
    const newest = page.changeEventTime(tap('eventTime', 'week'));
    nextPage.resolve(result([post('stale-next-page')], { page: 2, total: 3 })); await loadingMore;
    assert.deepEqual(ids(page), []);
    assert.equal(page.data.loading, true);
    week.resolve(result([post('week')])); await newest;
    assert.deepEqual(ids(page), ['week']);
    assert.equal(page.data.page, 1);
    assert.equal(page.data.hasMore, false);
  });

  test(`${name}: leaving invalidates filtered results and a delayed login completion`, async () => {
    const pending = deferred();
    const { page, app, calls } = harness(name, url => query(url).get('eventTime') ? pending.promise : Promise.resolve(result()));
    await page.onShow(); await page.changeType(tap('type', 'event'));
    const loading = page.changeEventTime(tap('eventTime', 'week'));
    page.onHide(); pending.resolve(result([post('late')])); await loading;
    assert.deepEqual(ids(page), []);
    assert.equal(page.data.loading, false);
    const login = deferred(); app.login = () => login.promise;
    const reads = calls.length;
    const showing = page.onShow(); page.onUnload();
    login.resolve({ id: 'alice', verified: true }); await showing;
    assert.equal(calls.length, reads);
  });

  test(`${name}: changing account resets private filters before displaying the new results`, async () => {
    const old = deferred(), login = deferred();
    const { page, app, calls } = harness(name, url => query(url).get('eventTime') ? old.promise : Promise.resolve(result([post('current-account')])));
    await page.onShow(); await page.changeType(tap('type', 'event'));
    const pendingOld = page.changeEventTime(tap('eventTime', 'today'));
    if (name === 'home') page.setData({ feed: 'campus', q: '旧关键词', activeSearch: '旧关键词' });
    else page.setData({ circle: 'campus' });
    app.login = () => login.promise;
    const showing = page.onShow();
    assert.deepEqual(ids(page), []);
    old.reject(new Error('旧账号请求失败')); await pendingOld;
    assert.equal(page.data.error, '');
    login.resolve({ id: 'bob', verified: false }); await showing;
    assert.equal(page.data.user.id, 'bob');
    assert.equal(page.data.type, 'all');
    assert.equal(page.data.eventTime, 'all');
    assert.equal(query(calls.at(-1)).has('eventTime'), false);
    if (name === 'home') {
      assert.equal(page.data.feed, 'latest');
      assert.equal(page.data.q, '');
      assert.equal(query(calls.at(-1)).has('q'), false);
      assert.equal(query(calls.at(-1)).has('circle'), false);
    } else {
      assert.equal(page.data.circle, 'city');
      assert.equal(page.data.city, '北京');
      assert.equal(query(calls.at(-1)).get('city'), '北京');
    }
    assert.deepEqual(ids(page), ['current-account']);
  });

  test(`${name}: same-account return retains time selection and expired login clears it`, async () => {
    const { page, app, calls } = harness(name);
    await page.onShow(); await page.changeType(tap('type', 'event'));
    await page.changeEventTime(tap('eventTime', 'week'));
    page.onHide(); await page.onShow();
    assert.equal(page.data.eventTime, 'week');
    assert.equal(query(calls.at(-1)).get('eventTime'), 'week');
    app.globalData.user = null; await page.onShow();
    assert.equal(page.data.user, null);
    assert.equal(page.data.type, 'all');
    assert.equal(page.data.eventTime, 'all');
    assert.deepEqual(ids(page), []);
    assert.equal(page.data.page, 0);
    assert.equal(page.data.hasMore, false);
  });
}

test('home: search, public scope and pagination keep the chosen event time; recovery resets all', async () => {
  const { page, calls } = harness('home', async url => {
    const pageNumber = Number(query(url).get('page'));
    return result([post(`page-${pageNumber}`)], { page: pageNumber, total: 2, hasMore: pageNumber === 1 });
  });
  await page.onShow(); await page.changeType(tap('type', 'event'));
  await page.changeEventTime(tap('eventTime', 'today'));
  page.searchInput({ detail: { value: '  茶 & 文化  ' } }); await page.search();
  await page.changeFeed(tap('feed', 'public'));
  await page.loadMore();
  const params = query(calls.at(-1));
  assert.equal(params.get('q'), '茶 & 文化');
  assert.equal(params.get('scope'), 'platform');
  assert.equal(params.get('eventTime'), 'today');
  assert.equal(params.get('page'), '2');
  assert.deepEqual(ids(page), ['page-1', 'page-2']);
  await page.clearSearch();
  assert.equal(query(calls.at(-1)).get('eventTime'), 'today');
  assert.equal(query(calls.at(-1)).get('scope'), 'platform');
  assert.equal(query(calls.at(-1)).has('q'), false);
  await page.viewLatest();
  assert.equal(calls.at(-1), '/posts?page=1&pageSize=20');
  assert.equal(page.data.eventTime, 'all');
});

test('community: manual city changes keep the event time and circle changes reset it', async () => {
  const { page, calls, app, storage } = harness('community');
  await page.onShow(); await page.changeType(tap('type', 'event'));
  await page.changeEventTime(tap('eventTime', 'week'));
  await page.chooseCity({ detail: { value: ['广东省', '广州市', '天河区'] } });
  assert.equal(query(calls.at(-1)).get('city'), '广州');
  assert.equal(query(calls.at(-1)).get('eventTime'), 'week');
  assert.equal(query(calls.at(-1)).get('page'), '1');
  assert.equal(storage.get('wecultureCity'), '广州');
  const reads = calls.length;
  await page.locateCity(); page.openLocationSettings();
  assert.equal(calls.length, reads);
  assert.equal(page.data.automaticCityLocationEnabled, false);
  await page.changeCircle(tap('circle', 'international'));
  assert.equal(page.data.eventTime, 'all');
  assert.equal(page.data.type, 'all');
  assert.equal(query(calls.at(-1)).has('eventTime'), false);
  assert.equal(query(calls.at(-1)).has('city'), false);
  await page.changeType(tap('type', 'event'));
  await page.changeEventTime(tap('eventTime', 'today'));
  app.globalData.communityEntry = { circle: 'city', city: '北京', type: 'event' };
  await page.onShow();
  assert.equal(query(calls.at(-1)).get('type'), 'event');
  assert.equal(query(calls.at(-1)).has('eventTime'), false);
  assert.equal(page.data.eventTime, 'all');
});
