const { api } = require('../../services/api'); const { requireLogin } = require('../../utils/guard');
Page({
  data: { user: null, avatarText: '我', posts: [], q: '', error: '', loading: false },
  async onShow() { const user = await requireLogin(this); if (!user) return; this.setData({ user, avatarText: user.nickname ? user.nickname.substring(0, 1) : '我' }); this.loadPosts(); },
  async loadPosts() { this.setData({ loading: true, error: '' }); try { const q = this.data.q ? `&q=${encodeURIComponent(this.data.q)}` : ''; const posts = await api.get(`/posts?scope=platform${q}`); this.setData({ posts }); } catch (error) { this.setData({ error: error.message }); } finally { this.setData({ loading: false }); } },
  searchInput(e) { this.setData({ q: e.detail.value }); }, search() { this.loadPosts(); }, toCommunity() { wx.switchTab({ url: '/pages/community/index' }); }, toAssistant() { wx.navigateTo({ url: '/pages/assistant/index' }); }, toVerify() { wx.navigateTo({ url: '/pages/verify/index' }); }
});
