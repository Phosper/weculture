const { withTypography } = require('../../utils/typography');
const { api } = require('../../services/api');
const { requireLogin } = require('../../utils/guard');
const { formatPost } = require('../../utils/format');
const { getNavMetrics, selectTab } = require('../../utils/nav');
const { detailPath } = require('../../utils/return-path');

const FEEDS = ['latest', 'public', 'campus'];
const TYPES = ['all', 'dynamic', 'event', 'market'];
const SEARCH_MODES = ['content', 'users'];
const userSessionKey = () => {
  const user = getApp().globalData.user;
  return JSON.stringify([user && user.id || '', typeof wx.getStorageSync === 'function' ? wx.getStorageSync('token') || '' : '',
    !!(user && user.verified), user && (user.schoolId || user.school && user.school.id) || '']);
};
const EVENT_TIMES = [
  { key: 'all', label: '全部时间' }, { key: 'upcoming', label: '尚未开始' },
  { key: 'today', label: '今天' }, { key: 'week', label: '近7天' }
];

Page(withTypography({
  data: {
    ...getNavMetrics(), user: null, posts: [], leftPosts: [], rightPosts: [], featured: [], featuredLoading: false,
    q: '', activeSearch: '', searchFocused: false, searchMode: 'content', feed: 'latest', type: 'all', eventTime: 'all', eventTimes: EVENT_TIMES,
    page: 0, total: 0, hasMore: false, error: '', loading: false,
    users: [], userPage: 0, userTotal: 0, userHasMore: false, userError: '', userLoading: false,
    feeds: [{ key: 'latest', label: '最新' }, { key: 'public', label: '公开' }, { key: 'campus', label: '校园' }],
    filters: [{ key: 'all', label: '全部' }, { key: 'dynamic', label: '动态' }, { key: 'event', label: '活动' }, { key: 'market', label: '闲置' }]
  },
  async onShow() {
    const version = this._showVersion = (this._showVersion || 0) + 1;
    this._loginPending = true;
    this._requestVersion = (this._requestVersion || 0) + 1;
    this._userRequestVersion = (this._userRequestVersion || 0) + 1;
    this.clearResults();
    this.clearFeatured();
    selectTab(this, 0);
    const user = await requireLogin(this);
    if (version !== this._showVersion) return;
    this._loginPending = false;
    if (!user) {
      this._requestVersion = (this._requestVersion || 0) + 1;
      this._userRequestVersion = (this._userRequestVersion || 0) + 1;
      this.setData({ user: null, searchMode: 'content', feed: 'latest', type: 'all', eventTime: 'all', q: '', activeSearch: '', searchFocused: false });
      return;
    }
    const changedAccount = this.data.user && this.data.user.id !== user.id;
    this._userSessionStale = false;
    this._userSession = null;
    this.setData({ user, ...(changedAccount ? { searchMode: 'content', feed: 'latest', type: 'all', eventTime: 'all', q: '', activeSearch: '', searchFocused: false } : {}) });
    const loading = this.loadResults();
    this.loadFeatured(user);
    return loading;
  },
  onHide() {
    this._loginPending = false;
    this._showVersion = (this._showVersion || 0) + 1;
    this._requestVersion = (this._requestVersion || 0) + 1;
    this._userRequestVersion = (this._userRequestVersion || 0) + 1;
    this._featuredVersion = (this._featuredVersion || 0) + 1;
    this.setData({ loading: false, userLoading: false, featured: [], featuredLoading: false });
  },
  onUnload() { this.onHide(); },
  clearResults() {
    this.setData({ posts: [], leftPosts: [], rightPosts: [], page: 0, total: 0, hasMore: false, loading: false, error: '',
      users: [], userPage: 0, userTotal: 0, userHasMore: false, userLoading: false, userError: '' });
  },
  clearFeatured() {
    this._featuredVersion = (this._featuredVersion || 0) + 1;
    this.setData({ featured: [], featuredLoading: false });
  },
  async loadFeatured(user = this.data.user) {
    if (!user) { this.setData({ featured: [] }); return; }
    const version = this._featuredVersion = (this._featuredVersion || 0) + 1;
    this.setData({ featuredLoading: true });
    try {
      const result = await api.get('/featured');
      if (version !== this._featuredVersion) return;
      if (!result || !Array.isArray(result.items)) throw new Error('精选暂时无法加载');
      const featured = [];
      const seen = new Set();
      for (const item of result.items) {
        if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) || item.status !== 'approved' || seen.has(item.id)) continue;
        seen.add(item.id);
        featured.push(formatPost(item));
      }
      this.setData({ featured });
    } catch (_) {
      if (version === this._featuredVersion) this.setData({ featured: [] });
    } finally {
      if (version === this._featuredVersion) this.setData({ featuredLoading: false });
    }
  },
  openFeatured(event) {
    const id = event.currentTarget.dataset.id;
    if (!this.data.featured.some(item => item.id === id)) return;
    const url = detailPath(id);
    if (url) wx.navigateTo({ url });
  },
  loadResults(reset = true) { return this.data.searchMode === 'users' ? this.loadUsers(reset) : this.loadPosts(reset); },
  async loadPosts(reset = true) {
    if (this.data.searchMode !== 'content') return;
    if (!reset && (this.data.loading || !this.data.hasMore)) return;
    const version = reset ? (this._requestVersion || 0) + 1 : this._requestVersion;
    this._requestVersion = version;
    const { user, feed, type, activeSearch, eventTime } = this.data;
    const page = reset ? 1 : this.data.page + 1;
    this.setData({ loading: true, error: '', ...(reset ? { posts: [], leftPosts: [], rightPosts: [], page: 0, total: 0, hasMore: false } : {}) });
    try {
      if (!user || (feed === 'campus' && !user.verified)) return;
      const query = [`page=${page}`, 'pageSize=20'];
      if (feed === 'public') query.push('scope=platform');
      if (feed === 'campus') query.push('circle=campus');
      if (type !== 'all') query.push(`type=${type}`);
      if (type === 'event' && eventTime !== 'all') query.push(`eventTime=${eventTime}`);
      if (activeSearch) query.push(`q=${encodeURIComponent(activeSearch)}`);
      const result = await api.get(`/posts?${query.join('&')}`);
      if (version !== this._requestVersion) return;
      if (!result || !Array.isArray(result.items) || result.page !== page || !Number.isInteger(result.total) || result.total < 0 || typeof result.hasMore !== 'boolean') {
        throw new Error('内容暂时无法加载，请稍后重试');
      }
      const posts = reset ? [] : this.data.posts.slice();
      const seen = new Set(posts.map(post => post.id));
      for (const item of result.items) {
        if (!item || !item.id || seen.has(item.id)) continue;
        seen.add(item.id);
        posts.push({ ...formatPost(item), cardTall: posts.length % 3 === 1 });
      }
      this.setData({ posts, page, total: result.total, hasMore: result.hasMore });
      this.layoutPosts();
    } catch (error) {
      if (version === this._requestVersion) this.setData({ error: error.message || '加载失败，请重试' });
    } finally {
      if (version === this._requestVersion) this.setData({ loading: false });
    }
  },
  async loadUsers(reset = true) {
    if (this.data.searchMode !== 'users' || this._userSessionStale || this._loginPending) return;
    if (!reset && (this.data.userLoading || !this.data.userHasMore)) return;
    const version = reset ? (this._userRequestVersion || 0) + 1 : this._userRequestVersion;
    this._userRequestVersion = version;
    const { user, activeSearch } = this.data;
    const keyword = typeof activeSearch === 'string' ? activeSearch.trim() : '';
    if (!user || !keyword || keyword.length > 100) {
      this.setData({ users: [], userPage: 0, userTotal: 0, userHasMore: false, userLoading: false, userError: '' });
      return;
    }
    const session = userSessionKey();
    if (this._userSession && !this.userRequestCurrent(version, this._userSession)) return;
    this._userSession = session;
    const page = reset ? 1 : this.data.userPage + 1;
    this.setData({ userLoading: true, userError: '', ...(reset ? { users: [], userPage: 0, userTotal: 0, userHasMore: false } : {}) });
    try {
      const result = await api.get(`/users?q=${encodeURIComponent(keyword)}&page=${page}&pageSize=20`);
      if (!this.userRequestCurrent(version, session)) return;
      if (!result || !Array.isArray(result.items) || result.items.length > 20 || result.page !== page || result.pageSize !== 20 || !Number.isInteger(result.total) || result.total < 0 || typeof result.hasMore !== 'boolean') {
        throw new Error('用户暂时无法加载，请稍后重试');
      }
      const users = reset ? [] : this.data.users.slice();
      const seen = new Set(users.map(item => item.id));
      for (const item of result.items) {
        if (!item || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(item.id) || seen.has(item.id) ||
          typeof item.nickname !== 'string' || !item.nickname.trim() || !Number.isInteger(item.visiblePostCount) || item.visiblePostCount <= 0) continue;
        seen.add(item.id);
        users.push({ id: item.id, nickname: item.nickname.trim(), visiblePostCount: item.visiblePostCount,
          avatarUrl: typeof item.avatarUrl === 'string' && /^https?:\/\//.test(item.avatarUrl) ? item.avatarUrl : '/assets/default-profile-avatar.jpg' });
      }
      if (((result.hasMore || result.total > 0) && users.length === 0) || (result.hasMore && !reset && users.length === this.data.users.length) || result.total < users.length) {
        throw new Error('用户暂时无法加载，请稍后重试');
      }
      this.setData({ users, userPage: page, userTotal: result.total, userHasMore: result.hasMore });
    } catch (error) {
      if (!this.userRequestCurrent(version, session)) return;
      if (error && [401, 403].includes(error.statusCode)) {
        getApp().globalData.user = null;
        if (error.statusCode === 401 && typeof wx.removeStorageSync === 'function') wx.removeStorageSync('token');
        this.expireUserSearch(error.statusCode === 401 ? '登录已失效，请重新登录后重试' : '访问权限已变化，请重新加载');
        return;
      }
      this.setData({ userError: error && error.message || '用户加载失败，请重试' });
    } finally {
      if (this.userRequestCurrent(version, session)) this.setData({ userLoading: false });
    }
  },
  userRequestCurrent(version, session) {
    if (version !== this._userRequestVersion) return false;
    if (session === userSessionKey()) return true;
    this.expireUserSearch('登录或学校认证状态已变化，请重新加载');
    return false;
  },
  expireUserSearch(message) {
    this._requestVersion = (this._requestVersion || 0) + 1;
    this._userRequestVersion = (this._userRequestVersion || 0) + 1;
    this._userSessionStale = true;
    this.clearResults();
    this.setData({ userError: message });
  },
  layoutPosts() { const { posts } = this.data; this.setData({ leftPosts: posts.filter((_, index) => index % 2 === 0), rightPosts: posts.filter((_, index) => index % 2 === 1) }); },
  searchInput(e) { this.setData({ q: e.detail.value }); },
  search() {
    const activeSearch = this.data.q.trim();
    if (activeSearch.length > 100) { wx.showToast({ title: '搜索词最多100个字符', icon: 'none' }); return; }
    this.setData({ q: activeSearch, activeSearch, searchFocused: false });
    if (this.data.searchMode === 'users' && !activeSearch) wx.showToast({ title: '请输入作者昵称', icon: 'none' });
    return this.loadResults();
  },
  changeSearchMode(e) {
    const searchMode = e.currentTarget.dataset.mode;
    if (!SEARCH_MODES.includes(searchMode) || searchMode === this.data.searchMode) return;
    this._requestVersion = (this._requestVersion || 0) + 1;
    this._userRequestVersion = (this._userRequestVersion || 0) + 1;
    this.clearResults();
    this.setData({ searchMode, q: this.data.activeSearch, searchFocused: false });
    return this.loadResults();
  },
  focusSearch() { this.setData({ searchFocused: true }); },
  clearSearch() { this.setData({ q: '', activeSearch: '', searchFocused: false }); return this.loadResults(); },
  changeFeed(e) {
    if (this.data.searchMode !== 'content') return;
    const feed = e.currentTarget.dataset.feed;
    if (!FEEDS.includes(feed) || feed === this.data.feed) return;
    this.setData({ feed });
    return this.loadPosts();
  },
  changeType(e) {
    if (this.data.searchMode !== 'content') return;
    const type = e.currentTarget.dataset.type;
    if (!TYPES.includes(type) || type === this.data.type) return;
    this.setData({ type, ...(type !== 'event' ? { eventTime: 'all' } : {}) });
    return this.loadPosts();
  },
  changeEventTime(e) {
    if (this.data.searchMode !== 'content') return;
    const eventTime = e.currentTarget.dataset.eventTime;
    if (this.data.type !== 'event' || !EVENT_TIMES.some(item => item.key === eventTime) || eventTime === this.data.eventTime) return;
    this.setData({ eventTime });
    return this.loadPosts();
  },
  viewLatest() {
    this._userRequestVersion = (this._userRequestVersion || 0) + 1;
    this.clearResults();
    this.setData({ searchMode: 'content', feed: 'latest', type: 'all', eventTime: 'all', q: '', activeSearch: '', searchFocused: false });
    return this.loadPosts();
  },
  openAuthor(e) {
    const id = e.currentTarget.dataset.id;
    if (!this.data.users.some(item => item.id === id) || !this.userRequestCurrent(this._userRequestVersion, this._userSession)) return;
    const url = require('../../utils/authors').authorPath(id);
    if (url) wx.navigateTo({ url });
  },
  loadMore() { return this.loadResults(false); },
  retry() { return this._userSessionStale ? this.onShow() : this.loadResults((this.data.searchMode === 'users' ? this.data.userPage : this.data.page) === 0); },
  onReachBottom() { return this.loadMore(); },
  async onPullDownRefresh() { try { await (this._userSessionStale ? this.onShow() : this.loadResults()); } finally { wx.stopPullDownRefresh(); } },
  toAssistant() { wx.navigateTo({ url: '/pages/assistant/index' }); }, toTravel() { wx.switchTab({ url: '/pages/travel/index' }); }, toVerify() { wx.navigateTo({ url: '/pages/verify/index' }); }
}));
