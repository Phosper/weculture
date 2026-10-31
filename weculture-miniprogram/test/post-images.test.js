const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { formatPost } = require('../utils/format');

function harness() {
  let definition;
  const storage = new Map(), payloads = [];
  let uploads = 0;
  const app = { globalData: { user: { id: 'author', verified: true, nickname: '作者' }, cloudConfig: { env: 'test' } } };
  const wx = {
    getStorageSync: key => storage.has(key) ? JSON.parse(storage.get(key)) : '',
    setStorageSync: (key, value) => storage.set(key, JSON.stringify(value)),
    removeStorageSync: key => storage.delete(key),
    chooseMedia: options => options.success({ tempFiles: [{ tempFilePath: '/tmp/a.jpg' }, { tempFilePath: '/tmp/b.jpg' }] }),
    cloud: { uploadFile: options => options.success({ fileID: `cloud://image-${++uploads}` }) },
    showToast() {}, showModal() {}, switchTab() {}, navigateTo() {}, stopPullDownRefresh() {}, openSetting() {},
  };
  const circles = { CIRCLES: { city: { label: '同城', notice: '公开' }, international: { label: '国际圈', notice: '公开' }, campus: { label: '校园圈', notice: '校内' } },
    CONTENT_LANGUAGES: [{ value: 'zh', label: '中文' }], normalizeCity: value => typeof value === 'string' ? value.trim() : '',
    cityFromRegion: () => '北京', readCity: () => '北京', readCityRegion: () => ['北京市', '北京市', ''], saveCity() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/publish/index.js'), 'utf8'), {
    Page: value => { definition = value; }, wx, getApp: () => app,
    require: id => {
      if (id.endsWith('/typography')) return { withTypography: value => value };
      if (id.endsWith('/guard')) return { requireLogin: async () => app.globalData.user };
      if (id.endsWith('/nav')) return { getNavMetrics: () => ({}), selectTab() {} };
      if (id.endsWith('/publication')) return require('../utils/publication');
      if (id.endsWith('/circles')) return circles;
      if (id.endsWith('/location')) return { getCurrentCity: async () => ({ city: '北京', cityRegion: [] }), LOCATION_SCOPE: 'scope.userFuzzyLocation' };
      if (id.endsWith('/features')) return { FEATURES: { automaticCityLocation: false } };
      if (id.endsWith('/publication-draft')) return require('../utils/publication-draft');
      if (id.endsWith('/api')) return { api: { post: async (url, body) => { payloads.push({ url, body }); return { id: 'post-1', status: 'pending', circle: body.circle, city: body.city }; } } };
      throw new Error(`Unexpected module ${id}`);
    }
  });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values); } };
  page.onLoad();
  return { page, storage, payloads, uploads: () => uploads };
}

test('publish selects multiple images, changes the cover and uploads each once', async () => {
  const { page, payloads, uploads } = harness();
  page.setData({ title: '多图发布', content: '多图发布正文', circle: 'city', city: '北京' });
  page.chooseImage();
  assert.deepEqual(Array.from(page.data.imageTempPaths), ['/tmp/a.jpg', '/tmp/b.jpg']);
  page.setCover({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(page.data.coverIndex, 1);
  assert.equal(page.data.imageTempPath, '/tmp/b.jpg');
  await page.submit();
  const body = payloads.at(-1).body;
  assert.deepEqual(Array.from(body.imageUrls), ['cloud://image-1', 'cloud://image-2']);
  assert.equal(body.coverIndex, 1);
  assert.equal(body.imageUrl, 'cloud://image-2');
  assert.equal(uploads(), 2);
  assert.deepEqual(Array.from(page.data.imageTempPaths), []);
});

test('removing an image keeps the cover index inside the remaining list', () => {
  const { page } = harness();
  page.setData({ imageTempPaths: ['/tmp/a.jpg', '/tmp/b.jpg', '/tmp/c.jpg'], coverIndex: 2, imageTempPath: '/tmp/c.jpg' });
  page.removeImage({ currentTarget: { dataset: { index: 0 } } });
  assert.deepEqual(Array.from(page.data.imageTempPaths), ['/tmp/b.jpg', '/tmp/c.jpg']);
  assert.equal(page.data.coverIndex, 1);
  assert.equal(page.data.imageTempPath, '/tmp/c.jpg');
  page.removeImage({ currentTarget: { dataset: { index: 0 } } });
  page.removeImage({ currentTarget: { dataset: { index: 0 } } });
  assert.deepEqual(Array.from(page.data.imageTempPaths), []);
  assert.equal(page.data.coverIndex, 0);
  assert.equal(page.data.imageTempPath, '');
});

test('formatPost exposes ordered images and the selected cover while preserving the single-image alias', () => {
  const formatted = formatPost({ title: '多图', circle: 'city', city: '北京', visibility: 'platform', status: 'approved', imageUrls: ['/a.jpg', '/b.jpg'], coverIndex: 1, imageUrl: '/b.jpg', author: { nickname: '作者' } });
  assert.deepEqual(Array.from(formatted.imageUrls), ['/a.jpg', '/b.jpg']);
  assert.equal(formatted.coverIndex, 1);
  assert.equal(formatted.coverUrl, '/b.jpg');
  assert.equal(formatted.imageUrl, '/b.jpg');
});
