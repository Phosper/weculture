const { api } = require('./services/api');
const { getApiBase, getEnvironment } = require('./config');

App({
  globalData: { user: null, apiBase: getApiBase() },
  async ensureLogin() {
    const token = wx.getStorageSync('token');
    if (token) {
      try { const user = await api.get('/me'); this.globalData.user = user; return user; } catch (_) { wx.removeStorageSync('token'); }
    }
    return null;
  },
  async login() {
    let code;
    if (getEnvironment() === 'develop') {
      code = wx.getStorageSync('developmentLoginId');
      if (!code) { code = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; wx.setStorageSync('developmentLoginId', code); }
    } else {
      code = await new Promise((resolve, reject) => wx.login({ success: (result) => result.code ? resolve(result.code) : reject(new Error('未获取到微信登录凭证')), fail: reject }));
    }
    const result = await api.post('/auth/wechat/login', { code }, false);
    wx.setStorageSync('token', result.token); this.globalData.user = result.user; return result.user;
  }
});
