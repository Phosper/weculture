const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { formatPost } = require('../utils/format');

function harness(name, api, storage = new Map(), automaticCityLocation = false) {
  let definition;
  const app = { globalData: { user: { id: 'author', verified: true, nickname: '同学' }, cloudConfig: { env: 'test' } } };
  const wx = {
    modals: [], destinations: [], refreshStopped: false,
    getStorageSync: (key) => storage.has(key) ? JSON.parse(storage.get(key)) : '',
    setStorageSync: (key, value) => storage.set(key, JSON.stringify(value)),
    removeStorageSync: (key) => storage.delete(key),
    showModal: (options) => wx.modals.push(options),
    switchTab: (options) => wx.destinations.push(options.url),
    navigateTo: (options) => wx.destinations.push(options.url),
    stopPullDownRefresh: () => { wx.refreshStopped = true; },
    showToast() {},
    requirePrivacyAuthorize: options => options.success(),
    getSetting: options => options.success({ authSetting: {} }),
    getFuzzyLocation: options => options.success({ latitude: 39.9, longitude: 116.4 }),
    openSetting: options => options.success({ authSetting: { 'scope.userFuzzyLocation': true } }),
    cloud: { uploadFile: (options) => options.success({ fileID: 'cloud://image' }) }
  };
  const circles = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../utils/circles.js'), 'utf8'), { wx, module: circles });
  const location = { exports: {} };
  const features = { FEATURES: { automaticCityLocation } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../utils/location.js'), 'utf8'), {
    wx, module: location, setTimeout, clearTimeout,
    require: id => id === '../services/api' ? { api } : id === './features' ? features : circles.exports
  });
  const context = {
    Page: (options) => { definition = options; }, wx, getApp: () => app,
    require: (id) => {
      if (id === '../../services/api') return { api };
      if (id === '../../utils/guard') return { requireVerified: async () => app.globalData.user, requireLogin: async () => app.globalData.user };
      if (id === '../../utils/nav') return { getNavMetrics: () => ({}), selectTab() {} };
      if (id === '../../utils/circles') return circles.exports;
      if (id === '../../utils/location') return location.exports;
      if (id === '../../utils/features') return features;
      return require(path.resolve(__dirname, '../pages', name, id));
    }
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../pages', name, 'index.js'), 'utf8'), context);
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) {
    for (const [key, value] of Object.entries(values)) {
      const parts = key.split('.');
      let target = this.data;
      while (parts.length > 1) target = target[parts.shift()];
      target[parts[0]] = value;
    }
  } };
  return { page, wx, app, storage };
}

function harnessWithLocation(name, api, storage) {
  return harness(name, api, storage, true);
}

function fill(page, fields = {}) {
  page.onLoad();
  page.setData({ title: '校园文化体验', content: '一起记录有趣的校园文化生活。', ...fields });
}

test('U07/U14: pending posts lead to notes even when another profile tab was selected', async () => {
  const { page, wx, app } = harness('publish', { post: async () => ({ id: 'post1', status: 'pending' }) });
  fill(page);
  await page.submit();
  assert.equal(wx.modals[0].title, '审核中');
  assert.equal(page.data.submitting, true);
  wx.modals[0].success({ confirm: true });
  assert.equal(wx.destinations[0], '/pages/profile/index');
  assert.equal(app.globalData.profileEntry.tab, 'notes');
  assert.equal(page.data.title, '');
  await page.onShow();
  assert.equal(page.data.submitting, false);
});

test('U07: automatic approval opens campus and resets the community type filter', async () => {
  const published = harness('publish', { post: async () => ({ id: 'post2', status: 'approved' }) });
  fill(published.page);
  await published.page.submit();
  assert.equal(published.wx.modals[0].title, '发布成功');
  published.wx.modals[0].success({ confirm: true });
  assert.equal(published.wx.destinations[0], '/pages/community/index');
  let requestedPath;
  const community = harness('community', { get: async (url) => { requestedPath = url; return { items: [], hasMore: false }; } });
  community.app.globalData.communityEntry = published.app.globalData.communityEntry;
  community.page.setData({ circle: 'international', type: 'market' });
  await community.page.onShow();
  assert.equal(community.page.data.circle, 'campus');
  assert.equal(community.page.data.type, 'all');
  assert.equal(requestedPath, '/posts?circle=campus&page=1&pageSize=20');
  assert.equal(community.app.globalData.communityEntry, undefined);
});

