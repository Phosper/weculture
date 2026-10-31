const { api } = require('./services/api');
const { getApiBase, getCloudConfig, getEnvironment, isPhonePreview } = require('./config');
const { initializeTypography } = require('./utils/typography');

App({
  globalData: { user: null, apiBase: getApiBase(), cloudConfig: getCloudConfig() },
  onLaunch() {
    initializeTypography(options => wx.loadFontFace(options));
    if (this.globalData.cloudConfig && wx.cloud) wx.cloud.init({ traceUser: true });
  },
  async ensureLogin() {
    const token = wx.getStorageSync('token');
    if (token) {
      try { const user = await api.get('/me'); this.globalData.user = user; return user; } catch (error) { if (error.statusCode === 401) wx.removeStorageSync('token'); else throw error; }
    }
    return null;
  },
  async login() {
    if (this.globalData.cloudConfig) await api.get('/health', false);
    let code;
    if (getEnvironment() === 'develop' && !isPhonePreview()) {
      code = wx.getStorageSync('developmentLoginId');
      if (!code) { code = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; wx.setStorageSync('developmentLoginId', code); }
    } else {
      code = await new Promise((resolve, reject) => wx.login({ success: (result) => result.code ? resolve(result.code) : reject(new Error('未获取到微信登录凭证')), fail: reject }));
    }
    const result = await api.post('/auth/wechat/login', { code }, false);
    wx.setStorageSync('token', result.token); this.globalData.user = result.user; return result.user;
  }
});
