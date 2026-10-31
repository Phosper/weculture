const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const post = (id, authorId = 'author-1') => ({ id, title: id, content: '内容', status: 'approved', type: 'dynamic', circle: 'city', visibility: 'platform',
  author: { id: authorId, nickname: '作者', profileAvailable: true } });
const profile = (changes = {}) => ({ id: 'author-1', nickname: '作者', avatarUrl: '', visiblePostCount: 1, following: false, ...changes });

function harness(authorProfile = profile()) {
  let definition;
  const app = { globalData: { user: { id: 'reader', nickname: '读者', verified: true } } };
  const calls = [], toasts = [];
  const wx = { getStorageSync: key => key === 'token' ? 'reader-token' : '', removeStorageSync() {}, hideShareMenu() {},
    showToast: options => toasts.push(options.title), navigateTo() {}, switchTab() {}, stopPullDownRefresh() {} };
  const api = {
    get: async url => url.includes('/posts?') ? { items: [post('work-1', authorProfile.id)], page: 1, pageSize: 20, total: 1, hasMore: false } : authorProfile,
    post: async (url, body) => { calls.push({ method: 'POST', url, body }); return { following: true }; },
    delete: async url => { calls.push({ method: 'DELETE', url }); return { following: false }; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/author/index.js'), 'utf8'), {
    Page: value => { definition = value; }, wx, getApp: () => app,
    require: id => {
      if (id.endsWith('/typography')) return { withTypography: value => value };
      if (id.endsWith('/guard')) return { requireLogin: async () => app.globalData.user };
      if (id.endsWith('/api')) return { api };
      return require(path.resolve(__dirname, '../pages/author', id));
    }
  });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values); } };
  page.onLoad({ id: authorProfile.id });
  return { page, app, wx, calls, toasts, api };
}

test('author profile exposes follow state and follows/unfollows with feedback', async () => {
  const { page, calls, toasts } = harness();
  await page.onShow();
  if (page._profileRead) await page._profileRead.promise;
  assert.equal(page.data.author.following, false);
  await page.toggleFollow();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, '/users/author-1/follow');
  assert.equal(page.data.author.following, true);
  assert.equal(page.data.followBusy, false);
  assert.deepEqual(toasts, ['已关注']);
  await page.toggleFollow();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, 'DELETE');
  assert.equal(calls[1].url, '/users/author-1/follow');
  assert.equal(page.data.author.following, false);
  assert.deepEqual(toasts, ['已关注', '已取消关注']);
});

test('follow errors stay visible and do not flip the state', async () => {
  const result = harness();
  await result.page.onShow();
  if (result.page._profileRead) await result.page._profileRead.promise;
  const original = result.api.post;
  result.api.post = async () => { throw new Error('网络失败'); };
  await result.page.toggleFollow();
  assert.equal(result.page.data.author.following, false);
  assert.equal(result.page.data.followBusy, false);
  assert.match(result.page.data.followError, /网络失败/);
  result.api.post = original;
});

test('self profiles and stale sessions never issue a follow request', async () => {
  const self = harness(profile({ id: 'reader' }));
  await self.page.onShow();
  if (self.page._profileRead) await self.page._profileRead.promise;
  await self.page.toggleFollow();
  assert.equal(self.calls.length, 0);

  const other = harness();
  await other.page.onShow();
  if (other.page._profileRead) await other.page._profileRead.promise;
  other.app.globalData.user = { id: 'another', verified: true };
  await other.page.toggleFollow();
  assert.equal(other.calls.length, 0);
});