test('U07c: repeated taps during a slow request or result dialog submit once', async () => {
  let finish;
  let calls = 0;
  const { page, wx } = harness('publish', { post: () => { calls++; return new Promise((resolve) => { finish = resolve; }); } });
  fill(page);
  const pending = page.submit();
  await Promise.resolve();
  await page.submit();
  assert.equal(calls, 1);
  finish({ id: 'post3', status: 'pending' });
  await pending;
  await page.submit();
  assert.equal(calls, 1);
  assert.equal(wx.modals.length, 1);
});

test('U07c: a lost response reuses the request identity and already uploaded image', async () => {
  const payloads = [];
  let uploads = 0;
  const { page, wx } = harness('publish', { post: async (_, data) => {
    payloads.push(data);
    if (payloads.length === 1) throw new Error('网络中断');
    return { id: 'saved-post', status: 'pending' };
  } });
  wx.cloud.uploadFile = (options) => { uploads++; options.success({ fileID: 'cloud://uploaded-once' }); };
  fill(page, { imageTempPath: '/tmp/photo.jpg' });
  await page.submit();
  assert.equal(wx.modals.length, 0);
  assert.equal(page.data.error, '网络中断');
  assert.equal(page.data.title, '校园文化体验');
  await page.submit();
  assert.equal(payloads[0].clientRequestId, payloads[1].clientRequestId);
  assert.equal(payloads[1].imageUrl, 'cloud://uploaded-once');
  assert.equal(uploads, 1);
  assert.equal(wx.modals.length, 1);
});

test('U07: upload failure or a malformed success response never shows success', async () => {
  let calls = 0;
  const { page, wx } = harness('publish', { post: async () => { calls++; return {}; } });
  wx.cloud.uploadFile = (options) => options.fail({ errMsg: 'upload failed' });
  fill(page, { imageTempPath: '/tmp/photo.jpg' });
  await page.submit();
  assert.equal(calls, 0);
  assert.match(page.data.error, /图片上传失败/);
  assert.equal(page.data.submitting, false);
  page.setData({ imageTempPath: '' });
  await page.submit();
  assert.equal(calls, 1);
  assert.match(page.data.error, /暂未确认投稿结果/);
  assert.equal(wx.modals.length, 0);
});

test('U07: missing event location or invalid capacity fails before upload or submission', async () => {
  let calls = 0;
  let uploads = 0;
  const { page, wx } = harness('publish', { post: async () => { calls++; } });
  wx.cloud.uploadFile = () => { uploads++; };
  fill(page, { type: 'event', imageTempPath: '/tmp/photo.jpg' });
  await page.submit();
  assert.match(page.data.error, /活动地点/);
  page.setData({ location: '校园活动室', capacity: 'abc' });
  await page.submit();
  assert.match(page.data.error, /人数上限/);
  assert.equal(calls, 0);
  assert.equal(uploads, 0);
});

test('U08/U14: profile reloads all moderation states and retains a clear failure state', async () => {
  let status = 'pending';
  let fail = false;
  const { page, wx, app } = harness('profile', { get: async (url) => {
    if (fail) throw new Error('网络中断');
    return url === '/me/posts' ? [{ id: 'mine', title: '我的投稿', status, rejectionReason: '请补充活动说明' }] : [];
  } });
  app.globalData.profileEntry = { tab: 'notes' };
  page.setData({ tab: 'saved' });
  await page.onShow();
  assert.equal(page.data.tab, 'notes');
  for (const [next, label] of [['pending', '审核中'], ['approved', '已发布'], ['rejected', '已驳回'], ['offline', '已下架']]) {
    status = next;
    await page.onPullDownRefresh();
    assert.equal(page.data.posts[0].statusLabel, label);
    assert.equal(page.data.posts[0].reviewReason, ['rejected', 'offline'].includes(status) ? '请补充活动说明' : '');
    assert.equal(page.data.loading, false);
    assert.equal(wx.refreshStopped, true);
  }
  fail = true;
  await page.onPullDownRefresh();
  assert.equal(page.data.error, '网络中断');
  assert.equal(page.data.loading, false);
  assert.equal(wx.refreshStopped, true);
});

