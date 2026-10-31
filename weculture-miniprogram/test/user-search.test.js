const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { formatPost } = require('../utils/format');
const authors = require('../utils/authors');

function harness(get = async () => result(), user = { id: 'reader', verified: true }) {
  let definition;
  const calls = [];
  const app = { globalData: { user }, token: 'reader-token' };
  const wx = { destinations: [], toasts: [], refreshStopped: false,
    showToast(options) { this.toasts.push(options.title); },
    navigateTo(options) { this.destinations.push(options.url); },
    stopPullDownRefresh() { this.refreshStopped = true; },
    getStorageSync() { return app.token; },
    removeStorageSync() { app.token = ''; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/home/index.js'), 'utf8'), {
    Page: options => { definition = options; }, wx, getApp: () => app,
    require: id => {
      if (id.endsWith('/typography')) return { withTypography: options => options };
      if (id.endsWith('/guard')) return { requireLogin: () => app.login ? app.login() : Promise.resolve(app.globalData.user) };
      if (id.endsWith('/nav')) return { getNavMetrics: () => ({}), selectTab() {} };
      if (id.endsWith('/format')) return { formatPost };
      if (id.endsWith('/authors')) return authors;
      if (id.endsWith('/api')) return { api: { get: url => { calls.push(url); return get(url); } } };
      throw new Error(`Unexpected module ${id}`);
    }
  });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values); } };
  return { page, app, wx, calls };
}
const author = (id, fields = {}) => ({ id, nickname: '文化作者', avatarUrl: 'https://example.test/avatar.jpg', visiblePostCount: 2, ...fields });
const post = id => ({ id, title: id, content: '文化生活', type: 'dynamic', visibility: 'platform', author: { nickname: '作者' } });
const result = (items = [], fields = {}) => ({ items, page: 1, pageSize: 20, total: items.length, hasMore: false, ...fields });
const event = (key, value) => ({ currentTarget: { dataset: { [key]: value } } });
const ids = page => Array.from(page.data.users, item => item.id);
const query = url => new URL(url, 'https://isolated.example').searchParams;
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function enterUserSearch(page, keyword = '作者') {
  await page.onShow();
  await page.changeSearchMode(event('mode', 'users'));
  page.searchInput({ detail: { value: keyword } });
  await page.search();
}

test('user mode requires a nickname and preserves the content scope, type and time selection', async () => {
  const { page, calls } = harness();
  await page.onShow();
  assert.equal(page.data.searchMode, 'content');
  await page.changeFeed(event('feed', 'public'));
  await page.changeType(event('type', 'event'));
  await page.changeEventTime(event('eventTime', 'week'));
  const count = calls.length;
  await page.changeSearchMode(event('mode', 'users'));
  await page.loadMore(); await page.retry(); await page.onPullDownRefresh();
  await page.changeFeed(event('feed', 'campus'));
  await page.changeType(event('type', 'market'));
  await page.changeEventTime(event('eventTime', 'today'));
  assert.equal(calls.length, count);
  assert.equal(page.data.userPage, 0);
  assert.deepEqual(Array.from(page.data.posts), []);
  await page.changeSearchMode(event('mode', 'invalid'));
  assert.equal(page.data.searchMode, 'users');
  await page.changeSearchMode(event('mode', 'content'));
  assert.equal(query(calls.at(-1)).get('scope'), 'platform');
  assert.equal(query(calls.at(-1)).get('type'), 'event');
  assert.equal(query(calls.at(-1)).get('eventTime'), 'week');
});

test('user search sends only a trimmed nickname and pagination, even with inaccessible campus content selected', async () => {
  const { page, calls } = harness(async url => url.startsWith('/users?') ? result([author('one'), author('two')]) : result(), { id: 'reader', verified: false });
  await page.onShow();
  await page.changeFeed(event('feed', 'campus'));
  page.setData({ type: 'event', eventTime: 'today' });
  await page.changeSearchMode(event('mode', 'users'));
  page.searchInput({ detail: { value: '  茶 & 100%_!  ' } });
  await page.search();
  assert.equal(calls.at(-1), '/users?q=%E8%8C%B6%20%26%20100%25_!&page=1&pageSize=20');
  assert.equal(page.data.q, '茶 & 100%_!');
  assert.equal(page.data.activeSearch, '茶 & 100%_!');
  assert.deepEqual(ids(page), ['one', 'two']);
  assert.equal(page.data.userTotal, 2);
  assert.equal(page.data.page, 0);
});

