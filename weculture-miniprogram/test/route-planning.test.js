const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { validDate, readPlanMeta, changeRoutePlan } = require('../utils/route-planning');

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function harness(name, api) {
  let definition;
  const app = { globalData: { user: { id: 'alice', nickname: '同学' } } };
  const storage = { token: 'alice-token', routePlanMeta: { route: { departDate: '2040-10-01', companions: 18 } } };
  const wx = {
    toasts: [], reads: [],
    getStorageSync: key => { wx.reads.push(key); return storage[key] || ''; },
    showToast: options => wx.toasts.push(options.title),
    stopPullDownRefresh() {}
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../pages', name, 'index.js'), 'utf8'), {
    Page: options => { definition = options; }, wx, getApp: () => app,
    require: id => {
      if (id === '../../services/api') return { api };
      if (id === '../../utils/typography') return { withTypography: options => options };
      if (id === '../../utils/guard') return { requireLogin: async () => app.globalData.user };
      if (id === '../../utils/nav') return { getNavMetrics: () => ({}), selectTab() {} };
      return require(path.resolve(__dirname, '../pages', name, id));
    }
  });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) {
    for (const [key, value] of Object.entries(values)) {
      const parts = key.split('.'); let target = this.data;
      while (parts.length > 1) target = target[parts.shift()];
      target[parts[0]] = value;
    }
  } };
  return { page, wx, app, storage };
}

const route = (changes = {}) => ({ id: 'route', type: 'route', title: '文化旅行', stops: ['北京'], budget: 900, planned: false, ...changes });
const metadata = { departDate: '2026-12-02', companions: 2 };
const tapRoute = { currentTarget: { dataset: { id: 'route' } } };

function setupTravel(api, changes = {}) {
  const result = harness('travel', api);
  result.page.setData({ routes: [route(changes)], departDate: metadata.departDate, companions: metadata.companions });
  return result;
}

test('route parameters reject impossible dates and out-of-range companions', async () => {
  assert.equal(validDate('2028-02-29'), true);
  for (const date of ['2026-02-29', '2026-04-31', '2026-2-03', '', null]) assert.equal(validDate(date), false);
  assert.equal(readPlanMeta(null), null);
  assert.deepEqual(readPlanMeta({ companions: 0 }), { departDate: null, companions: 0 });
  assert.deepEqual(readPlanMeta({ departDate: '2026-12-02', companions: 21 }), { departDate: '2026-12-02', companions: null });
  let calls = 0;
  for (const companions of [-1, 1.5, 21, '2']) {
    await assert.rejects(changeRoutePlan({ post: async () => { calls += 1; } }, 'route', true, { ...metadata, companions }), /检查/);
  }
  assert.equal(calls, 0);
});

test('save sends explicit intent once and shows the metadata read back from the server', async () => {
  const response = deferred(); const calls = [];
  const savedMeta = { departDate: '2026-12-03', companions: 3 };
  const { page, wx } = setupTravel({
    post: (url, body) => { calls.push({ url, body }); return response.promise; },
    get: async () => [route({ planned: true, planMeta: savedMeta })]
  });
  const saving = page.plan(tapRoute); await page.plan(tapRoute);
  assert.equal(calls.length, 1);
  assert.equal(page.data.planBusyId, 'route');
  assert.deepEqual(calls[0].body, { planned: true, ...metadata });
  page.setData({ departDate: '2027-01-01', companions: 10 });
  response.resolve({ planned: true, planMeta: metadata }); await saving;
  assert.equal(page.data.routes[0].planned, true);
  assert.deepEqual(page.data.routes[0].planMeta, savedMeta);
  assert.equal(page.data.planBusyId, '');
  assert.deepEqual(wx.toasts, ['已加入我的计划']);
  assert.equal(wx.reads.includes('routePlanMeta'), false);
});

test('an unconfirmed save keeps its original intent and parameters for safe retry', async () => {
  const bodies = []; let reads = 0;
  const { page } = setupTravel({
    post: async (_url, body) => { bodies.push(body); return { planned: true }; },
    get: async () => { if (++reads === 1) throw new Error('读取计划失败'); return [route({ planned: true, planMeta: metadata })]; }
  });
  await page.plan(tapRoute);
  assert.equal(page.data.routes[0].planned, false);
  assert.equal(page.data.planErrorId, 'route');
  assert.equal(page.data.planError, '读取计划失败');
  // A refresh can observe the write that succeeded before the read failed.
  page.setData({ routes: [route({ planned: true })], departDate: '2027-02-03', companions: 9 });
  await page.plan(tapRoute);
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[0], { planned: true, ...metadata });
  assert.deepEqual(bodies[1], bodies[0]);
  assert.equal(page.data.routes[0].planned, true);
  assert.equal(page.data.planError, '');
});