test('U14: unapproved event preview cannot like, save or register and reloads on return', async () => {
  let status = 'pending';
  let writes = 0;
  const event = { id: 'event1', status: 'active', registrationDeadline: new Date(Date.now() + 86400000).toISOString(), registeredCount: 0, capacity: 20 };
  const { page } = harness('detail', { get: async () => ({ id: 'mine', status, event }), post: async () => { writes++; } });
  page.onLoad({ id: 'mine' });
  await page.onShow();
  assert.equal(page.data.post.statusLabel, '审核中');
  assert.equal(page.data.post.event.registerable, false);
  await page.like(); await page.favorite(); await page.register();
  assert.equal(writes, 0);
  status = 'approved';
  await page.onShow();
  assert.equal(page.data.post.statusLabel, '已发布');
  assert.equal(page.data.post.event.registerable, true);
  assert.equal(formatPost({ status: 'approved', event: { ...event, registered: true } }).event.registerable, false);
});

test('public submissions work without school verification and keep circle metadata', async () => {
  for (const metadata of [{ circle: 'city', city: ' 北京 ' }, { circle: 'international', contentLanguage: 'en' }]) {
    let payload;
    const { page, wx, app } = harness('publish', { post: async (_, data) => { payload = data; return { id: 'public-post', status: 'pending', circle: data.circle }; } });
    app.globalData.user.verified = false;
    fill(page, metadata);
    await page.submit();
    assert.equal(payload.circle, metadata.circle);
    assert.equal(payload.city, metadata.circle === 'city' ? '北京' : undefined);
    assert.equal(payload.contentLanguage, metadata.contentLanguage);
    assert.equal(wx.modals[0].title, '审核中');
    assert.match(wx.modals[0].content, /我的投稿/);
    assert.equal(wx.destinations.length, 0);
  }
});

test('invalid city, language and unverified campus fail before upload or API writes', async () => {
  let writes = 0;
  const { page, app, wx } = harness('publish', { post: async () => { writes++; } });
  let uploads = 0;
  wx.cloud.uploadFile = () => { uploads++; };
  fill(page, { circle: 'city', city: ' ', imageTempPath: '/tmp/image.jpg' });
  await page.submit();
  assert.match(page.data.error, /城市/);
  page.setData({ circle: 'international', contentLanguage: 'invalid' });
  await page.submit();
  assert.match(page.data.error, /语言/);
  app.globalData.user.verified = false;
  page.setData({ circle: 'campus' });
  await page.submit();
  assert.match(page.data.error, /学校认证/);
  assert.equal(writes, 0);
  assert.equal(uploads, 0);
});

test('changing circle after a lost response creates a new submission identity', async () => {
  const payloads = [];
  const { page } = harness('publish', { post: async (_, data) => { payloads.push(data); throw new Error('网络中断'); } });
  fill(page, { circle: 'city', city: '北京' });
  await page.submit();
  await page.submit();
  assert.equal(payloads[0].clientRequestId, payloads[1].clientRequestId);
  page.setData({ circle: 'international', contentLanguage: 'en' });
  await page.submit();
  assert.notEqual(payloads[1].clientRequestId, payloads[2].clientRequestId);
  assert.equal(payloads[2].city, undefined);
});

test('approved public result opens its actual circle and selected city', async () => {
  const { page, app, wx } = harness('publish', { post: async () => ({ id: 'city-approved', status: 'approved', circle: 'city', city: '北京' }) });
  fill(page, { circle: 'city', city: '北京' });
  await page.submit();
  wx.modals[0].success({ confirm: true });
  assert.equal(app.globalData.communityEntry.circle, 'city');
  assert.equal(app.globalData.communityEntry.city, '北京');
  assert.equal(wx.destinations[0], '/pages/community/index');
});

test('circle lists filter on server, retain pagination order, and ignore stale requests', async () => {
  const pending = [];
  const { page } = harness('community', { get: (url) => new Promise(resolve => pending.push({ url, resolve })) });
  page.setData({ user: { verified: true }, circle: 'city', city: '北京', type: 'event' });
  const oldLoad = page.load();
  assert.equal(pending[0].url, '/posts?circle=city&page=1&pageSize=20&city=%E5%8C%97%E4%BA%AC&type=event');
  const latestLoad = page.changeCircle({ currentTarget: { dataset: { circle: 'international' } } });
  pending[1].resolve({ items: [{ id: 'first', status: 'approved', title: '普通投稿', circle: 'international' }], hasMore: true });
  await latestLoad;
  pending[0].resolve({ items: [{ id: 'stale-city', status: 'approved' }], hasMore: false });
  await oldLoad;
  assert.equal(page.data.posts[0].id, 'first');
  assert.equal(page.data.hasMore, true);
  const more = page.loadMore();
  assert.equal(pending[2].url, '/posts?circle=international&page=2&pageSize=20');
  pending[2].resolve({ items: [{ id: 'first', status: 'approved' }, { id: 'second', title: '沉浸式体验非遗：我们在校园里办了一场茶艺社！', status: 'approved', circle: 'international' }], hasMore: false });
  await more;
  assert.deepEqual(Array.from(page.data.posts, post => post.id), ['first', 'second']);
  assert.equal(page.data.page, 2);
  assert.equal(page.data.hasMore, false);
  assert.equal(page.data.posts[1].circle, 'international');
  assert.equal(page.data.posts[1].circles, undefined);
});

