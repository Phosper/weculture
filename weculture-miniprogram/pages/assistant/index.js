const { withTypography } = require('../../utils/typography');
const { api } = require('../../services/api');
const { requireLogin } = require('../../utils/guard');
const { formatPost } = require('../../utils/format');
const { getNavMetrics } = require('../../utils/nav');
Page(withTypography({
  data: { ...getNavMetrics(), actions: [], events: [], messages: [{ id: 'welcome', role: 'assistant', content: '你好呀！我是校园小C。想找文化活动、了解校园生活，还是规划一段旅行？' }], content: '', scrollTop: 0, sending: false, error: '' },
  async onLoad() {
    const user = await requireLogin(this); if (!user) return;
    try {
      const actions = await api.get('/assistant/quick-actions');
      this.setData({ actions: actions.slice(0, 4) });
      if (user.verified) {
        const posts = await api.get('/posts?scope=school&type=event');
        this.setData({ events: posts.map(formatPost).filter((post) => post.event && post.event.registerable).slice(0, 2) });
      }
    } catch (error) { this.setData({ error: error.message }); }
  },
  back() { wx.navigateBack({ delta: 1 }); },
  openEvent(e) { wx.navigateTo({ url: `/pages/detail/index?id=${e.currentTarget.dataset.id}` }); },
  input(e) { this.setData({ content: e.detail.value }); },
  useAction(e) { this.setData({ content: e.currentTarget.dataset.label }); this.send(); },
  async send() {
    const content = this.data.content.trim(); if (!content || this.data.sending) return;
    const messages = [...this.data.messages, { id: `user-${Date.now()}`, role: 'user', content }];
    this.setData({ messages, content: '', sending: true, error: '', scrollTop: this.data.scrollTop + 10000 });
    try { const result = await api.post('/assistant/messages', { content }); this.setData({ messages: [...messages, { id: result.assistant.id, role: 'assistant', content: result.assistant.content }], scrollTop: this.data.scrollTop + 10000 }); }
    catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ sending: false }); }
  }
}));