test('mode changes reuse the submitted keyword and discard unsent input and previous results', async () => {
  const { page, calls } = harness(async url => result(url.startsWith('/users?') ? [author('user')] : [post('content')]));
  await enterUserSearch(page, '提交词');
  page.searchInput({ detail: { value: '未提交词' } });
  await page.changeSearchMode(event('mode', 'content'));
  assert.equal(query(calls.at(-1)).get('q'), '提交词');
  assert.equal(page.data.q, '提交词');
  assert.deepEqual(ids(page), []);
  assert.equal(page.data.userPage, 0);
  assert.equal(page.data.userTotal, 0);
  assert.deepEqual(Array.from(page.data.posts, item => item.id), ['content']);
  await page.changeSearchMode(event('mode', 'users'));
  assert.equal(query(calls.at(-1)).get('q'), '提交词');
  assert.equal(page.data.page, 0);
  assert.deepEqual(Array.from(page.data.posts), []);
});

test('same-nickname authors remain distinct and pages merge by safe author id with one request per page', async () => {
  const pending = deferred();
  const { page, calls } = harness(async url => !url.startsWith('/users?') ? result() : query(url).get('page') === '1'
    ? result([author('one'), author('two'), author('one')], { total: 3, hasMore: true }) : pending.promise);
  await enterUserSearch(page);
  page.searchInput({ detail: { value: '尚未提交' } });
  const loading = page.loadMore(); await page.loadMore();
  assert.equal(calls.filter(url => url.startsWith('/users?')).length, 2);
  assert.equal(query(calls.at(-1)).get('q'), '作者');
  assert.equal(query(calls.at(-1)).get('page'), '2');
  pending.resolve(result([author('two'), author('three')], { page: 2, total: 3 })); await loading;
  assert.deepEqual(ids(page), ['one', 'two', 'three']);
  assert.equal(page.data.userPage, 2);
  assert.equal(page.data.userHasMore, false);
  await page.onReachBottom();
  assert.equal(calls.filter(url => url.startsWith('/users?')).length, 2);
});

test('failed pagination and duplicate response pages keep earlier users and retry the same next page', async () => {
  let attempt = 0;
  const { page, calls } = harness(async url => {
    if (!url.startsWith('/users?')) return result();
    if (query(url).get('page') === '1') return result([author('one')], { total: 2, hasMore: true });
    attempt += 1;
    if (attempt === 1) throw new Error('网络中断');
    if (attempt === 2) return result([author('wrong-page')]);
    return result([author('two')], { page: 2, total: 2 });
  });
  await enterUserSearch(page); await page.loadMore();
  assert.equal(page.data.userError, '网络中断');
  assert.equal(page.data.userPage, 1);
  assert.deepEqual(ids(page), ['one']);
  await page.retry();
  assert.match(page.data.userError, /无法加载/);
  assert.deepEqual(ids(page), ['one']);
  await page.retry();
  assert.equal(query(calls.at(-1)).get('page'), '2');
  assert.deepEqual(ids(page), ['one', 'two']);
  assert.equal(page.data.userError, '');
});

test('incompatible envelopes fail safely and initial retry requests page one', async () => {
  let response = [author('legacy')];
  const { page, calls } = harness(async url => url.startsWith('/users?') ? response : result());
  await enterUserSearch(page);
  assert.match(page.data.userError, /无法加载/);
  assert.equal(page.data.userPage, 0);
  assert.equal(page.data.userLoading, false);
  response = result([author('recovered')]); await page.retry();
  assert.equal(query(calls.at(-1)).get('page'), '1');
  assert.deepEqual(ids(page), ['recovered']);
  assert.equal(page.data.userError, '');
});

