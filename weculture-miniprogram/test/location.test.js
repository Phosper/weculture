const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const circles = require('../utils/circles');

function harness(automaticCityLocation = true) {
  const calls = [];
  const wx = {
    requirePrivacyAuthorize: options => { calls.push('privacy'); options.success(); },
    getSetting: options => { calls.push('settings'); options.success({ authSetting: {} }); },
    getFuzzyLocation: options => { calls.push(options.type); options.success({ latitude: 39.9, longitude: 116.4, accuracy: 1000 }); }
  };
  const api = { post: async (url, data) => { calls.push({ url, ...data }); return { city: '北京', region: ['北京市', '北京市', ''] }; } };
  const module = { exports: {} };
  const timer = { callback: null, cleared: false };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/location.js'), 'utf8'), {
    module, wx,
    setTimeout: callback => { timer.callback = callback; return 1; },
    clearTimeout: () => { timer.cleared = true; },
    require: id => id === '../services/api' ? { api } : id === './features' ? { FEATURES: { automaticCityLocation } } : circles
  });
  return { ...module.exports, wx, api, calls, timer };
}

test('manual-city release blocks the shared lookup before privacy, permission, position or map requests', async () => {
  const { getCurrentCity, calls } = harness(false);
  await assert.rejects(getCurrentCity(), error => error.code === 'LOCATION_DISABLED');
  assert.deepEqual(calls, []);
});

test('manual-city release switch is fixed off and declares no location permission', () => {
  const { FEATURES } = require('../utils/features');
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../app.json'), 'utf8'));
  assert.equal(FEATURES.automaticCityLocation, false);
  assert.equal(Object.isFrozen(FEATURES), true);
  assert.equal(config.permission, undefined);
  assert.equal(config.requiredPrivateInfos, undefined);
});

test('city lookup waits for privacy, uses fuzzy GCJ-02 location and sends only coordinates', async () => {
  const { getCurrentCity, calls, timer } = harness();
  const result = await getCurrentCity();
  assert.deepEqual(calls, ['privacy', 'settings', 'gcj02', { url: '/location/city', latitude: 39.9, longitude: 116.4 }]);
  assert.equal(result.city, '北京');
  assert.equal(timer.cleared, true);
});

test('refusing privacy prevents location and service calls', async () => {
  const { getCurrentCity, wx, calls } = harness();
  wx.requirePrivacyAuthorize = options => options.fail();
  await assert.rejects(getCurrentCity(), error => error.code === 'LOCATION_PRIVACY');
  assert.deepEqual(calls, []);
});

test('previously refused location permits manual selection without asking repeatedly', async () => {
  const { getCurrentCity, wx, calls } = harness();
  wx.getSetting = options => options.success({ authSetting: { 'scope.userFuzzyLocation': false } });
  await assert.rejects(getCurrentCity(), error => error.code === 'LOCATION_PERMISSION');
  assert.deepEqual(calls, ['privacy']);
});

test('unsupported WeChat version never escalates to precise location', async () => {
  const { getCurrentCity, wx, calls } = harness();
  delete wx.getFuzzyLocation;
  await assert.rejects(getCurrentCity(), /更新微信/);
  assert.deepEqual(calls, []);
});

test('invalid coordinates never reach the city service', async () => {
  const { getCurrentCity, wx, calls } = harness();
  wx.getFuzzyLocation = options => options.success({ latitude: '39.9', longitude: 116.4 });
  await assert.rejects(getCurrentCity(), /有效位置/);
  assert.equal(calls.some(value => typeof value === 'object'), false);
});

test('native permission refusal shows settings but system failure uses manual fallback', async () => {
  const { getCurrentCity, wx } = harness();
  wx.getFuzzyLocation = options => options.fail({ errMsg: 'getFuzzyLocation:fail auth deny' });
  await assert.rejects(getCurrentCity(), error => error.code === 'LOCATION_PERMISSION');
  wx.getFuzzyLocation = options => options.fail({ errMsg: 'getFuzzyLocation:fail system location off' });
  await assert.rejects(getCurrentCity(), error => error.code === 'LOCATION_UNAVAILABLE');
});

test('lookup timeout releases the workflow without submitting a late coordinate', async () => {
  const { getCurrentCity, wx, calls, timer } = harness();
  let nativeOptions;
  wx.getFuzzyLocation = options => { nativeOptions = options; timer.callback(); };
  await assert.rejects(getCurrentCity(), /超时/);
  nativeOptions.success({ latitude: 39.9, longitude: 116.4 });
  assert.equal(calls.some(value => typeof value === 'object'), false);
});

test('bad provider responses and service errors never expose raw errors to the user', async () => {
  const { getCurrentCity, api } = harness();
  api.post = async () => ({ city: '广州', region: ['北京市', '北京市', ''] });
  await assert.rejects(getCurrentCity(), /手动选择/);
  api.post = async () => { throw Object.assign(new Error('sensitive provider URL'), { statusCode: 503 }); };
  await assert.rejects(getCurrentCity(), error => error.code === 'LOCATION_SERVICE' && !error.message.includes('sensitive'));
});

test('cancelling while native location is pending prevents a city lookup', async () => {
  const { getCurrentCity, wx, calls } = harness();
  let nativeOptions, started;
  const ready = new Promise(resolve => { started = resolve; });
  let current = true;
  wx.getFuzzyLocation = options => { nativeOptions = options; started(); };
  const pending = getCurrentCity(() => current);
  await ready;
  current = false;
  nativeOptions.success({ latitude: 39.9, longitude: 116.4 });
  await assert.rejects(pending, error => error.code === 'LOCATION_CANCELLED');
  assert.equal(calls.some(value => typeof value === 'object'), false);
});

test('city service timeout prevents a stuck locating state', async () => {
  const { getCurrentCity, api, timer } = harness();
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  api.post = () => { started(); return new Promise(() => {}); };
  const pending = getCurrentCity();
  await ready;
  timer.callback();
  await assert.rejects(pending, /城市识别超时/);
  assert.equal(timer.cleared, true);
});

test('a directly administered city retains its valid native picker path', async () => {
  const { getCurrentCity, api } = harness();
  api.post = async () => ({ city: '济源', region: ['河南省', '省直辖县级行政区划', '济源市'] });
  const result = await getCurrentCity();
  assert.equal(result.city, '济源');
  assert.deepEqual(result.cityRegion, ['河南省', '省直辖县级行政区划', '济源市']);
});
