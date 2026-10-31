const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { formatPost, formatRoute } = require('../utils/format');

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function harness(name, api) {
  let definition;
  const app = { globalData: { user: { id: 'user', nickname: '同学', verified: true } } };
  const wx = {
    modals: [], toasts: [], destinations: [],
    getStorageSync: () => '', showModal: options => wx.modals.push(options),
    showToast: options => wx.toasts.push(options.title),
    navigateTo: options => wx.destinations.push(options.url),
    switchTab: options => wx.destinations.push(options.url),
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
  return { page, wx, app };
}

function post(registered = true, changes = {}) {
  return { id: 'post', title: '文化活动', status: 'approved', circle: 'city', city: '北京', author: { nickname: '真实作者' }, event: {
    id: 'event', status: 'active', registered, registeredCount: 2, capacity: 2,
    startsAt: '2099-12-02T09:00:00+08:00', endsAt: '2099-12-02T12:00:00+08:00', registrationDeadline: '2099-12-01T18:00:00+08:00', location: '文化馆', ...changes
  } };
}

function setupDetail(api, value = post()) {
  const result = harness('detail', api);
  result.page.setData({ post: formatPost(value), loading: false });
  return result;
}

function setupProfile(api) {
  const result = harness('profile', api);
  const event = formatRoute({ type: 'event', ...post().event, postId: 'post', title: '文化活动', circle: 'city', city: '北京' });
  const route = formatRoute({ type: 'route', id: 'route', title: '旅行路线', stops: ['北京', '天津'], planned: true });
  result.page.setData({ plans: [event, route], joinedCount: 1, routeCount: 1, stats: { posts: 3, plans: 2, likes: 7 }, posts: [formatPost(post())] });
  return { ...result, route };
}

test('detail cancellation releases the count and allows registration again', async () => {
  const calls = [];
  const { page, wx } = setupDetail({
    delete: async url => { calls.push(url); return { registered: false, registeredCount: 1, capacity: 2 }; },
    post: async url => { calls.push(url); return { registered: true, registeredCount: 2, capacity: 2 }; }
  });
  const cancelling = page.cancelRegistration();
  assert.equal(page.data.eventBusy, true);
  assert.equal(page.data.post.event.registeredCount, 2);
  wx.modals[0].success({ confirm: true });
  await cancelling;
  assert.equal(page.data.post.event.registered, false);
  assert.equal(page.data.post.event.registeredCount, 1);
  assert.equal(page.data.post.event.registerable, true);
  assert.equal(page.data.eventBusy, false);
  await page.register();
  assert.equal(page.data.post.event.registered, true);
  assert.equal(page.data.post.event.cancelable, true);
  assert.equal(page.data.post.event.registeredCount, 2);
  assert.deepEqual(calls, ['/events/event/registrations/me', '/events/event/registrations']);
});

test('dismissed cancellation keeps registration and repeated taps do not open another dialog', async () => {
  let calls = 0;
  const { page, wx } = setupDetail({ delete: async () => { calls += 1; } });
  const first = page.cancelRegistration();
  await page.cancelRegistration();
  assert.equal(wx.modals.length, 1);
  wx.modals[0].success({ confirm: false });
  await first;
  assert.equal(calls, 0);
  assert.equal(page.data.post.event.registered, true);
  assert.equal(page.data.eventBusy, false);
});

test('failed cancellation leaves the count unchanged and can be retried', async () => {
  let attempts = 0;
  const { page, wx } = setupDetail({ delete: async () => {
    if (++attempts === 1) throw new Error('网络连接失败');
    return { registered: false, registeredCount: 1 };
  } });
  const first = page.cancelRegistration(); wx.modals[0].success({ confirm: true }); await first;
  assert.equal(page.data.post.event.registered, true);
  assert.equal(page.data.post.event.registeredCount, 2);
  assert.equal(page.data.eventError, '网络连接失败');
  assert.equal(page.data.eventBusy, false);
  const second = page.cancelRegistration(); wx.modals[1].success({ confirm: true }); await second;
  assert.equal(page.data.post.event.registered, false);
  assert.equal(page.data.eventError, '');
});

test('unconfirmed response never changes registration or announces success', async () => {
  const { page, wx } = setupDetail({ delete: async () => ({ registered: false }) });
  const cancelling = page.cancelRegistration(); wx.modals[0].success({ confirm: true }); await cancelling;
  assert.equal(page.data.post.event.registered, true);
  assert.equal(page.data.post.event.registeredCount, 2);
  assert.match(page.data.eventError, /暂未确认/);
  assert.deepEqual(wx.toasts, []);
});

test('slow registration submits once and unlocks after failure', async () => {
  let calls = 0;
  const response = deferred();
  const { page } = setupDetail({ post: () => { calls += 1; return response.promise; } }, post(false, { registeredCount: 1 }));
  const first = page.register(); await page.register();
  assert.equal(calls, 1);
  response.reject(new Error('网络失败')); await first;
  assert.equal(page.data.post.event.registered, false);
  assert.equal(page.data.eventBusy, false);
});

test('leaving during a confirmation prevents the cancellation request', async () => {
  let calls = 0;
  const { page, wx } = setupDetail({ delete: async () => { calls += 1; } });
  const cancelling = page.cancelRegistration();
  page.onHide(); wx.modals[0].success({ confirm: true }); await cancelling;
  assert.equal(calls, 0);
  assert.equal(page.data.post.event.registered, true);
});

test('a late cancellation result cannot change a hidden detail page', async () => {
  const response = deferred(); let requested;
  const started = new Promise(resolve => { requested = resolve; });
  const { page, wx } = setupDetail({ delete: () => { requested(); return response.promise; } });
  const cancelling = page.cancelRegistration(); wx.modals[0].success({ confirm: true }); await started;
  page.onHide(); response.resolve({ registered: false, registeredCount: 1 }); await cancelling;
  assert.equal(page.data.post.event.registered, true);
  assert.equal(page.data.post.event.registeredCount, 2);
  assert.deepEqual(wx.toasts, []);
});

test('late detail reads are ignored after leaving the page', async () => {
  const response = deferred();
  const { page } = harness('detail', { get: () => response.promise });
  page.onLoad({ id: 'post' }); const loading = page.load(); page.onHide();
  response.resolve(post()); await loading;
  assert.equal(page.data.post, null);
});

test('my plans cancellation removes only its event and updates activity and plan totals', async () => {
  const { page, wx, route } = setupProfile({ delete: async () => ({ registered: false, registeredCount: 1 }) });
  const cancelling = page.cancelEvent({ currentTarget: { dataset: { id: 'event' } } });
  page.openPlan({ currentTarget: { dataset: { id: 'event', type: 'event' } } });
  assert.deepEqual(wx.destinations, []);
  wx.modals[0].success({ confirm: true }); await cancelling;
  assert.equal(page.data.plans.length, 1);
  assert.deepEqual(page.data.plans[0], route);
  assert.equal(page.data.joinedCount, 0);
  assert.equal(page.data.routeCount, 1);
  assert.equal(page.data.stats.plans, 1);
  assert.equal(page.data.stats.posts, 3);
  assert.equal(page.data.stats.likes, 7);
  assert.equal(page.data.posts[0].event.registered, false);
});

test('failed my plans cancellation preserves the card and statistics, then retries safely', async () => {
  let attempts = 0;
  const { page, wx } = setupProfile({ delete: async () => {
    if (++attempts === 1) throw new Error('连接失败');
    return { registered: false, registeredCount: 1 };
  } });
  const event = { currentTarget: { dataset: { id: 'event' } } };
  const first = page.cancelEvent(event); await page.cancelEvent(event);
  assert.equal(wx.modals.length, 1);
  wx.modals[0].success({ confirm: true }); await first;
  assert.equal(page.data.plans.length, 2);
  assert.equal(page.data.stats.plans, 2);
  assert.equal(page.data.eventBusyId, '');
  assert.equal(page.data.eventErrorId, 'event');
  const second = page.cancelEvent(event); wx.modals[1].success({ confirm: true }); await second;
  assert.equal(page.data.plans.length, 1);
});

test('a plans refresh started before cancellation cannot restore the cancelled card', async () => {
  const response = deferred();
  const { page, wx } = setupProfile({
    delete: async () => ({ registered: false, registeredCount: 1 }),
    get: url => url === '/me/plans' ? response.promise : Promise.resolve([])
  });
  const oldPlans = page.data.plans;
  const cancelling = page.cancelEvent({ currentTarget: { dataset: { id: 'event' } } });
  const loading = page.load();
  wx.modals[0].success({ confirm: true }); await cancelling;
  response.resolve(oldPlans); await loading;
  assert.equal(page.data.plans.length, 1);
  assert.equal(page.data.plans[0].type, 'route');
  assert.equal(page.data.stats.plans, 1);
});

test('leaving my plans ignores a late cancellation response and notifications', async () => {
  const response = deferred(); let requested;
  const started = new Promise(resolve => { requested = resolve; });
  const { page, wx } = setupProfile({ delete: () => { requested(); return response.promise; } });
  const cancelling = page.cancelEvent({ currentTarget: { dataset: { id: 'event' } } });
  wx.modals[0].success({ confirm: true }); await started; page.onHide();
  response.resolve({ registered: false, registeredCount: 1 }); await cancelling;
  assert.equal(page.data.plans.length, 2);
  assert.equal(page.data.stats.plans, 2);
  assert.deepEqual(wx.toasts, []);
});

test('cancelled, changed and overdue activities still allow the registered user to cancel', () => {
  for (const changes of [{ status: 'cancelled' }, { status: 'changed' }, { registrationDeadline: '2000-01-01T00:00:00Z' }, { endsAt: '2000-01-01T00:00:00Z' }]) {
    const event = formatPost(post(true, changes)).event;
    assert.equal(event.cancelable, true);
    assert.equal(event.registerable, false);
    assert.notEqual(event.eventStatusText, '报名中');
  }
  const plan = formatRoute({ type: 'event', ...post().event, title: '文化活动' });
  assert.notEqual(plan.startsAtText, '');
  assert.notEqual(plan.endsAtText, '');
  for (const status of ['pending', 'rejected', 'offline']) {
    const event = formatPost({ ...post(true), status }).event;
    assert.equal(event.cancelable, false);
    assert.equal(event.registerable, false);
  }
});

test('legacy platform samples retain the actual server author instead of a title-based identity', () => {
  const value = formatPost({ title: '沉浸式体验非遗：我们在校园里办了一场茶艺社！', status: 'approved', circle: null, visibility: 'platform', schoolId: null, author: { nickname: '当前作者', avatarUrl: '/真实头像.png', schoolLabel: '实际学校' } });
  assert.equal(value.author.nickname, '当前作者');
  assert.equal(value.author.avatarUrl, '/真实头像.png');
  assert.equal(value.author.schoolLabel, '实际学校');
  assert.equal(value.author.initial, '当');
});
