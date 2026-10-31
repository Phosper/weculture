const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { formatPost } = require('../utils/format');

function harness(get, user = { id: 'reader', verified: true }) {
  let definition;
  const calls = [];
  const app = { globalData: { user } };
  const wx = { destinations: [], toasts: [], refreshStopped: false,
    showToast(options) { this.toasts.push(options.title); },
    navigateTo(options) { this.destinations.push(options.url); },
    stopPullDownRefresh() { this.refreshStopped = true; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/home/index.js'), 'utf8'), {
    Page: options => { definition = options; }, wx, getApp: () => app,
    require: id => {
      if (id.endsWith('/typography')) return { withTypography: options => options };
      if (id.endsWith('/guard')) return { requireLogin: () => app.login ? app.login() : Promise.resolve(app.globalData.user) };
      if (id.endsWith('/nav')) return { getNavMetrics: () => ({}), selectTab() {} };
      if (id.endsWith('/format')) return { formatPost };
      if (id.endsWith('/return-path')) return require('../utils/return-path');
      if (id.endsWith('/api')) return { api: { get: url => { if (url === '/featured') return Promise.resolve({ items: [] }); calls.push(url); return get(url); } } };
      throw new Error(`Unexpected module ${id}`);
    }
  });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values); } };
  return { page, app, wx, calls };
}
const post = (id, fields = {}) => ({ id, title: id, content: '文化生活', type: 'dynamic', status: 'approved', visibility: 'platform', author: { nickname: '实际作者' }, ...fields });
const result = (items, fields = {}) => ({ items, page: 1, total: items.length, hasMore: false, ...fields });
const ids = page => Array.from(page.data.posts, item => item.id);
const event = (key, value) => ({ currentTarget: { dataset: { [key]: value } } });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const query = url => new URL(url, 'https://isolated.example').searchParams;

test('latest requests server pagination and retains server order instead of demo ranking', async () => {
  const { page, calls } = harness(async () => result([post('newest', { demoRank: 99 }), post('older', { demoRank: 0 })]));
  await page.onShow();
  assert.equal(calls[0], '/posts?page=1&pageSize=20');
  assert.deepEqual(ids(page), ['newest', 'older']);
  assert.deepEqual(Array.from(page.data.leftPosts, item => item.id), ['newest']);
  assert.equal(page.data.rightPosts[0].id, 'older');
});

test('search sends the complete keyword and trusts matches returned outside the initial page', async () => {
  const { page, calls } = harness(async () => result([post('server-match', { title: '另一个标题', tag: '文化体验' })]));
  await page.onShow();
  page.searchInput({ detail: { value: '  北京 & 100%_!  ' } });
  await page.search();
  assert.equal(query(calls.at(-1)).get('q'), '北京 & 100%_!');
  assert.equal(query(calls.at(-1)).get('page'), '1');
  assert.equal(page.data.activeSearch, '北京 & 100%_!');
  assert.deepEqual(ids(page), ['server-match']);
});

test('scope and type changes reset pagination while retaining the submitted search', async () => {
  const { page, calls } = harness(async () => result([post('match')], { total: 40, hasMore: true }));
  await page.onShow();
  page.searchInput({ detail: { value: '文化' } }); await page.search();
  page.setData({ page: 2 });
  await page.changeFeed(event('feed', 'public'));
  await page.changeType(event('type', 'event'));
  const values = query(calls.at(-1));
  assert.equal(values.get('scope'), 'platform');
  assert.equal(values.get('type'), 'event');
  assert.equal(values.get('q'), '文化');
  assert.equal(values.get('page'), '1');
  assert.equal(page.data.page, 1);
  const count = calls.length;
  await page.changeType(event('type', 'unknown'));
  await page.changeFeed(event('feed', 'unknown'));
  assert.equal(calls.length, count);
});

test('load more keeps committed filters, merges without duplicates and ignores repeated taps', async () => {
  const pending = deferred();
  const { page, calls } = harness(async url => query(url).get('page') === '1' ? result([post('one'), post('two')], { total: 3, hasMore: true }) : pending.promise);
  await page.onShow();
  page.searchInput({ detail: { value: '文化' } }); await page.search();
  page.searchInput({ detail: { value: '尚未提交的新词' } });
  const loading = page.loadMore();
  await page.loadMore();
  assert.equal(calls.length, 3);
  assert.equal(query(calls.at(-1)).get('q'), '文化');
  pending.resolve(result([post('two'), post('three')], { page: 2, total: 3 }));
  await loading;
  assert.deepEqual(ids(page), ['one', 'two', 'three']);
  assert.equal(page.data.page, 2);
  assert.equal(page.data.hasMore, false);
  await page.onReachBottom();
  assert.equal(calls.length, 3);
});

