const { api } = require('./services/api');

App({
  globalData: { user: null, apiBase: 'http://127.0.0.1:3000/api/v1' },
  async ensureLogin() {
    const token = wx.getStorageSync('token');
    if (token) {
      try { const user = await api.get('/me'); this.globalData.user = user; return user; } catch (_) { wx.removeStorageSync('token'); }
    }
    return null;
  },
  async login() {
    // Keep one local development identity across restarts; production sends wx.login().code.
    let developmentId = wx.getStorageSync('developmentLoginId');
    if (!developmentId) { developmentId = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; wx.setStorageSync('developmentLoginId', developmentId); }
    const result = await api.post('/auth/wechat/login', { code: developmentId }, false);
    wx.setStorageSync('token', result.token); this.globalData.user = result.user; return result.user;
  }
});