test('malformed author rows never create unsafe links or expose authors without visible works', async () => {
  const { page, wx } = harness(async url => !url.startsWith('/users?') ? result() : result([
    null, author('../bad'), author('bad&query'), author('a'.repeat(81)), author('hidden', { visiblePostCount: 0 }),
    author('missing-count', { visiblePostCount: '2' }), author('no-name', { nickname: ' ' }), author('no-id', { id: null }),
    author('safe_id-2', { nickname: '  合法昵称  ', avatarUrl: { url: 'wrong' } }), author('safe', { avatarUrl: 'javascript:alert(1)' })
  ]));
  await enterUserSearch(page);
  assert.deepEqual(ids(page), ['safe_id-2', 'safe']);
  assert.equal(page.data.users[0].nickname, '合法昵称');
  assert.equal(page.data.users[0].avatarUrl, '/assets/default-profile-avatar.jpg');
  assert.equal(page.data.users[1].avatarUrl, '/assets/default-profile-avatar.jpg');
  page.openAuthor(event('id', 'safe_id-2'));
  page.openAuthor(event('id', '../bad'));
  page.openAuthor(event('id', 'not-in-results'));
  assert.deepEqual(wx.destinations, ['/pages/author/index?id=safe_id-2']);
});

test('all-duplicate pages claiming more users fail without advancing into an endless result list', async () => {
  const { page } = harness(async url => !url.startsWith('/users?') ? result() : result([author('one')], {
    page: Number(query(url).get('page')), total: 5, hasMore: true
  }));
  await enterUserSearch(page); await page.loadMore();
  assert.deepEqual(ids(page), ['one']);
  assert.equal(page.data.userPage, 1);
  assert.match(page.data.userError, /无法加载/);
});

test('an all-malformed result claiming existing users shows a retry error instead of an empty match', async () => {
  const { page } = harness(async url => !url.startsWith('/users?') ? result() : result([author('../unsafe'), author('hidden', { visiblePostCount: 0 })]));
  await enterUserSearch(page);
  assert.deepEqual(ids(page), []);
  assert.equal(page.data.userPage, 0);
  assert.match(page.data.userError, /无法加载/);
});

test('blank and overlong nicknames never request a user directory; clearing also cancels in-flight results', async () => {
  const pending = deferred();
  const { page, calls, wx } = harness(url => url.startsWith('/users?') ? pending.promise : Promise.resolve(result()));
  await page.onShow(); await page.changeSearchMode(event('mode', 'users'));
  page.searchInput({ detail: { value: '  ' } }); await page.search();
  page.searchInput({ detail: { value: '字'.repeat(101) } }); await page.search();
  assert.equal(calls.length, 1);
  assert.match(wx.toasts[0], /昵称/);
  assert.match(wx.toasts[1], /100/);
  page.searchInput({ detail: { value: '旧作者' } }); const loading = page.search();
  await page.clearSearch();
  pending.resolve(result([author('late')])); await loading;
  assert.deepEqual(ids(page), []);
  assert.equal(page.data.activeSearch, '');
  assert.equal(page.data.userPage, 0);
  assert.equal(page.data.userLoading, false);
  assert.equal(calls.filter(url => url.startsWith('/users?')).length, 1);
});

test('late user search responses and errors cannot overwrite a newer nickname or its loading state', async () => {
  const old = deferred(), middle = deferred(), current = deferred();
  const { page } = harness(url => !url.startsWith('/users?') ? Promise.resolve(result()) :
    query(url).get('q') === '旧' ? old.promise : query(url).get('q') === '中' ? middle.promise : current.promise);
  await page.onShow(); await page.changeSearchMode(event('mode', 'users'));
  page.setData({ q: '旧' }); const first = page.search();
  page.setData({ q: '中' }); const second = page.search();
  page.setData({ q: '新' }); const third = page.search();
  old.resolve(result([author('stale')])); await first;
  middle.reject(new Error('过期失败')); await second;
  assert.deepEqual(ids(page), []);
  assert.equal(page.data.userLoading, true);
  assert.equal(page.data.userError, '');
  current.resolve(result([author('current')])); await third;
  assert.deepEqual(ids(page), ['current']);
  assert.equal(page.data.userLoading, false);
});

