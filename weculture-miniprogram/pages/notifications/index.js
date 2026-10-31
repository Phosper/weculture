const { withTypography } = require('../../utils/typography');
const { api } = require('../../services/api');
const { requireLogin } = require('../../utils/guard');
const { formatDateTime } = require('../../utils/format');

const PAGE_SIZE = 20;
const TYPE_LABELS = { comment: '评论了你的内容', reply: '回复了你的评论', follow_post: '发布了新内容', event_change: '活动有变更' };

function readNotification(item) {
  if (!item || typeof item.id !== 'string' || !TYPE_LABELS[item.type] || !['post', 'comment', 'event'].includes(item.objectType) ||
      typeof item.objectId !== 'string' || (item.postId != null && typeof item.postId !== 'string') || typeof item.available !== 'boolean' ||
      typeof item.postTitle !== 'string' || (item.actor != null && (typeof item.actor !== 'object' || typeof item.actor.nickname !== 'string'))) {
    throw new Error('通知暂时无法加载，请重试');
  }
  const actor = item.actor || null;
  return { ...item, typeLabel: TYPE_LABELS[item.type], actorNickname: actor ? actor.nickname || 'Weculture 用户' : '系统',
    actorInitial: actor ? (actor.nickname || 'W').slice(0, 1) : '系', timeText: formatDateTime(item.createdAt), read: Boolean(item.readAt) };
}

Page(withTypography({
  data: { notifications: [], page: 0, total: 0, hasMore: false, loading: false, error: '', unreadCount: 0, readBusyId: '', readAllBusy: false },
  async onShow() {
    this._visible = true;
    const version = this._viewVersion = (this._viewVersion || 0) + 1;
    const user = await requireLogin(this);
    if (!this._visible || version !== this._viewVersion) return;
    if (!user) { this.setData({ loading: false }); return; }
    if (this._userId && this._userId !== user.id) this.setData({ notifications: [], page: 0, total: 0, hasMore: false, unreadCount: 0, error: '' });
    this._userId = user.id;
    return this.load(true);
  },
  onHide() { this._visible = false; this._viewVersion = (this._viewVersion || 0) + 1; this._loadVersion = (this._loadVersion || 0) + 1; this._loading = null; this.setData({ loading: false }); },
  onUnload() { this.onHide(); },
  async load(reset = true) {
    if (!this._visible || (!reset && (!this.data.hasMore || this.data.loading))) return;
    if (this._loading) return this._loading;
    const page = reset ? 1 : this.data.page + 1;
    const version = this._loadVersion = (this._loadVersion || 0) + 1;
    this.setData({ loading: true, error: '', ...(reset ? { notifications: [], page: 0, total: 0, hasMore: false } : {}) });
    const operation = (async () => {
      try {
        const result = await api.get(`/me/notifications?page=${page}&pageSize=${PAGE_SIZE}`);
        if (version !== this._loadVersion) return;
        if (!result || !Array.isArray(result.items) || result.page !== page || !Number.isInteger(result.total) || result.total < 0 ||
            typeof result.hasMore !== 'boolean' || !Number.isInteger(result.unreadCount) || result.unreadCount < 0) throw new Error('通知暂时无法加载，请重试');
        const existing = reset ? [] : this.data.notifications.slice();
        const seen = new Set(existing.map(item => item.id));
        for (const raw of result.items) {
          const item = readNotification(raw);
          if (!seen.has(item.id)) { seen.add(item.id); existing.push(item); }
        }
        this.setData({ notifications: existing, page, total: result.total, hasMore: result.hasMore, unreadCount: result.unreadCount });
      } catch (error) {
        if (version === this._loadVersion) this.setData({ error: error.message || '通知加载失败，请重试' });
      } finally {
        if (version === this._loadVersion) this.setData({ loading: false });
        this._loading = null;
      }
    })();
    this._loading = operation;
    return operation;
  },
  loadMore() { return this.load(false); },
  retry() { return this.load(true); },
  async onPullDownRefresh() { try { await this.load(true); } finally { wx.stopPullDownRefresh(); } },
  onReachBottom() { return this.loadMore(); },
  async markRead(item) {
    if (!item || item.readAt || this.data.readBusyId) return false;
    this.setData({ readBusyId: item.id });
    try {
      const result = await api.post(`/me/notifications/${item.id}/read`, {});
      if (!result || result.read !== true) throw new Error('已读状态暂未确认，请重试');
      const notifications = this.data.notifications.map(value => value.id === item.id ? { ...value, readAt: new Date().toISOString(), read: true } : value);
      this.setData({ notifications, unreadCount: Math.max(0, this.data.unreadCount - 1) });
      return true;
    } catch (error) { this.setData({ error: error.message || '标记已读失败，请重试' }); return false; }
    finally { this.setData({ readBusyId: '' }); }
  },
  async openNotification(event) {
    const item = this.data.notifications.find(value => value.id === event.currentTarget.dataset.id);
    if (!item) return;
    if (!item.available) { wx.showToast({ title: '相关内容已不可用', icon: 'none' }); return; }
    if (!item.readAt) await this.markRead(item);
    if (item.postId) wx.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(item.postId)}` });
  },
  async readAll() {
    if (this.data.readAllBusy || !this.data.unreadCount) return;
    this.setData({ readAllBusy: true, error: '' });
    try {
      const result = await api.post('/me/notifications/read-all', {});
      if (!result || !Number.isInteger(result.count) || result.count < 0) throw new Error('已读状态暂未确认，请重试');
      const now = new Date().toISOString();
      this.setData({ notifications: this.data.notifications.map(item => ({ ...item, readAt: item.readAt || now, read: true })), unreadCount: 0 });
      wx.showToast({ title: '已全部标记为已读', icon: 'none' });
    } catch (error) { this.setData({ error: error.message || '操作失败，请重试' }); }
    finally { this.setData({ readAllBusy: false }); }
  }
}));
