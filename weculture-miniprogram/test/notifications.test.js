const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const notification = (changes = {}) => ({ id: 'n1', type: 'comment', actor: { id: 'u2', nickname: '互动同学' }, objectType: 'post', objectId: 'p1', postId: 'p1',
  postTitle: '一条文化内容', available: true, readAt: null, createdAt: '2026-11-01T02:00:00.000Z', ...changes });
const pageResult = (items, changes = {}) => ({ items, page: 1, total: items.length, hasMore: false, unreadCount: items.filter(item => !item.readAt).length, ...changes });

function harness(getResult, postResult = { read: true }) {
  let definition;
  const app = { globalData: { user: { id: 'reader', nickname: '读者', verified: true } } };
  const calls = [], toasts = [], destinations = [];
  const wx = { showToast: options => toasts.push(options.title), navigateTo: options => destinations.push(options.url), stopPullDownRefresh() {} };
  const api = {
    get: async url => { calls.push({ method: 'GET', url }); return typeof getResult === 'function' ? getResult(url) : getResult; },
    post: async (url, body) => { calls.push({ method: 'POST', url, body }); return typeof postResult === 'function' ? postResult(url, body) : postResult; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/notifications/index.js'), 'utf8'), {
    Page: value => { definition = value; }, wx, getApp: () => app,
    require: id => {
      if (id.endsWith('/typography')) return { withTypography: value => value };
      if (id.endsWith('/guard')) return { requireLogin: async () => app.globalData.user };
      if (id.endsWith('/api')) return { api };
      if (id.endsWith('/format')) return require('../utils/format');
      throw new Error(`Unexpected module ${id}`);
    }
  });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values); } };
  return { page, app, wx, calls, toasts, destinations };
}

test('notifications load, mark one read and navigate to the related detail', async () => {
  const { page, calls, toasts, destinations } = harness(pageResult([notification()]));
  await page.onShow();
  if (page._loading) await page._loading;
  assert.equal(page.data.unreadCount, 1);
  assert.equal(page.data.notifications[0].typeLabel, '评论了你的内容');
  assert.equal(page.data.notifications[0].read, false);
  await page.openNotification({ currentTarget: { dataset: { id: 'n1' } } });
  assert.equal(calls.filter(call => call.method === 'POST' && call.url === '/me/notifications/n1/read').length, 1);
  assert.equal(page.data.notifications[0].read, true);
  assert.equal(page.data.unreadCount, 0);
  assert.deepEqual(destinations, ['/pages/detail/index?id=p1']);
  assert.deepEqual(toasts, []);
});

test('unavailable notifications do not navigate or mark read', async () => {
  const { page, calls, toasts, destinations } = harness(pageResult([notification({ available: false })]));
  await page.onShow();
  if (page._loading) await page._loading;
  await page.openNotification({ currentTarget: { dataset: { id: 'n1' } } });
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
  assert.deepEqual(destinations, []);
  assert.deepEqual(toasts, ['相关内容已不可用']);
});

test('read all clears every unread notification', async () => {
  const { page, calls, toasts } = harness(pageResult([notification(), notification({ id: 'n2', type: 'reply', objectType: 'comment', objectId: 'c1' })]), { count: 2 });
  await page.onShow();
  if (page._loading) await page._loading;
  await page.readAll();
  assert.equal(calls.filter(call => call.method === 'POST' && call.url === '/me/notifications/read-all').length, 1);
  assert.equal(page.data.unreadCount, 0);
  assert.equal(page.data.notifications.every(item => item.read), true);
  assert.deepEqual(toasts, ['已全部标记为已读']);
});

test('malformed notifications fail safely without rendering unsafe rows', async () => {
  const { page } = harness({ items: [{ id: 'bad', type: 'unknown' }], page: 1, total: 1, hasMore: false, unreadCount: 1 });
  await page.onShow();
  if (page._loading) await page._loading;
  assert.deepEqual(Array.from(page.data.notifications), []);
  assert.match(page.data.error, /通知暂时无法加载/);
});

test('pagination merges unique notifications and stops at the last page', async () => {
  let pageNumber = 0;
  const { page } = harness(() => pageNumber++ === 0 ? pageResult([notification()], { total: 2, hasMore: true }) : pageResult([notification(), notification({ id: 'n2', postId: null, postTitle: '另一条' })], { page: 2, total: 2 }));
  await page.onShow();
  if (page._loading) await page._loading;
  await page.loadMore();
  assert.deepEqual(Array.from(page.data.notifications, item => item.id), ['n1', 'n2']);
  assert.equal(page.data.hasMore, false);
});
