const { withTypography } = require('../../utils/typography');
const { api } = require('../../services/api');
const { requireLogin } = require('../../utils/guard');
const { formatPost } = require('../../utils/format');
const { topicPath, topicFromQuery } = require('../../utils/topics');

const SCOPES = ['latest', 'public', 'campus'];
const TYPES = ['all', 'dynamic', 'event', 'market'];
const EVENT_TIMES = ['all', 'upcoming', 'today', 'week'];
const clearedFeed = () => ({ posts: [], page: 0, total: 0, hasMore: false });
const sessionKey = () => JSON.stringify([getApp().globalData.user && getApp().globalData.user.id || '', wx.getStorageSync('token') || '']);

Page(withTypography({
  data: {
    tag: '', user: null, scope: 'latest', type: 'all', eventTime: 'all', ...clearedFeed(), loading: false, error: '',
    scopes: [{ key: 'latest', label: '全部可见' }, { key: 'public', label: '公开' }, { key: 'campus', label: '本校' }],
    types: [{ key: 'all', label: '全部' }, { key: 'dynamic', label: '动态' }, { key: 'event', label: '活动' }, { key: 'market', label: '闲置' }],
    eventTimes: [{ key: 'all', label: '全部时间' }, { key: 'upcoming', label: '尚未开始' }, { key: 'today', label: '今天' }, { key: 'week', label: '近7天' }]
  },
  onLoad(options = {}) {
    const tag = topicFromQuery(options.tag);
    this.setData({ tag, error: tag ? '' : '话题链接无效，请从内容标签重新进入' });
  },
  async onShow() {
    this._visible = true;
    const view = this._viewVersion = (this._viewVersion || 0) + 1;
    this._requestVersion = (this._requestVersion || 0) + 1;
    this.setData({ ...clearedFeed(), user: null, loading: false });
    if (!this.data.tag) return;
    const user = await requireLogin(this);
    if (!this._visible || view !== this._viewVersion || !user) return;
    const session = sessionKey();
    if (this._session && this._session !== session) this.setData({ scope: 'latest', type: 'all', eventTime: 'all' });
    this._session = session;
    this.setData({ user });
    return this.loadPosts();
  },
  onHide() {
    this._visible = false;
    this._viewVersion = (this._viewVersion || 0) + 1;
    this._requestVersion = (this._requestVersion || 0) + 1;
    this.setData({ loading: false });
  },
  onUnload() { this.onHide(); },
  async loadPosts(reset = true) {
    if (!this._visible || !this.data.tag || !this.data.user || (!reset && (this.data.loading || !this.data.hasMore))) return;
    const version = reset ? (this._requestVersion || 0) + 1 : this._requestVersion;
    this._requestVersion = version;
    const session = this._session;
    const page = reset ? 1 : this.data.page + 1;
    const { tag, scope, type, eventTime, user } = this.data;
    this.setData({ loading: true, error: '', ...(reset ? clearedFeed() : {}) });
    const isCurrent = () => this._visible && version === this._requestVersion;
    try {
      if (session !== sessionKey()) throw new Error('登录状态已变化，请重新进入话题');
      if (scope === 'campus' && !user.verified) return;
      const query = [`page=${page}`, 'pageSize=20', `tag=${encodeURIComponent(tag)}`];
      if (scope === 'public') query.push('scope=platform');
      if (scope === 'campus') query.push('circle=campus');
      if (type !== 'all') query.push(`type=${type}`);
      if (type === 'event' && eventTime !== 'all') query.push(`eventTime=${eventTime}`);
      const result = await api.get(`/posts?${query.join('&')}`);
      if (!isCurrent()) return;
      if (session !== sessionKey()) {
        this.setData({ ...clearedFeed(), user: null, error: '登录状态已变化，请重新进入话题' });
        return;
      }
      if (!result || !Array.isArray(result.items) || result.page !== page || !Number.isInteger(result.total) || result.total < 0 || typeof result.hasMore !== 'boolean') throw new Error('内容暂时无法加载，请稍后重试');
      const posts = reset ? [] : this.data.posts.slice();
      const seen = new Set(posts.map(post => post.id));
      for (const item of result.items) {
        if (!item || !item.id || seen.has(item.id)) continue;
        seen.add(item.id);
        posts.push(formatPost(item));
      }
      this.setData({ posts, page, total: result.total, hasMore: result.hasMore });
    } catch (error) {
      if (isCurrent()) this.setData({ error: session === sessionKey() ? error.message || '加载失败，请重试' : '登录状态已变化，请重新进入话题', ...(session !== sessionKey() ? { ...clearedFeed(), user: null } : {}) });
    } finally { if (isCurrent()) this.setData({ loading: false }); }
  },
  changeScope(e) {
    const scope = e.currentTarget.dataset.scope;
    if (!SCOPES.includes(scope) || scope === this.data.scope) return;
    this.setData({ scope }); return this.loadPosts();
  },
  changeType(e) {
    const type = e.currentTarget.dataset.type;
    if (!TYPES.includes(type) || type === this.data.type) return;
    this.setData({ type, eventTime: 'all' }); return this.loadPosts();
  },
  changeEventTime(e) {
    const eventTime = e.currentTarget.dataset.time;
    if (this.data.type !== 'event' || !EVENT_TIMES.includes(eventTime) || eventTime === this.data.eventTime) return;
    this.setData({ eventTime }); return this.loadPosts();
  },
  clearFilters() { this.setData({ scope: 'latest', type: 'all', eventTime: 'all' }); return this.loadPosts(); },
  loadMore() { return this.loadPosts(false); },
  retry() { return this.loadPosts(this.data.page === 0); },
  onReachBottom() { return this.loadMore(); },
  async onPullDownRefresh() { try { await this.loadPosts(); } finally { wx.stopPullDownRefresh(); } },
  toVerify() { wx.navigateTo({ url: `/pages/verify/index?returnTo=${encodeURIComponent(topicPath(this.data.tag))}` }); },
  toDiscover() { wx.switchTab({ url: '/pages/home/index' }); }
}));
