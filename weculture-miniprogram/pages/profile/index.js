const { withTypography } = require('../../utils/typography');
const { api } = require('../../services/api'); const { requireLogin } = require('../../utils/guard'); const { formatPost, formatRoute } = require('../../utils/format'); const { getNavMetrics, selectTab } = require('../../utils/nav');
const { confirmEventCancellation, changeEventRegistration } = require('../../utils/event-registration');
const { readPlanMeta, planSessionKey } = require('../../utils/route-planning');
Page(withTypography({
  data: { ...getNavMetrics(), user: null, avatarText: '我', plans: [], posts: [], favorites: [], joinedCount: 0, routeCount: 0, error: '', loading: false, tab: 'notes', eventBusyId: '', eventErrorId: '', eventError: '', stats: { posts: 0, plans: 0, likes: 0 } },
  async onShow() { this._visible = true; const version = this._viewVersion = (this._viewVersion || 0) + 1; selectTab(this, 4); this.syncSession(); this.setData({ eventBusyId: this._eventOperation && this._eventOperation.session === this._profileSession ? this._eventOperation.eventId : '' }); const user = await requireLogin(this); if (version !== this._viewVersion || !this._visible || !user) return; this.syncSession(); const entry = getApp().globalData.profileEntry; delete getApp().globalData.profileEntry; this.setData({ user, avatarText: user.nickname ? user.nickname.slice(0, 1) : '我', ...(entry ? { tab: 'notes' } : {}) }); return this.load(); },
  syncSession() {
    const session = planSessionKey(getApp(), wx);
    if (this._profileSession !== undefined && this._profileSession !== session) {
      this._eventOperation = null;
      this.loadVersion = (this.loadVersion || 0) + 1;
      this.setData({ user: null, avatarText: '我', plans: [], posts: [], favorites: [], joinedCount: 0, routeCount: 0, eventError: '', eventErrorId: '', eventBusyId: '', error: '', loading: false, stats: { posts: 0, plans: 0, likes: 0 } });
    }
    this._profileSession = session;
  },
  onHide() { this._visible = false; this._viewVersion = (this._viewVersion || 0) + 1; this.loadVersion = (this.loadVersion || 0) + 1; this.setData({ loading: false }); },
  onUnload() { this.onHide(); },
  async onPullDownRefresh() { try { await this.load(); } finally { wx.stopPullDownRefresh(); } },
  async load() {
    if (this._visible === false) return;
    this.syncSession();
    const version = this.loadVersion = (this.loadVersion || 0) + 1;
    const session = this._profileSession;
    const isCurrent = () => version === this.loadVersion && this._visible !== false && session === planSessionKey(getApp(), wx);
    this.setData({ error: '', loading: true, eventError: '', eventErrorId: '' });
    try {
      const [plans, rawPosts] = await Promise.all([api.get('/me/plans'), api.get('/me/posts')]);
      if (!isCurrent()) return;
      const formattedPlans = plans.map((plan) => ({ ...formatRoute(plan), planMeta: plan.type === 'event' ? null : readPlanMeta(plan.planMeta) }));
      const posts = rawPosts.map(formatPost);
      this.setData({ plans: formattedPlans, posts, joinedCount: formattedPlans.filter((plan) => plan.type === 'event').length, routeCount: formattedPlans.filter((plan) => plan.type !== 'event').length, stats: { posts: posts.length, plans: plans.length, likes: posts.reduce((sum, post) => sum + (post.likeCount || 0), 0) } });
      try { const favorites = await api.get('/me/favorites'); if (isCurrent()) this.setData({ favorites: favorites.map((item) => ({ key: `${item.type}-${item.data.id}`, type: item.type, data: item.type === 'post' ? formatPost(item.data) : formatRoute(item.data) })) }); } catch (_) { if (isCurrent()) this.setData({ favorites: [] }); }
    } catch (error) { if (isCurrent()) this.setData({ error: error.message }); }
    finally { if (isCurrent()) this.setData({ loading: false }); }
  },
  retry() { return this.load(); },
  changeTab(e) { this.setData({ tab: e.currentTarget.dataset.tab }); },
  fontSettings() { wx.navigateTo({ url: '/pages/typography/index' }); },
  toAssistant() { wx.navigateTo({ url: '/pages/assistant/index' }); },
  openPost(e) { wx.navigateTo({ url: `/pages/detail/index?id=${e.currentTarget.dataset.id}` }); },
  openSaved(e) { if (e.currentTarget.dataset.type === 'route') wx.switchTab({ url: '/pages/travel/index' }); else this.openPost(e); },
  openPlan(e) {
    if (this._eventOperation) return;
    const { id, type } = e.currentTarget.dataset;
    const plan = this.data.plans.find(item => item.id === id && item.type === type);
    if (!plan) return;
    if (plan.type === 'event' && plan.postId) wx.navigateTo({ url: `/pages/detail/index?id=${plan.postId}` });
  },
  async cancelEvent(e) {
    const eventId = e.currentTarget.dataset.id;
    const plan = this.data.plans.find(item => item.type === 'event' && item.id === eventId);
    if (this._eventOperation || this.data.loading || !plan) return;
    const operation = { eventId, version: this._viewVersion, session: planSessionKey(getApp(), wx) };
    this._eventOperation = operation;
    const isCurrent = () => this._visible !== false && this._viewVersion === operation.version && operation.session === planSessionKey(getApp(), wx);
    this.setData({ eventBusyId: eventId, eventError: '', eventErrorId: '' });
    let requested = false;
    try {
      if (!await confirmEventCancellation(wx, plan.title) || !isCurrent()) return;
      requested = true;
      const result = await changeEventRegistration(api, eventId, false);
      if (!isCurrent()) return;
      // Ignore any older plans read that may still contain the cancelled activity.
      this.loadVersion = (this.loadVersion || 0) + 1;
      const plans = this.data.plans.filter(item => item.type !== 'event' || item.id !== eventId);
      const updatePost = post => post.event && post.event.id === eventId ? formatPost({ ...post, event: { ...post.event, ...result } }) : post;
      this.setData({ plans, loading: false, joinedCount: plans.filter(item => item.type === 'event').length, routeCount: plans.filter(item => item.type !== 'event').length, 'stats.plans': plans.length, posts: this.data.posts.map(updatePost), favorites: this.data.favorites.map(item => item.type === 'post' ? { ...item, data: updatePost(item.data) } : item) });
      wx.showToast({ title: '已取消报名，已移出计划', icon: 'none' });
    } catch (error) {
      if (isCurrent()) this.setData({ eventErrorId: eventId, eventError: error.message || '取消失败，请检查网络后重试' });
    } finally {
      if (this._eventOperation === operation) {
        this._eventOperation = null;
        if (this._visible !== false && operation.session === planSessionKey(getApp(), wx)) {
          this.setData({ eventBusyId: '' });
          if (requested && this._viewVersion !== operation.version) this.load();
        }
      }
    }
  },
  editName() { wx.showModal({ title: '编辑昵称', editable: true, content: this.data.user.nickname || '', placeholderText: '输入昵称', success: async (result) => { if (!result.confirm || !result.content.trim()) return; try { const user = await api.patch('/me', { nickname: result.content.trim() }); getApp().globalData.user = user; this.setData({ user, avatarText: user.nickname.slice(0, 1) }); } catch (error) { wx.showToast({ title: error.message, icon: 'none' }); } } }); },
  verify() { wx.navigateTo({ url: '/pages/verify/index' }); },
  logout() { wx.removeStorageSync('token'); getApp().globalData.user = null; wx.reLaunch({ url: '/pages/login/index?next=%2Fpages%2Fhome%2Findex' }); }
}));
