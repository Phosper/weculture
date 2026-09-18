const apiBases = {
  develop: 'http://127.0.0.1:3000/api/v1',
  trial: '',
  release: ''
};

// 手机体验版优先使用微信云托管，避免另外购买服务器和配置 request 合法域名。
// 创建云托管环境后，只需填写对应环境的 env；service 默认使用 weculture-api。
const cloudContainers = {
  trial: { env: 'weculture-test-d4g8lhclj2cb27224', service: 'weculture-api', pathPrefix: '/api/v1' },
  release: { env: '', service: 'weculture-api', pathPrefix: '/api/v1' }
};

function getEnvironment() {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion || 'develop';
  } catch (_) {
    return 'develop';
  }
}

function getApiBase() {
  const environment = getEnvironment();
  const extConfig = typeof wx.getExtConfigSync === 'function' ? wx.getExtConfigSync() : {};
  const apiBase = String(extConfig.apiBase || apiBases[environment] || '').replace(/\/$/, '');
  if (!apiBase && !getCloudConfig()) throw new Error(`请为小程序 ${environment} 环境配置 API 地址或微信云托管环境`);
  if (apiBase && environment !== 'develop' && !apiBase.startsWith('https://')) throw new Error('体验版和正式版 API 必须使用 HTTPS');
  return apiBase;
}

function getCloudConfig() {
  const environment = getEnvironment();
  const extConfig = typeof wx.getExtConfigSync === 'function' ? wx.getExtConfigSync() : {};
  const configured = cloudContainers[environment] || {};
  const env = String(extConfig.cloudEnv || configured.env || '').trim();
  const service = String(extConfig.cloudService || configured.service || '').trim();
  if (!env || !service) return null;
  return {
    env,
    service,
    pathPrefix: String(extConfig.cloudPathPrefix || configured.pathPrefix || '').replace(/\/$/, '')
  };
}

module.exports = { getApiBase, getCloudConfig, getEnvironment };