test('no city selection or unverified campus shows guidance without fetching', async () => {
  let reads = 0;
  const { page } = harness('community', { get: async () => { reads++; } });
  page.setData({ user: { verified: false }, circle: 'city', city: '', posts: [{ id: 'old' }] });
  await page.load();
  assert.equal(page.data.posts.length, 0);
  await page.changeCircle({ currentTarget: { dataset: { circle: 'campus' } } });
  assert.equal(reads, 0);
  assert.equal(page.data.loading, false);
});

test('author moderation hints describe public visibility and preserve rejection reasons', () => {
  const pending = formatPost({ circle: 'city', city: '北京', status: 'pending' });
  assert.match(pending.statusHint, /北京.*公开/);
  assert.equal(pending.circleLabel, '同城 · 北京');
  assert.match(formatPost({ circle: 'international', contentLanguage: 'en', status: 'approved' }).statusHint, /国际圈.*公开/);
  assert.equal(formatPost({ circle: 'international', status: 'rejected', rejectionReason: '说明不完整' }).reviewReason, '说明不完整');
});

test('city selection refreshes the feed and carries the selected city into a submitted post', async () => {
  const urls = [];
  const community = harness('community', { get: async (url) => { urls.push(url); return { items: [], hasMore: false }; } });
  community.page.setData({ user: community.app.globalData.user, city: '北京', posts: [{ id: 'old-city' }] });
  const region = ['广东省', '广州市', '天河区'];
  await community.page.chooseCity({ detail: { value: region } });
  assert.equal(community.page.data.city, '广州');
  assert.equal(community.page.data.posts.length, 0);
  assert.equal(urls[0], '/posts?circle=city&page=1&pageSize=20&city=%E5%B9%BF%E5%B7%9E');
  community.page.publish();
  let payload;
  const publish = harness('publish', { post: async (_, data) => { payload = data; return { id: 'selected-city', status: 'pending', circle: 'city', city: data.city }; } }, community.storage);
  publish.app.globalData.publishEntry = community.app.globalData.publishEntry;
  fill(publish.page);
  await publish.page.onShow();
  assert.equal(publish.page.data.city, '广州');
  assert.deepEqual(Array.from(publish.page.data.cityRegion), region);
  await publish.page.submit();
  assert.equal(payload.city, '广州');
  assert.equal(payload.circle, 'city');
  assert.equal(payload.district, undefined);
  assert.equal(payload.latitude, undefined);
  assert.equal(publish.wx.getStorageSync('wecultureCity'), '广州');
  assert.deepEqual(publish.wx.getStorageSync('wecultureCityRegion'), region);
});

test('city picker handles municipalities, direct administered cities and autonomous prefectures', () => {
  const { cityFromRegion, normalizeCity } = require('../utils/circles');
  assert.equal(cityFromRegion(['北京市', '市辖区', '东城区']), '北京');
  assert.equal(cityFromRegion(['重庆市', '县', '奉节县']), '重庆');
  assert.equal(cityFromRegion(['湖北省', '省直辖县级行政区划', '仙桃市']), '仙桃');
  assert.equal(cityFromRegion(['新疆维吾尔自治区', '自治区直辖县级行政区划', '石河子市']), '石河子');
  assert.equal(cityFromRegion(['云南省', '大理白族自治州', '大理市']), '大理白族自治州');
  assert.equal(cityFromRegion(['香港特别行政区', '九龙', '油尖旺区']), '香港');
  assert.equal(cityFromRegion(['澳门特别行政区', '澳门半岛', '花地玛堂区']), '澳门');
  assert.equal(cityFromRegion([]), '');
  assert.equal(cityFromRegion('广州'), '');
  assert.equal(normalizeCity(' 北京市 '), '北京');
  assert.equal(normalizeCity('阿里地区'), '阿里地区');
});

