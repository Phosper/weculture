const test = require('node:test');
const assert = require('node:assert/strict');

test('体验版可以通过扩展配置选择微信云托管', () => {
  global.wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'trial' } }),
    getExtConfigSync: () => ({ cloudEnv: 'test-env', cloudService: 'weculture-api' })
  };

  const { getApiBase, getCloudConfig } = require('../config');
  assert.equal(getApiBase(), '');
  assert.deepEqual(getCloudConfig(), {
    env: 'test-env',
    service: 'weculture-api',
    pathPrefix: '/api/v1'
  });
});

test('手机扫码预览走微信云托管', () => {
  global.wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getSystemInfoSync: () => ({ platform: 'android' }),
    getExtConfigSync: () => ({})
  };
  const { getApiBase, getCloudConfig, isPhonePreview } = require('../config');
  assert.equal(isPhonePreview(), true);
  assert.equal(getApiBase(), '');
  assert.deepEqual(getCloudConfig(), {
    env: 'weculture-test-d4g8lhclj2cb27224',
    service: 'weculture-api',
    pathPrefix: '/api/v1'
  });
});

test('手机扫码预览使用微信临时登录凭证', async () => {
  let app;
  let submitted;
  global.wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getSystemInfoSync: () => ({ platform: 'android' }),
    getExtConfigSync: () => ({}),
    login: ({ success }) => success({ code: 'wechat-code' }),
    setStorageSync: () => {},
    getStorageSync: () => { throw new Error('手机预览不应读取本地开发登录 ID'); }
  };
  global.App = (options) => { app = options; };
  const { api } = require('../services/api');
  const originalGet = api.get;
  const originalPost = api.post;
  api.get = async (path) => { assert.equal(path, '/health'); return { status: 'healthy' }; };
  api.post = async (path, data) => { submitted = { path, data }; return { token: 'token', user: { id: 'user' } }; };
  try {
    delete require.cache[require.resolve('../app')];
    require('../app');
    await app.login();
    assert.deepEqual(submitted, { path: '/auth/wechat/login', data: { code: 'wechat-code' } });
  } finally {
    api.get = originalGet;
    api.post = originalPost;
    delete global.App;
  }
});

test('开发者工具模拟器仍连接本地服务', () => {
  global.wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getSystemInfoSync: () => ({ platform: 'devtools' }),
    getExtConfigSync: () => ({})
  };
  const { getApiBase, getCloudConfig, isPhonePreview } = require('../config');
  assert.equal(isPhonePreview(), false);
  assert.equal(getApiBase(), 'http://127.0.0.1:3000/api/v1');
  assert.equal(getCloudConfig(), null);
});

test('云托管请求会带上环境、服务、路径和登录令牌', async () => {
  let received;
  global.getApp = () => ({
    globalData: {
      apiBase: '',
      cloudConfig: { env: 'test-env', service: 'weculture-api', pathPrefix: '/api/v1' }
    }
  });
  global.wx = {
    getStorageSync: () => 'test-token',
    cloud: {
      callContainer(options) {
        received = options;
        options.success({ statusCode: 200, data: { code: 'OK', data: { status: 'healthy' } } });
      }
    }
  };

  const { api } = require('../services/api');
  const result = await api.get('/health');
  assert.deepEqual(result, { status: 'healthy' });
  assert.equal(received.config.env, 'test-env');
  assert.equal(received.path, '/api/v1/health');
  assert.equal(received.method, 'GET');
  assert.equal(received.header['X-WX-SERVICE'], 'weculture-api');
  assert.equal(received.header.Authorization, 'Bearer test-token');
});

test('云托管冷启动失败后只重试安全的读取请求', async () => {
  let calls = 0;
  global.getApp = () => ({ globalData: { apiBase: '', cloudConfig: { env: 'test-env', service: 'weculture-api', pathPrefix: '/api/v1' } } });
  global.wx = {
    getStorageSync: () => '',
    cloud: {
      callContainer(options) {
        calls += 1;
        options.success(calls === 1
          ? { statusCode: 500, data: { message: '实例启动中' } }
          : { statusCode: 200, data: { code: 'OK', data: { status: 'healthy' } } });
      }
    }
  };
  const { api } = require('../services/api');
  assert.deepEqual(await api.get('/health', false), { status: 'healthy' });
  assert.equal(calls, 2);

  calls = 0;
  await assert.rejects(api.post('/posts', { title: '测试' }), /实例启动中/);
  assert.equal(calls, 1);
});

test('云托管 102002 会重试读取请求并显示可理解的错误', async () => {
  let calls = 0;
  global.getApp = () => ({ globalData: { apiBase: '', cloudConfig: { env: 'test-env', service: 'weculture-api', pathPrefix: '/api/v1' } } });
  global.wx = {
    getStorageSync: () => '',
    cloud: { callContainer(options) { calls += 1; assert.equal(options.timeout, 15000); options.fail({ errMsg: 'cloud.callContainer:fail system error. code: 102002' }); } }
  };
  const { api } = require('../services/api');
  await assert.rejects(api.get('/health', false), /云服务暂时无法连接（102002）/);
  assert.equal(calls, 4);
});

test('开发版仍然使用本机 HTTP API', async () => {
  let received;
  global.getApp = () => ({ globalData: { apiBase: 'http://127.0.0.1:3000/api/v1', cloudConfig: null } });
  global.wx = {
    getStorageSync: () => '',
    request(options) {
      received = options;
      options.success({ statusCode: 200, data: { code: 'OK', data: [] } });
    }
  };

  const { api } = require('../services/api');
  const result = await api.get('/posts', false);
  assert.deepEqual(result, []);
  assert.equal(received.url, 'http://127.0.0.1:3000/api/v1/posts');
  assert.equal(received.method, 'GET');
});
