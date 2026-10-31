const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { draftKey } = require('../utils/publication-draft');

const user = { id: 'reader', nickname: '同学', verified: true, school: { name: '北京语言大学' } };
const draft = (changes = {}) => ({ version: 1, type: 'event', circle: 'city', city: '北京', contentLanguage: 'en', title: '草稿标题', content: '草稿正文', tag: '文化', price: '',
  location: '故宫', startDate: '2026-12-01', startTime: '09:00', endDate: '2026-12-01', endTime: '12:00', deadlineDate: '2026-11-30', deadlineTime: '18:00', capacity: 20, ...changes });

function storage() {
  const map = new Map();
  return { map, getStorageSync: key => map.get(key) || '', setStorageSync: (key, value) => map.set(key, value), removeStorageSync: key => map.delete(key) };
}
function circles(store) {
  const CIRCLES = { city: { label: '同城', notice: '公开展示' }, international: { label: '国际圈', notice: '公开展示' }, campus: { label: '校园圈', notice: '仅本校可见' } };
  const CONTENT_LANGUAGES = [{ value: 'zh', label: '中文' }, { value: 'en', label: 'English' }, { value: 'ru', label: 'Русский' }, { value: 'fr', label: 'Français' }, { value: 'es', label: 'Español' }, { value: 'ar', label: 'العربية' }, { value: 'other', label: '其他语言' }];
  return { CIRCLES, CONTENT_LANGUAGES, normalizeCity: value => typeof value === 'string' ? value.trim().replace(/市$/, '') : '',
    cityFromRegion: region => Array.isArray(region) && region[0] ? String(region[0]).replace(/市$/, '') : '',
    readCity: () => store.getStorageSync('wecultureCity') || '', readCityRegion: city => ['北京', '天津', '上海', '重庆'].includes(city) ? [`${city}市`, `${city}市`, ''] : [],
    saveCity: (city, region) => { store.setStorageSync('wecultureCity', city); if (Array.isArray(region)) store.setStorageSync('wecultureCityRegion', region); } };
}
function harness(account = user, store = storage()) {
  let definition;
  const apiCalls = [], modals = [], tabs = [];
  const app = { globalData: { user: account, cloudConfig: null, publishEntry: null } };
  const circleModule = circles(store);
  const wx = {
    getStorageSync: key => store.getStorageSync(key), setStorageSync: (key, value) => store.setStorageSync(key, value), removeStorageSync: key => store.removeStorageSync(key),
    showModal: options => { modals.push(options); if (options.success) options.success({ confirm: true }); },
    switchTab: options => tabs.push(options.url), navigateTo() {}, showToast() {}, chooseMedia() {}, openSetting() {},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/publish/index.js'), 'utf8'), {
    Page: options => { definition = options; }, wx, getApp: () => app,
    require: id => {
      if (id.endsWith('/typography')) return { withTypography: options => options };
      if (id.endsWith('/guard')) return { requireLogin: async () => app.globalData.user };
      if (id.endsWith('/nav')) return { getNavMetrics: () => ({}), selectTab() {} };
      if (id.endsWith('/publication')) return require('../utils/publication');
      if (id.endsWith('/circles')) return circleModule;
      if (id.endsWith('/location')) return { getCurrentCity: async () => { throw new Error('Automatic location must stay disabled'); }, LOCATION_SCOPE: 'scope.userFuzzyLocation' };
      if (id.endsWith('/features')) return { FEATURES: { automaticCityLocation: false } };
      if (id.endsWith('/publication-draft')) return require('../utils/publication-draft');
      if (id.endsWith('/api')) return { api: { post: async (url, body) => { apiCalls.push({ url, body }); return { id: 'post-1', status: 'pending', circle: body.circle || 'city', city: body.city || '' }; } } };
      throw new Error(`Unexpected module ${id}`);
    }
  });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values); } };
  page.onLoad();
  return { page, app, wx, store, apiCalls, modals, tabs };
}

