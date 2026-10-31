const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(value, failSave = false, fontMode = 'success', SDKVersion = '3.17.2') {
  const storage = new Map([['wecultureTypography', value]]);
  const pages = [0, 1].map(() => ({ data: {}, setData(value) { Object.assign(this.data, value); }, getTabBar() { return this.bar; }, bar: { data: {}, setData(value) { Object.assign(this.data, value); } } }));
  const module = { exports: {} };
  const loadedFonts = [];
  let packageLoads = 0;
  const wx = {
    getStorageSync: key => storage.get(key),
    setStorageSync(key, value) { if (failSave) throw new Error('storage full'); storage.set(key, value); },
    getAppBaseInfo: () => ({ SDKVersion })
  };
  const require = { async(file) { assert.equal(file, '../pages/typography/serif-resource.js'); packageLoads += 1; return Promise.resolve({ family: 'WecultureReadingSerif', format: 'woff2', base64: 'd09GMg==' }); } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/typography.js'), 'utf8'), {
    module, wx, require, getCurrentPages: () => pages, setTimeout, clearTimeout
  });
  module.exports.initializeTypography(options => {
    loadedFonts.push(options);
    if (fontMode === 'success') options.success();
    else if (fontMode === 'error') options.fail();
  });
  return { api: module.exports, storage, pages, loadedFonts, wx, packageLoads: () => packageLoads };
}

test('invalid stored font preferences fall back without accepting arbitrary CSS', () => {
  const { api } = setup({ font: 'serif;background:red', size: 'huge' });
  const data = api.typographyData();
  assert.equal(data.typographyPreferences.font, 'default');
  assert.equal(data.typographyPreferences.size, 'standard');
  assert.equal(data.fontPageStyle.includes('background'), false);
});

test('saving updates cached pages and tab bars and survives a new session', async () => {
  const { api, storage, pages } = setup();
  await api.ensureSerifFont();
  api.savePreferences({ font: 'serif', size: 'larger' });
  for (const page of pages) {
    assert.equal(page.data.typographySummary, '宋体风格 · 更大');
    assert.equal(page.bar.data.fontPageStyle, page.data.fontPageStyle);
    assert.match(page.data.fontPageStyle, /--font-scale:1.2/);
  }
  assert.equal(setup(storage.get('wecultureTypography')).api.readPreferences().font, 'serif');
});

test('failed persistence leaves other pages unchanged', () => {
  const { api, pages } = setup(undefined, true);
  assert.throws(() => api.savePreferences({ font: 'mono', size: 'large' }));
  assert.deepEqual(pages.map(page => page.data), [{}, {}]);
});

test('draft preview stays local until saved, and page show reapplies saved preferences', async () => {
  const { api, pages } = setup({ font: 'default', size: 'standard' });
  const options = api.withTypography({ data: { businessValue: 'kept' }, async onShow() { this.setData({ shown: true }); return 42; } });
  const page = { ...options, setData: pages[0].setData };
  api.applyTypography(page, { font: 'mono', size: 'large' });
  assert.equal(page.data.typographySummary, '等宽英文 · 大');
  assert.deepEqual(pages[1].data, {});
  assert.equal(await page.onShow(), 42);
  assert.equal(page.data.typographySummary, '默认字体 · 标准');
  assert.equal(page.data.businessValue, 'kept');
  assert.equal(page.data.shown, true);
});

