const { api } = require('../../services/api'); const { requireVerified } = require('../../utils/guard'); const { formatPost } = require('../../utils/format');
Page({
  data: { posts: [], type: '', loading: false, error: '', user: null, filters: [{ key: '', label: '全部' }, { key: 'dynamic', label: '动态' }, { key: 'event', label: '活动' }, { key: 'market', label: '闲置' }] },
  async onShow() { const user = await requireVerified(this); if (!user) return; this.setData({ user }); this.load(); },
  async load() { this.setData({ loading: true, error: '' }); try { const suffix = this.data.type ? `&type=${this.data.type}` : ''; const posts = await api.get(`/posts?scope=school${suffix}`); this.setData({ posts: posts.map(formatPost) }); } catch (error) { this.setData({ error: error.message }); } finally { this.setData({ loading: false }); } },
  changeType(e) { this.setData({ type: e.currentTarget.dataset.type }); this.load(); }, publish() { wx.switchTab({ url: '/pages/publish/index' }); }
});