test('a late search response cannot overwrite a newer search or clear its loading state', async () => {
  const first = deferred(), second = deferred();
  const { page } = harness(url => query(url).get('q') === '第一词' ? first.promise : second.promise);
  page.setData({ user: { verified: true }, q: '第一词' });
  const oldSearch = page.search();
  page.setData({ q: '第二词' });
  const newSearch = page.search();
  first.resolve(result([post('old')])); await oldSearch;
  assert.equal(page.data.loading, true);
  assert.deepEqual(ids(page), []);
  second.resolve(result([post('new')])); await newSearch;
  assert.equal(page.data.activeSearch, '第二词');
  assert.deepEqual(ids(page), ['new']);
  assert.equal(page.data.loading, false);
});

test('failed pagination keeps the previous page and retry requests the same next page', async () => {
  let fail = true;
  const { page, calls } = harness(async url => {
    if (query(url).get('page') === '1') return result([post('one')], { total: 2, hasMore: true });
    if (fail) throw new Error('网络中断');
    return result([post('two')], { page: 2, total: 2 });
  });
  await page.onShow(); await page.loadMore();
  assert.deepEqual(ids(page), ['one']);
  assert.equal(page.data.page, 1);
  assert.equal(page.data.error, '网络中断');
  fail = false; await page.retry();
  assert.equal(query(calls.at(-1)).get('page'), '2');
  assert.deepEqual(ids(page), ['one', 'two']);
  assert.equal(page.data.error, '');
});

test('an incompatible response shows a failure and initial retry reloads page one', async () => {
  let valid = false;
  const { page, calls } = harness(async () => valid ? result([post('recovered')]) : [post('legacy-array')]);
  await page.onShow();
  assert.match(page.data.error, /无法加载/);
  assert.equal(page.data.loading, false);
  assert.equal(page.data.page, 0);
  valid = true; await page.retry();
  assert.equal(query(calls.at(-1)).get('page'), '1');
  assert.deepEqual(ids(page), ['recovered']);
});

test('unverified campus selection does not query school data and authentication unlocks only campus scope', async () => {
  const { page, calls, app, wx } = harness(async () => result([post('school')]), { id: 'reader', verified: false });
  await page.onShow();
  await page.changeFeed(event('feed', 'campus'));
  assert.equal(calls.length, 1);
  assert.deepEqual(ids(page), []);
  assert.equal(page.data.loading, false);
  page.toVerify(); assert.equal(wx.destinations[0], '/pages/verify/index');
  app.globalData.user = { id: 'reader', verified: true };
  await page.onShow();
  assert.equal(query(calls.at(-1)).get('circle'), 'campus');
  assert.equal(query(calls.at(-1)).has('schoolId'), false);
});

test('leaving the page invalidates pending responses and login completion', async () => {
  const pending = deferred(), entered = deferred();
  const { page, app, calls } = harness(() => { entered.resolve(); return pending.promise; });
  const request = page.onShow();
  await entered.promise; page.onHide();
  pending.resolve(result([post('late')])); await request;
  assert.deepEqual(ids(page), []);
  const login = deferred(); app.login = () => login.promise;
  const showing = page.onShow(); page.onHide();
  login.resolve({ verified: true }); await showing;
  assert.equal(calls.length, 1);
});

test('expired login clears previously displayed school content and pagination', async () => {
  const { page, app } = harness(async () => result([post('private')], { total: 3, hasMore: true }));
  await page.onShow(); app.globalData.user = null;
  await page.onShow();
  assert.equal(page.data.user, null);
  assert.deepEqual(ids(page), []);
  assert.equal(page.data.hasMore, false);
  assert.equal(page.data.total, 0);
});

test('clear and empty-result recovery reset the intended search and range', async () => {
  const { page, calls } = harness(async () => result([]));
  await page.onShow();
  page.setData({ feed: 'campus', type: 'event', q: '无匹配', activeSearch: '无匹配' });
  await page.clearSearch();
  assert.equal(query(calls.at(-1)).get('circle'), 'campus');
  assert.equal(query(calls.at(-1)).get('type'), 'event');
  assert.equal(query(calls.at(-1)).has('q'), false);
  page.setData({ q: '无匹配', activeSearch: '无匹配' });
  page.focusSearch(); assert.equal(page.data.searchFocused, true);
  await page.viewLatest();
  assert.equal(calls.at(-1), '/posts?page=1&pageSize=20');
  assert.equal(page.data.feed, 'latest');
  assert.equal(page.data.type, 'all');
  assert.equal(page.data.activeSearch, '');
});

test('overlong queries do not request data and failed pull-down refresh always stops the spinner', async () => {
  const { page, calls, wx } = harness(async () => { throw new Error('服务暂不可用'); });
  page.setData({ user: { verified: true }, q: '字'.repeat(101) });
  await page.search();
  assert.equal(calls.length, 0);
  assert.match(wx.toasts[0], /100/);
  await page.onPullDownRefresh();
  assert.equal(wx.refreshStopped, true);
  assert.equal(page.data.loading, false);
  assert.equal(page.data.error, '服务暂不可用');
});