test('invalid or unsaved selection keeps the current feed, and submitting locks the city picker', async () => {
  let reads = 0;
  const { page, wx } = harness('community', { get: async () => { reads++; return { items: [], hasMore: false }; } });
  page.setData({ user: { verified: true }, city: '北京', posts: [{ id: 'beijing-post' }] });
  await page.chooseCity({ detail: { value: [] } });
  assert.equal(page.data.city, '北京');
  assert.equal(page.data.posts[0].id, 'beijing-post');
  assert.match(page.data.error, /请选择/);
  wx.setStorageSync = () => { throw new Error('storage unavailable'); };
  await page.chooseCity({ detail: { value: ['上海市', '上海市', '黄浦区'] } });
  assert.equal(page.data.city, '北京');
  assert.match(page.data.error, /未保存/);
  assert.equal(reads, 0);
  const publish = harness('publish', {});
  publish.page.setData({ city: '北京', submitting: true });
  publish.page.chooseCity({ detail: { value: ['上海市', '上海市', '黄浦区'] } });
  assert.equal(publish.page.data.city, '北京');
});

test('a real post sharing a demo title keeps its actual author and uploaded image', () => {
  const title = '沉浸式体验非遗：我们在校园里办了一场茶艺社！';
  const actual = formatPost({ title, circle: 'city', city: '北京', visibility: 'platform', status: 'approved', imageUrl: 'cloud://my-photo', author: { nickname: '真实作者', avatarUrl: 'cloud://my-avatar' } });
  assert.equal(actual.author.nickname, '真实作者');
  assert.equal(actual.author.avatarUrl, 'cloud://my-avatar');
  assert.equal(actual.imageUrl, 'cloud://my-photo');
  assert.equal(actual.collageImages, null);
  assert.equal(formatPost({ title, circle: null, visibility: 'platform', schoolId: null, status: 'approved' }).imageUrl, '/assets/home-tea.jpg');
});

test('automatic city detection refreshes the feed and persists only city metadata', async () => {
  let payload, requestedPath;
  const { page, wx, app, storage } = harnessWithLocation('community', {
    post: async (url, data) => { assert.equal(url, '/location/city'); payload = data; return { city: '广州', region: ['广东省', '广州市', ''] }; },
    get: async url => { requestedPath = url; return { items: [], hasMore: false }; }
  });
  page.setData({ user: app.globalData.user, city: '北京', posts: [{ id: 'old-city' }] });
  await page.locateCity();
  assert.deepEqual({ ...payload }, { latitude: 39.9, longitude: 116.4 });
  assert.equal(page.data.city, '广州');
  assert.match(requestedPath, /city=%E5%B9%BF%E5%B7%9E/);
  assert.equal(wx.getStorageSync('wecultureCity'), '广州');
  assert.equal(page.data.locating, false);
  assert.equal(page.data.locationError, '');
  assert.equal(JSON.stringify(page.data).includes('latitude'), false);
  assert.equal(JSON.stringify(Array.from(storage)).includes('latitude'), false);
});

test('automatic publishing city is submitted without coordinates; lookup blocks premature submission', async () => {
  let finishLookup, started;
  const ready = new Promise(resolve => { started = resolve; });
  const writes = [];
  const { page } = harnessWithLocation('publish', { post: async (url, data) => {
    writes.push({ url, data });
    if (url === '/location/city') { started(); return new Promise(resolve => { finishLookup = resolve; }); }
    return { id: 'location-post', status: 'pending', circle: data.circle, city: data.city };
  } });
  fill(page, { circle: 'city', city: '北京' });
  await page.onShow();
  const locating = page.locateCity();
  await ready;
  await page.locateCity();
  await page.submit();
  assert.equal(writes.length, 1);
  finishLookup({ city: '上海', region: ['上海市', '上海市', ''] });
  await locating;
  await page.submit();
  assert.equal(writes.length, 2);
  assert.equal(writes[1].url, '/posts');
  assert.equal(writes[1].data.city, '上海');
  assert.equal(writes[1].data.latitude, undefined);
  assert.equal(writes[1].data.longitude, undefined);
  assert.equal(writes[1].data.region, undefined);
});

test('manual city selection wins over a slow location result', async () => {
  let finish, started;
  const ready = new Promise(resolve => { started = resolve; });
  const { page, app } = harnessWithLocation('community', {
    post: () => { started(); return new Promise(resolve => { finish = resolve; }); },
    get: async () => ({ items: [{ id: 'manually-selected-city', status: 'approved' }], hasMore: false })
  });
  page.setData({ user: app.globalData.user, city: '北京' });
  const locating = page.locateCity();
  await ready;
  await page.chooseCity({ detail: { value: ['上海市', '上海市', '黄浦区'] } });
  finish({ city: '广州', region: ['广东省', '广州市', ''] });
  await locating;
  assert.equal(page.data.city, '上海');
  assert.equal(page.data.posts[0].id, 'manually-selected-city');
  assert.equal(page.data.locating, false);
});

