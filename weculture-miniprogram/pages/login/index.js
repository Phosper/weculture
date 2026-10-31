const { withTypography } = require('../../utils/typography');
const { getNavMetrics } = require('../../utils/nav');
const { safeReturnPath } = require('../../utils/return-path');

Page(withTypography({
  data: { ...getNavMetrics(), next: '/pages/home/index', loading: false, error: '' },
  onLoad(options) {
    this.setData({ next: safeReturnPath(options.next) });
  },
  async login() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      await getApp().login();
      wx.reLaunch({ url: this.data.next });
    } catch (error) {
      this.setData({ error: error.message || '登录失败，请稍后重试' });
    } finally {
      this.setData({ loading: false });
    }
  }
}));
