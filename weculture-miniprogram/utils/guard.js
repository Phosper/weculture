const { currentReturnPath } = require('./return-path');

async function requireLogin(page) {
  const app = getApp();
  let user;
  try { user = app.globalData.user || await app.ensureLogin(); }
  catch (error) { page.setData({ error: error.message || '云服务暂时无法连接' }); return null; }
  if (user) return user;
  const current = getCurrentPages().slice(-1)[0];
  const next = currentReturnPath(page, current);
  wx.navigateTo({ url: `/pages/login/index?next=${encodeURIComponent(next)}` });
  return null;
}
async function requireVerified(page) { const user = await requireLogin(page); if (!user) return null; if (!user.verified) { wx.navigateTo({ url: '/pages/verify/index' }); return null; } return user; }
module.exports = { requireLogin, requireVerified };