test('leaving the city circle cancels a slow location result and its error', async () => {
  let finish, started;
  const ready = new Promise(resolve => { started = resolve; });
  const { page, app } = harnessWithLocation('community', {
    post: () => { started(); return new Promise((_, reject) => { finish = reject; }); },
    get: async () => ({ items: [], hasMore: false })
  });
  page.setData({ user: app.globalData.user, city: '北京' });
  const locating = page.locateCity();
  await ready;
  await page.changeCircle({ currentTarget: { dataset: { circle: 'international' } } });
  finish(new Error('service unavailable'));
  await locating;
  assert.equal(page.data.circle, 'international');
  assert.equal(page.data.city, '北京');
  assert.equal(page.data.locationError, '');
  assert.equal(page.data.locating, false);
});

test('denied permission and provider outage retain the selected city and usable manual picker', async () => {
  let writes = 0;
  const { page, wx, app } = harnessWithLocation('community', {
    post: async () => { writes++; throw Object.assign(new Error('provider unavailable'), { statusCode: 503 }); },
    get: async () => ({ items: [], hasMore: false })
  });
  page.setData({ user: app.globalData.user, city: '北京', posts: [{ id: 'existing-post' }] });
  wx.getSetting = options => options.success({ authSetting: { 'scope.userFuzzyLocation': false } });
  await page.locateCity();
  assert.equal(writes, 0);
  assert.equal(page.data.city, '北京');
  assert.equal(page.data.posts[0].id, 'existing-post');
  assert.equal(page.data.locationSettings, true);
  wx.getSetting = options => options.success({ authSetting: { 'scope.userFuzzyLocation': true } });
  await page.locateCity();
  assert.equal(writes, 1);
  assert.equal(page.data.city, '北京');
  assert.equal(page.data.locationSettings, false);
  assert.match(page.data.locationError, /手动选择/);
  await page.chooseCity({ detail: { value: ['天津市', '天津市', '和平区'] } });
  assert.equal(page.data.city, '天津');
  assert.equal(page.data.locationError, '');
});

test('manual-city release makes dormant location handlers inert while preserving selection and publishing', async () => {
  for (const name of ['community', 'publish']) {
    const calls = [];
    const { page, wx, app } = harness(name, {
      get: async url => { calls.push(url); return { items: [], hasMore: false }; },
      post: async (url, data) => { calls.push(url); return { id: 'manual-city-post', status: 'pending', circle: data.circle, city: data.city }; }
    });
    wx.requirePrivacyAuthorize = () => { throw new Error('manual release requested privacy'); };
    wx.getSetting = () => { throw new Error('manual release read location permission'); };
    wx.getFuzzyLocation = () => { throw new Error('manual release requested location'); };
    wx.openSetting = () => { throw new Error('manual release opened permission settings'); };
    if (name === 'publish') fill(page, { circle: 'city', city: '北京' });
    page.setData({ user: app.globalData.user, city: '北京' });
    assert.equal(page.data.automaticCityLocationEnabled, false);
    await page.locateCity();
    page.openLocationSettings();
    assert.deepEqual(calls, []);
    assert.equal(page.data.locating, false);
    assert.equal(page.data.locationError, '');
    assert.equal(page.data.city, '北京');
    // A stale or manipulated view flag cannot enable the build-time location capability.
    page.setData({ automaticCityLocationEnabled: true });
    await page.locateCity();
    page.openLocationSettings();
    assert.deepEqual(calls, []);
    await page.chooseCity({ detail: { value: ['上海市', '上海市', '黄浦区'] } });
    assert.equal(page.data.city, '上海');
    if (name === 'community') {
      assert.match(calls[0], /city=%E4%B8%8A%E6%B5%B7/);
      assert.equal(wx.getStorageSync('wecultureCity'), '上海');
      page.publish();
      assert.equal(app.globalData.publishEntry.city, '上海');
    } else {
      await page.submit();
      assert.deepEqual(calls, ['/posts']);
      assert.equal(page.publishedResult.city, '上海');
    }
    assert.equal(calls.includes('/location/city'), false);
  }
});