test('switching modes invalidates both content and user requests', async () => {
  const content = deferred(), users = deferred();
  const { page } = harness(url => url.startsWith('/users?') ? users.promise : content.promise);
  page.setData({ user: { id: 'reader', verified: true }, q: '作者' });
  const loadingContent = page.search();
  const loadingUsers = page.changeSearchMode(event('mode', 'users'));
  content.resolve(result([post('stale-content')])); await loadingContent;
  assert.deepEqual(Array.from(page.data.posts), []);
  assert.equal(page.data.userLoading, true);
  const currentContent = page.changeSearchMode(event('mode', 'content'));
  users.resolve(result([author('stale-user')])); await loadingUsers; await currentContent;
  assert.deepEqual(ids(page), []);
  assert.equal(page.data.userLoading, false);
  assert.deepEqual(Array.from(page.data.posts, item => item.id), ['stale-content']);
});

test('leaving ignores pending user results and login completions while same-account return preserves search mode', async () => {
  let pending = deferred();
  const { page, app, calls } = harness(url => url.startsWith('/users?') ? pending.promise : Promise.resolve(result()));
  await page.onShow(); await page.changeSearchMode(event('mode', 'users'));
  page.setData({ q: '昵称' }); const loading = page.search();
  page.onHide(); pending.resolve(result([author('late')])); await loading;
  assert.deepEqual(ids(page), []);
  assert.equal(page.data.userLoading, false);
  pending = { promise: Promise.resolve(result([author('returned')])) };
  await page.onShow();
  assert.equal(page.data.searchMode, 'users');
  assert.equal(query(calls.at(-1)).get('q'), '昵称');
  assert.deepEqual(ids(page), ['returned']);
  const login = deferred(); app.login = () => login.promise;
  const count = calls.length;
  const showing = page.onShow(); page.onUnload();
  login.resolve({ id: 'reader', verified: true }); await showing;
  assert.equal(calls.length, count);
  assert.deepEqual(ids(page), []);
});

test('account changes and expired login erase user search before displaying another account content', async () => {
  const old = deferred(), login = deferred();
  const { page, app, calls } = harness(url => url.startsWith('/users?') ? old.promise : Promise.resolve(result([post('current')])));
  await page.onShow(); await page.changeSearchMode(event('mode', 'users'));
  page.setData({ q: '旧昵称' }); const loading = page.search();
  app.login = () => login.promise; const showing = page.onShow();
  old.reject(new Error('旧账号失败')); await loading;
  assert.equal(page.data.userError, '');
  login.resolve({ id: 'another', verified: false }); await showing;
  assert.equal(page.data.searchMode, 'content');
  assert.equal(page.data.q, '');
  assert.equal(page.data.activeSearch, '');
  assert.equal(calls.at(-1), '/posts?page=1&pageSize=20');
  assert.deepEqual(ids(page), []);
  app.login = () => Promise.resolve(null); await page.onShow();
  assert.equal(page.data.user, null);
  assert.equal(page.data.userPage, 0);
  assert.equal(page.data.userHasMore, false);
  assert.deepEqual(Array.from(page.data.posts), []);
});

test('search taps while account authentication is pending cannot start a user read for the previous reader', async () => {
  const login = deferred();
  const { page, app, calls } = harness();
  await page.onShow(); await page.changeSearchMode(event('mode', 'users'));
  app.login = () => login.promise;
  const count = calls.length;
  const showing = page.onShow();
  page.searchInput({ detail: { value: '待登录昵称' } }); await page.search();
  assert.equal(calls.length, count);
  app.globalData.user = { id: 'another', verified: false };
  login.resolve(app.globalData.user); await showing;
  assert.equal(page.data.searchMode, 'content');
  assert.equal(page.data.activeSearch, '');
  assert.equal(calls.at(-1), '/posts?page=1&pageSize=20');
  assert.equal(calls.filter(url => url.startsWith('/users?')).length, 0);
});

for (const [name, change] of [
  ['account', app => { app.globalData.user = { id: 'another', verified: true }; }],
  ['logout', app => { app.globalData.user = null; }],
  ['token', app => { app.token = 'changed-token'; }],
  ['verification', app => { app.globalData.user.verified = false; }],
  ['school', app => { app.globalData.user.schoolId = 'another-school'; }],
  ['nested school', app => { app.globalData.user.school = { id: 'nested-school' }; }]
]) {
  test(`a ${name} change without page lifecycle events clears displayed authors and rejects pending results`, async () => {
    const pending = deferred();
    const { page, app } = harness(async url => !url.startsWith('/users?') ? result() : query(url).get('page') === '1'
      ? result([author('before')], { total: 2, hasMore: true }) : pending.promise);
    await enterUserSearch(page);
    const loading = page.loadMore(); change(app);
    pending.resolve(result([author('after')], { page: 2, total: 2 })); await loading;
    assert.deepEqual(ids(page), []);
    assert.equal(page.data.userPage, 0);
    assert.equal(page.data.userHasMore, false);
    assert.equal(page.data.userLoading, false);
    assert.match(page.data.userError, /登录或学校认证状态已变化/);
  });
}

