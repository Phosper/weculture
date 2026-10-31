const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { formatPost } = require('../utils/format');

const post = (id, fields = {}) => ({ id, title: `标题 ${id}`, content: '精选内容', type: 'dynamic', status: 'approved',
  visibility: 'platform', author: { nickname: '作者' }, createdAt: '2026-11-01T02:00:00.000Z', imageUrl: '', tag: '文化', ...fields });
const pageResult = items => ({ items, page: 1, total: items.length, hasMore: false });

function harness(featured = { items: [] }, posts = pageResult([post('feed')])) {
  let definition;
  const calls = [];
  const app = { globalData: { user: { id: 'reader', nickname: '同学', verified: true } } };
  const wx = { destinations: [], toasts: [], refreshStopped: false,
    showToast(options) { this.toasts.push(options.title); },
    navigateTo(options) { this.destinations.push(options.url); },
    stopPullDownRefresh() { this.refreshStopped = true; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/home/index.js'), 'utf8'), {
    Page: options => { definition = options; }, wx, getApp: () => app,
    require: id => {
      if (id.endsWith('/typography')) return { withTypography: options => options };
      if (id.endsWith('/guard')) return { requireLogin: async () => app.globalData.user };
      if (id.endsWith('/nav')) return { getNavMetrics: () => ({}), selectTab() {} };
      if (id.endsWith('/format')) return { formatPost };
      if (id.endsWith('/return-path')) return require('../utils/return-path');
      if (id.endsWith('/api')) return { api: { get: async url => { calls.push(url); if (url === '/featured') return typeof featured === 'function' ? featured() : featured; return posts; } } };
      throw new Error(`Unexpected module ${id}`);
    }
  });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values); } };
  return { page, app, wx, calls };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('home loads featured after the feed, filters unsafe entries and opens valid detail links', async () => {
  const valid = post('featured-one', { imageUrl: '/assets/home-tea.jpg' });
  const offline = post('featured-offline', { status: 'offline' });
  const malformed = { id: 'not valid' };
  const { page, calls, wx } = harness({ items: [valid, offline, malformed, valid] });
  await page.onShow();
  await settle();
  assert.equal(calls[0], '/posts?page=1&pageSize=20');
  assert.ok(calls.includes('/featured'));
  assert.deepEqual(Array.from(page.data.featured, item => item.id), ['featured-one']);
  assert.equal(page.data.featuredLoading, false);
  page.openFeatured({ currentTarget: { dataset: { id: 'featured-one' } } });
  page.openFeatured({ currentTarget: { dataset: { id: 'missing' } } });
  assert.deepEqual(wx.destinations, ['/pages/detail/index?id=featured-one']);
});

test('a featured read failure is non-blocking and a malformed envelope stays empty', async () => {
  const rejected = harness(Promise.reject(new Error('精选网络失败')));
  await rejected.page.onShow();
  await settle();
  assert.deepEqual(Array.from(rejected.page.data.featured), []);
  assert.deepEqual(Array.from(rejected.page.data.posts, item => item.id), ['feed']);
  assert.equal(rejected.page.data.featuredLoading, false);
  assert.equal(rejected.page.data.error, '');

  const malformed = harness({ items: 'not-an-array' });
  await malformed.page.onShow();
  await settle();
  assert.deepEqual(Array.from(malformed.page.data.featured), []);
  assert.deepEqual(Array.from(malformed.page.data.posts, item => item.id), ['feed']);
});

test('account changes and page hides clear featured state', async () => {
  let reads = 0;
  const { page, app } = harness(() => ({ items: [post(++reads === 1 ? 'featured-one' : 'featured-two')] }));
  await page.onShow();
  await settle();
  assert.deepEqual(Array.from(page.data.featured, item => item.id), ['featured-one']);
  app.globalData.user = { id: 'another', nickname: '另一位', verified: true };
  await page.onShow();
  await settle();
  assert.deepEqual(Array.from(page.data.featured, item => item.id), ['featured-two']);
  page.onHide();
  assert.deepEqual(Array.from(page.data.featured), []);
  assert.equal(page.data.featuredLoading, false);
});

test('no logged-in user does not request the featured strip', async () => {
  const { page, app, calls } = harness({ items: [post('featured-one')] });
  app.globalData.user = null;
  await page.onShow();
  await settle();
  assert.deepEqual(Array.from(page.data.featured), []);
  assert.equal(calls.includes('/featured'), false);
});