test('bundled Chinese font loads once globally and refreshes an unsaved serif preview', async () => {
  const { api, pages, loadedFonts, storage, packageLoads } = setup(undefined, false, 'pending');
  api.applyTypography(pages[0], { font: 'serif', size: 'large' });
  const pending = api.ensureSerifFont();
  assert.equal(api.ensureSerifFont(), pending);
  assert.equal(packageLoads(), 1);
  assert.equal(pages[0].data.serifStatus, 'loading');
  assert.equal(pages[0].data.typographyFontReady, false);
  assert.equal(pages[0].data.fontPageStyle.includes('WecultureReadingSerif'), false);
  assert.throws(() => api.savePreferences({ font: 'serif', size: 'large' }), /加载/);
  await Promise.resolve();
  assert.equal(loadedFonts[0].global, true);
  assert.deepEqual(Array.from(loadedFonts[0].scopes), ['webview']);
  assert.match(loadedFonts[0].source, /^url\("data:font\/woff2;base64,/);
  loadedFonts[0].success();
  assert.equal(await pending, true);
  assert.equal(pages[0].data.typographyFontReady, true);
  assert.match(pages[0].data.fontPageStyle, /WecultureReadingSerif/);
  assert.equal(pages[0].data.typographyPreferences.size, 'large');
  assert.equal(storage.get('wecultureTypography'), undefined);
  await api.ensureSerifFont();
  assert.equal(packageLoads(), 1);
});

test('a late font completion preserves a newer draft choice', async () => {
  const { api, pages, loadedFonts } = setup(undefined, false, 'pending');
  api.applyTypography(pages[0], { font: 'serif', size: 'standard' });
  const pending = api.ensureSerifFont();
  api.applyTypography(pages[0], { font: 'mono', size: 'larger' });
  await Promise.resolve();
  loadedFonts[0].success();
  await pending;
  assert.equal(pages[0].data.typographyPreferences.font, 'mono');
  assert.equal(pages[0].data.typographyPreferences.size, 'larger');
  assert.equal(pages[0].data.fontPageStyle.includes('WecultureReadingSerif'), false);
});

test('font failure uses the default face, blocks an ineffective save and supports retry', async () => {
  const { api, loadedFonts, wx, storage } = setup(undefined, false, 'error');
  assert.equal(await api.ensureSerifFont(), false);
  assert.equal(api.typographyData({ font: 'serif' }).serifStatus, 'error');
  assert.equal(api.typographyData({ font: 'serif' }).fontPageStyle.includes('WecultureReadingSerif'), false);
  assert.throws(() => api.savePreferences({ font: 'serif' }), /加载失败/);
  assert.equal(storage.get('wecultureTypography'), undefined);
  api.initializeTypography(options => { loadedFonts.push(options); options.success(); });
  assert.equal(await api.ensureSerifFont(true), true);
  api.savePreferences({ font: 'serif' });
  assert.equal(storage.get('wecultureTypography').font, 'serif');
  wx.getAppBaseInfo = () => ({ SDKVersion: '3.7.8' });
  assert.equal(api.supportsBundledFont(), false);
});

test('base libraries before Data URL support keep default reading and cannot save serif', async () => {
  const { api, loadedFonts } = setup(undefined, false, 'success', '3.7.8');
  assert.equal(await api.ensureSerifFont(), false);
  assert.equal(loadedFonts.length, 0);
  assert.equal(api.typographyData({ font: 'serif' }).serifStatus, 'unsupported');
  assert.throws(() => api.savePreferences({ font: 'serif' }), /更新微信/);
  assert.equal(api.savePreferences({ font: 'default', size: 'large' }).font, 'default');
});

test('reading-font asset is a licensed WOFF2 in a subpackage below 2 MB', () => {
  const directory = path.join(__dirname, '../pages/typography');
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(directory, 'serif-resource.js'), 'utf8'), { module });
  const resource = module.exports;
  assert.equal(Buffer.from(resource.base64, 'base64').subarray(0, 4).toString(), 'wOF2');
  assert.equal(resource.family, 'WecultureReadingSerif');
  assert.ok(resource.glyphCount >= 7542);
  assert.match(resource.copyright, /Adobe|Google/);
  assert.match(resource.licenseText, /SIL OPEN FONT LICENSE/);
  assert.match(fs.readFileSync(path.join(directory, 'OFL.txt'), 'utf8'), /SIL OPEN FONT LICENSE/);
  const size = fs.readdirSync(directory).reduce((total, name) => total + fs.statSync(path.join(directory, name)).size, 0);
  assert.ok(size < 2 * 1024 * 1024, `reading-font package is ${size} bytes`);
  const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../app.json'), 'utf8'));
  assert.equal(app.pages.includes('pages/typography/index'), false);
  assert.ok(app.subPackages.some(item => item.root === 'pages/typography' && item.name === 'reading-font'));
});