test('removal retries the explicit unplanned state after an uncertain response', async () => {
  const bodies = []; let attempts = 0;
  const { page, wx } = setupTravel({
    post: async (_url, body) => { bodies.push(body); if (++attempts === 1) throw new Error('响应丢失'); return { planned: false }; },
    get: async () => []
  }, { planned: true, planMeta: metadata });
  await page.plan(tapRoute);
  assert.equal(page.data.routes[0].planned, true);
  assert.deepEqual(wx.toasts, []);
  await page.plan(tapRoute);
  assert.deepEqual(bodies, [{ planned: false }, { planned: false }]);
  assert.equal(page.data.routes[0].planned, false);
  assert.equal(page.data.routes[0].planMeta, null);
});

test('a missing server confirmation never marks a route as saved', async () => {
  for (const serverPlans of [[], [route({ planned: true, planMeta: null })]]) {
    const { page, wx } = setupTravel({ post: async () => ({ planned: true }), get: async () => serverPlans });
    await page.plan(tapRoute);
    assert.equal(page.data.routes[0].planned, false);
    assert.match(page.data.planError, /暂未确认/);
    assert.deepEqual(wx.toasts, []);
  }
});

test('leaving during a save ignores its result and avoids reading plans with a later session', async () => {
  const response = deferred(); let reads = 0;
  const { page, wx } = setupTravel({ post: () => response.promise, get: async () => { reads += 1; return []; } });
  const saving = page.plan(tapRoute);
  page.onHide(); response.resolve({ planned: true }); await saving;
  assert.equal(reads, 0);
  assert.equal(page.data.routes[0].planned, false);
  assert.deepEqual(wx.toasts, []);
});

test('switching accounts during the server read cannot publish the previous account metadata', async () => {
  const read = deferred(); let started;
  const reading = new Promise(resolve => { started = resolve; });
  const { page, app, storage, wx } = setupTravel({
    post: async () => ({ planned: true }),
    get: () => { started(); return read.promise; }
  });
  const saving = page.plan(tapRoute); await reading;
  app.globalData.user = { id: 'bob' }; storage.token = 'bob-token';
  read.resolve([route({ planned: true, planMeta: metadata })]); await saving;
  assert.equal(page.data.routes[0].planned, false);
  assert.equal(page.data.routes[0].planMeta, undefined);
  assert.deepEqual(wx.toasts, []);
});

test('returning while a save is pending refreshes again after the stale operation completes', async () => {
  const response = deferred(); let saved = false;
  const { page, wx } = setupTravel({
    post: (url) => url.endsWith('/plans') ? response.promise : Promise.resolve([route()]),
    get: async () => saved ? [route({ planned: true, planMeta: metadata })] : []
  });
  const saving = page.plan(tapRoute); page.onHide(); await page.onShow();
  assert.equal(page.data.planBusyId, 'route');
  saved = true; response.resolve({ planned: true }); await saving;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.data.routes[0].planned, true);
  assert.deepEqual(page.data.routes[0].planMeta, metadata);
  assert.equal(page.data.planBusyId, '');
  assert.deepEqual(wx.toasts, []);
});

test('recommendations hydrate plan details from the server instead of legacy local storage', async () => {
  const { page, wx } = harness('travel', {
    post: async () => [route()],
    get: async () => [route({ planned: true, planMeta: metadata })]
  });
  await page.onShow();
  assert.equal(page.data.routes[0].planned, true);
  assert.deepEqual(page.data.routes[0].planMeta, metadata);
  assert.equal(wx.reads.includes('routePlanMeta'), false);
});

test('newer route searches win and budget uses the submitted filter snapshot', async () => {
  const old = deferred(); const latest = deferred(); let request = 0;
  const { page } = harness('travel', { post: () => ++request === 1 ? old.promise : latest.promise, get: async () => [] });
  page.setData({ destination: '北京', budget: '1000' }); const first = page.recommend();
  page.setData({ destination: '上海', budget: '2000' }); const second = page.recommend();
  page.setData({ budget: '1000' });
  latest.resolve([route({ title: '上海', budget: 1800 })]); await second;
  old.resolve([route({ title: '北京', budget: 800 })]); await first;
  assert.equal(page.data.routes.length, 1);
  assert.equal(page.data.routes[0].title, '上海');
  assert.equal(page.data.loading, false);
});

