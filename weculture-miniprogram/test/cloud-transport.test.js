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