test('restores a user draft into the publish form and saves later edits', async () => {
  const store = storage();
  store.setStorageSync(draftKey('reader'), JSON.stringify(draft()));
  const { page } = harness(user, store);
  await page.onShow();
  assert.equal(page.data.draftRestored, true);
  assert.equal(page.data.type, 'event');
  assert.equal(page.data.circle, 'city');
  assert.equal(page.data.city, '北京');
  assert.equal(page.data.title, '草稿标题');
  assert.equal(page.data.content, '草稿正文');
  assert.equal(page.data.location, '故宫');
  assert.equal(page.data.capacity, 20);
  assert.equal(page.data.languageIndex, 1);
  assert.equal(page.data.imageTempPath, '');
  page.input({ currentTarget: { dataset: { field: 'title' } }, detail: { value: '更新后的标题' } });
  assert.equal(JSON.parse(store.getStorageSync(draftKey('reader'))).title, '更新后的标题');
  page.onHide();
  assert.equal(JSON.parse(store.getStorageSync(draftKey('reader'))).title, '更新后的标题');
});

test('manual clear removes the draft and resets text fields', async () => {
  const store = storage();
  store.setStorageSync(draftKey('reader'), JSON.stringify(draft()));
  const { page } = harness(user, store);
  await page.onShow();
  page.setData({ imageTempPath: 'wxfile://tmp.jpg' });
  page.clearDraft();
  assert.equal(store.map.has(draftKey('reader')), false);
  assert.equal(page.data.draftRestored, false);
  assert.equal(page.data.title, '');
  assert.equal(page.data.content, '');
  assert.equal(page.data.imageTempPath, '');
});

test('successful submission clears the draft before showing the result', async () => {
  const { page, store, apiCalls, modals, tabs } = harness();
  await page.onShow();
  page.setData({ title: '测试标题', content: '测试正文', circle: 'city', city: '北京', cityRegion: ['北京市', '北京市', ''], type: 'dynamic' });
  page.saveDraft();
  assert.equal(store.map.has(draftKey('reader')), true);
  await page.submit();
  assert.equal(store.map.has(draftKey('reader')), false);
  assert.equal(page.data.title, '');
  assert.equal(page.data.draftRestored, false);
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].url, '/posts');
  assert.equal(modals.length, 1);
  assert.deepEqual(tabs, ['/pages/profile/index']);
});

test('drafts are isolated by account and a corrupt draft is ignored', async () => {
  const store = storage();
  store.setStorageSync(draftKey('user-a'), JSON.stringify(draft({ title: '甲的草稿', content: '甲的内容' })));
  const { page } = harness({ id: 'user-b', verified: true }, store);
  await page.onShow();
  assert.equal(page.data.draftRestored, false);
  assert.equal(page.data.title, '');
  assert.equal(store.map.has(draftKey('user-a')), true);
  page.setData({ title: '乙的标题', content: '乙的内容' });
  page.saveDraft();
  assert.equal(JSON.parse(store.getStorageSync(draftKey('user-b'))).title, '乙的标题');
  assert.equal(JSON.parse(store.getStorageSync(draftKey('user-a'))).title, '甲的草稿');

  const corruptStore = storage();
  corruptStore.setStorageSync(draftKey('reader'), '{bad json');
  const corrupt = harness(user, corruptStore);
  await corrupt.page.onShow();
  assert.equal(corrupt.page.data.draftRestored, false);
  assert.equal(corrupt.page.data.title, '');
});

test('draft storage failures do not block editing or submission', async () => {
  const store = storage();
  const { page } = harness(user, store);
  await page.onShow();
  const write = store.setStorageSync;
  store.setStorageSync = (key, value) => { if (key.startsWith('wecultureDraft:')) throw new Error('quota'); return write(key, value); };
  page.input({ currentTarget: { dataset: { field: 'title' } }, detail: { value: '仍然可以输入' } });
  assert.equal(page.data.title, '仍然可以输入');
  page.setData({ content: '仍然可以提交', circle: 'city', city: '北京' });
  await page.submit();
  assert.equal(page.data.title, '');
});