test('changed session rejects in-flight errors and retry re-authenticates before searching again', async () => {
  const pending = deferred(); let reads = 0;
  const { page, app, calls } = harness(url => {
    if (!url.startsWith('/users?')) return Promise.resolve(result());
    reads += 1;
    return reads === 1 ? pending.promise : Promise.resolve(result([author('recovered')]));
  });
  await page.onShow(); await page.changeSearchMode(event('mode', 'users'));
  page.setData({ q: '昵称' }); const loading = page.search();
  app.token = 'changed-token'; pending.reject(new Error('旧请求错误')); await loading;
  assert.match(page.data.userError, /登录或学校认证状态已变化/);
  await page.loadMore();
  assert.equal(calls.length, 2);
  await page.retry();
  assert.deepEqual(ids(page), ['recovered']);
  assert.equal(page.data.userError, '');
});

test('session changes after rendering prevent profile navigation and a new pagination request', async () => {
  const { page, app, calls, wx } = harness(async url => !url.startsWith('/users?') ? result() : result([author('before')], { total: 2, hasMore: true }));
  await enterUserSearch(page);
  app.token = 'new-token';
  page.openAuthor(event('id', 'before'));
  await page.loadMore();
  assert.deepEqual(wx.destinations, []);
  assert.equal(calls.length, 2);
  assert.deepEqual(ids(page), []);
  assert.match(page.data.userError, /登录或学校认证状态已变化/);
});

for (const statusCode of [401, 403]) {
  test(`a ${statusCode} pagination failure clears all author results and requires a refreshed login`, async () => {
    const failure = Object.assign(new Error('denied'), { statusCode });
    const { page, app, calls } = harness(async url => !url.startsWith('/users?') ? result() : query(url).get('page') === '1'
      ? result([author('previous')], { total: 2, hasMore: true }) : Promise.reject(failure));
    await enterUserSearch(page); await page.loadMore();
    assert.deepEqual(ids(page), []);
    assert.equal(page.data.userPage, 0);
    assert.equal(page.data.userTotal, 0);
    assert.equal(page.data.userHasMore, false);
    assert.equal(page.data.userLoading, false);
    assert.equal(app.globalData.user, null);
    assert.equal(app.token, statusCode === 401 ? '' : 'reader-token');
    assert.match(page.data.userError, statusCode === 401 ? /登录已失效/ : /访问权限已变化/);
    const count = calls.length;
    await page.loadMore(); await page.retry();
    assert.equal(calls.length, count);
    assert.equal(page.data.user, null);
    assert.equal(page.data.searchMode, 'content');
  });
}

test('user refresh failure stops the spinner and UI keeps content-only controls within content mode', async () => {
  const { page, wx } = harness(async url => {
    if (url.startsWith('/users?')) throw new Error('暂时无法查找作者');
    return result();
  });
  await enterUserSearch(page);
  await page.onPullDownRefresh();
  assert.equal(wx.refreshStopped, true);
  assert.equal(page.data.userLoading, false);
  assert.equal(page.data.userError, '暂时无法查找作者');
  const markup = fs.readFileSync(path.join(__dirname, '../pages/home/index.wxml'), 'utf8');
  const contentStart = markup.indexOf('<block wx:if="{{searchMode === \'content\'}}">');
  const userStart = markup.indexOf('<block wx:else>');
  for (const marker of ['class="assistant-strip"', 'class="feed-tabs"', 'class="type-filters"', 'class="event-time-panel"', 'class="discovery-banner"', 'class="verify-link"']) {
    assert.ok(markup.indexOf(marker) > contentStart && markup.indexOf(marker) < userStart, marker);
  }
  assert.match(markup.slice(userStart), /按昵称查找有可见作品的作者/);
  assert.match(markup.slice(userStart), /bindtap="openAuthor"/);
});
