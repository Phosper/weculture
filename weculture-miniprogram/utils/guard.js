async function requireLogin(page) { const app = getApp(); let user = app.globalData.user || await app.ensureLogin(); if (!user) { try { user = await app.login(); } catch (error) { page.setData({ error: error.message }); return null; } } return user; }
async function requireVerified(page) { const user = await requireLogin(page); if (!user) return null; if (!user.verified) { wx.navigateTo({ url: '/pages/verify/index' }); return null; } return user; }
module.exports = { requireLogin, requireVerified };
