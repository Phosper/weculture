const apiBases = {
  develop: 'http://127.0.0.1:3000/api/v1',
  trial: '',
  release: ''
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
  if (!apiBase) throw new Error(`请为小程序 ${environment} 环境配置 API 地址`);
  if (environment !== 'develop' && !apiBase.startsWith('https://')) throw new Error('体验版和正式版 API 必须使用 HTTPS');
  return apiBase;
}

module.exports = { getApiBase, getEnvironment };