test('a recommendation started during saving cannot restore the old plan state', async () => {
  const stale = deferred();
  const { page } = setupTravel({
    post: async url => url.endsWith('/plans') ? { planned: true } : stale.promise,
    get: async () => [route({ planned: true, planMeta: metadata })]
  });
  const saving = page.plan(tapRoute);
  const loading = page.recommend();
  await saving;
  stale.resolve([route()]); await loading;
  assert.equal(page.data.routes[0].planned, true);
  assert.equal(page.data.loading, false);
});

test('account changes clear route cards, private travel parameters and retry state before reloading', async () => {
  let failed = true;
  const { page, app, storage } = harness('travel', {
    post: async url => { if (url.endsWith('/plans') && failed) throw new Error('网络失败'); return [route()]; },
    get: async () => []
  });
  await page.onShow(); page.setData({ ...metadata, companions: 12 });
  await page.plan(tapRoute);
  assert.equal(page.data.planErrorId, 'route');
  page.onHide(); app.globalData.user = { id: 'bob' }; storage.token = 'bob-token'; failed = false;
  await page.onShow();
  assert.equal(page.data.routes[0].planned, false);
  assert.equal(page.data.routes[0].planMeta, null);
  assert.equal(page.data.companions, 0);
  assert.equal(page.data.planError, '');
  assert.equal(page._planRetry, null);
});

test('companion controls cap the value at 0 through 20', () => {
  const { page } = setupTravel({});
  page.setData({ companions: 20 }); page.changeCompanions({ currentTarget: { dataset: { delta: 1 } } });
  assert.equal(page.data.companions, 20);
  page.setData({ companions: 0 }); page.changeCompanions({ currentTarget: { dataset: { delta: -1 } } });
  assert.equal(page.data.companions, 0);
});

test('an old account save neither blocks nor overwrites a new account save', async () => {
  const old = deferred(); let savingAccount = 'alice';
  const { page, app, storage, wx } = harness('travel', {
    post: async url => url.endsWith('/plans') ? savingAccount === 'alice' ? old.promise : { planned: true } : [route()],
    get: async () => savingAccount === 'bob-saved' ? [route({ planned: true, planMeta: metadata })] : []
  });
  await page.onShow();
  const first = page.plan(tapRoute);
  app.globalData.user = { id: 'bob' }; storage.token = 'bob-token'; savingAccount = 'bob';
  await page.onShow();
  page.setData({ departDate: metadata.departDate, companions: metadata.companions });
  const second = page.plan(tapRoute); savingAccount = 'bob-saved'; await second;
  assert.equal(page.data.routes[0].planned, true);
  old.resolve({ planned: true }); await first;
  assert.equal(page.data.routes[0].planned, true);
  assert.deepEqual(page.data.routes[0].planMeta, metadata);
  assert.deepEqual(wx.toasts, ['已加入我的计划']);
});

test('my plans uses server metadata and leaves legacy unowned parameters out of older plans', async () => {
  const { page, wx } = harness('profile', { get: async url => url === '/me/plans' ? [route({ planMeta: metadata }), route({ id: 'older', planMeta: null })] : [] });
  await page.onShow();
  assert.deepEqual(page.data.plans[0].planMeta, metadata);
  assert.equal(page.data.plans[1].planMeta, null);
  assert.equal(wx.reads.includes('routePlanMeta'), false);
});

test('my plans clears the previous account and ignores its late read even when it remains visible', async () => {
  const oldRead = deferred(); let account = 'alice';
  const { page, app, storage } = harness('profile', {
    get: async url => url === '/me/plans' ? account === 'alice' ? oldRead.promise : [route({ id: 'bob-route', planMeta: null })] : []
  });
  const first = page.onShow(); await new Promise(resolve => setImmediate(resolve));
  page.setData({ plans: [route({ planMeta: metadata })], posts: [{ id: 'alice-post' }], favorites: [{ id: 'alice-favorite' }] });
  account = 'bob'; app.globalData.user = { id: 'bob' }; storage.token = 'bob-token';
  const second = page.onShow();
  assert.equal(page.data.plans.length, 0);
  assert.equal(page.data.posts.length, 0);
  assert.equal(page.data.favorites.length, 0);
  await second;
  oldRead.resolve([route({ planMeta: metadata })]); await first;
  assert.equal(page.data.plans.length, 1);
  assert.equal(page.data.plans[0].id, 'bob-route');
  assert.equal(page.data.plans[0].planMeta, null);
  assert.equal(page.data.user.id, 'bob');
});
