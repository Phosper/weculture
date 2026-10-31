const { withTypography } = require('../../utils/typography');
const { api } = require('../../services/api');
const { requireLogin } = require('../../utils/guard');
const { AUTHOR_PAGE_SIZE, authorPath, readAuthorProfile, readAuthorPosts, mergeAuthorPosts } = require('../../utils/authors');

const emptyFeed = () => ({ posts: [], page: 0, total: 0, hasMore: false });
const sessionKey = () => {
  const user = getApp().globalData.user;
  return JSON.stringify([user && user.id || '', wx.getStorageSync('token') || '', !!(user && user.verified),
    user && (user.schoolId || user.school && user.school.id) || '']);
};

Page(withTypography({
  data: { author: null, user: null, ...emptyFeed(), loading: false, error: '', unavailable: false },
  onLoad(options = {}) {
    this.authorId = authorPath(options.id) ? options.id : '';
    this.hideShareMenu();
    if (!this.authorId) this.setData({ error: '作者链接无效，请从内容中的作者重新进入' });
  },
  async onShow() {
    this._visible = true;
    const view = this._view = (this._view || 0) + 1;
    this.clear();
    this.hideShareMenu();
    if (!this.authorId) { this.setData({ error: '作者链接无效，请从内容中的作者重新进入' }); return; }
    this.setData({ loading: true, error: '' });
    const user = await requireLogin(this);
    if (!this._visible || view !== this._view) return;
    if (!user) { this.setData({ loading: false }); return; }
    const currentUser = getApp().globalData.user;
    if (!currentUser || currentUser.id !== user.id) { this.setData({ loading: false, error: '登录状态已变化，请重新加载' }); return; }
    this._session = sessionKey();
    this.setData({ user: currentUser, loading: false });
    return this.load();
  },
  onHide() {
    this._visible = false;
    this._view = (this._view || 0) + 1;
    this.clear();
    this.hideShareMenu();
  },
  onUnload() { this.onHide(); },
  hideShareMenu() { if (typeof wx.hideShareMenu === 'function') wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] }); },
  clear() {
    this._version = (this._version || 0) + 1;
    this._profileRead = null;
    this._postsRead = null;
    this.setData({ author: null, user: null, ...emptyFeed(), loading: false, error: '', unavailable: false });
  },
  sessionCurrent() {
    if (!this._visible || !this.data.user) return false;
    if (this._session === sessionKey()) return true;
    this.clear();
    this.setData({ error: '登录或学校认证状态已变化，请重新加载' });
    return false;
  },
  current(operation) { return operation.version === this._version && this.sessionCurrent(); },
  load() {
    if (!this.sessionCurrent() || !this.authorId) return;
    if (this._profileRead) return this._profileRead.promise;
    this._version = (this._version || 0) + 1;
    this._postsRead = null;
    const operation = { version: this._version };
    this._profileRead = operation;
    this.setData({ author: null, ...emptyFeed(), loading: true, error: '', unavailable: false });
    operation.promise = (async () => {
      try {
        const value = await api.get(`/users/${this.authorId}`);
        if (!this.current(operation)) return;
        const author = readAuthorProfile(value, this.authorId);
        this.setData({ author });
        await this.loadPosts(true);
      } catch (error) {
        if (this.current(operation)) this.fail(error);
      } finally {
        if (this._profileRead === operation) { this._profileRead = null; if (this.current(operation)) this.setData({ loading: false }); }
      }
    })();
    return operation.promise;
  },
  loadPosts(reset = false) {
    if (!this.sessionCurrent() || !this.data.author || (!reset && !this.data.hasMore)) return;
    if (this._postsRead) return this._postsRead.promise;
    const page = reset ? 1 : this.data.page + 1;
    const operation = { version: this._version };
    this._postsRead = operation;
    this.setData({ loading: true, error: '', ...(reset ? emptyFeed() : {}) });
    operation.promise = (async () => {
      try {
        const value = await api.get(`/users/${this.authorId}/posts?page=${page}&pageSize=${AUTHOR_PAGE_SIZE}`);
        if (!this.current(operation)) return;
        const result = readAuthorPosts(value, this.authorId, page);
        this.setData({ posts: mergeAuthorPosts(reset ? [] : this.data.posts, result.items), page, total: result.total, hasMore: result.hasMore,
          author: { ...this.data.author, visiblePostCount: result.total } });
      } catch (error) { if (this.current(operation)) this.fail(error); }
      finally {
        if (this._postsRead === operation) { this._postsRead = null; if (this.current(operation)) this.setData({ loading: false }); }
      }
    })();
    return operation.promise;
  },
  fail(error) {
    if (error.statusCode === 401) {
      // Only a current read may expire its own session; an older failure cannot erase a newer login.
      if (!this.sessionCurrent()) return;
      getApp().globalData.user = null;
      wx.removeStorageSync('token');
      this.clear();
      this.setData({ error: '登录已过期，请重新加载并登录' });
      return;
    }
    const unavailable = [403, 404].includes(error.statusCode);
    this.setData({ error: unavailable ? '作者主页暂不可访问，请返回发现查看其他内容' : error.message || '加载失败，请检查网络后重试',
      unavailable, ...(unavailable ? { author: null, ...emptyFeed() } : {}) });
  },
  loadMore() { return this.loadPosts(false); },
  retry() {
    if (!this.sessionCurrent()) return this._visible && this.onShow();
    return this.data.author && !this.data.unavailable ? this.loadPosts(this.data.page === 0) : this.load();
  },
  onReachBottom() { if (!this.data.error) return this.loadMore(); },
  async onPullDownRefresh() { try { await (this.sessionCurrent() ? this.load() : this.onShow()); } finally { wx.stopPullDownRefresh(); } },
  toVerify() { const url = authorPath(this.authorId); if (url) wx.navigateTo({ url: `/pages/verify/index?returnTo=${encodeURIComponent(url)}` }); },
  toDiscover() { wx.switchTab({ url: '/pages/home/index' }); }
}));
