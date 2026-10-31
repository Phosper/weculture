const { withTypography } = require('../../utils/typography');
const { api } = require('../../services/api');
const { requireLogin } = require('../../utils/guard');
const { formatPost } = require('../../utils/format');
const { confirmEventCancellation, changeEventRegistration } = require('../../utils/event-registration');
const { detailPath } = require('../../utils/return-path');
const { contentShare } = require('../../utils/share');
const { topicPath } = require('../../utils/topics');
const { authorProfilePath } = require('../../utils/authors');
const { COMMENT_PAGE_SIZE, commentDraft, prepareCommentRequest, readCommentPage, mergeComments, confirmCommentDeletion } = require('../../utils/comments');
const { REPORT_REASONS, reportDraft, reportPayload, formatReportResult } = require('../../utils/reports');

Page(withTypography({
  data: { post: null, error: '', loading: true, eventBusy: false, eventError: '', canShare: false, canVerify: false,
    comments: [], commentsReady: false, commentsLoading: false, commentsMoreLoading: false, commentsError: '', commentsPage: 0, commentsHasMore: false,
    commentCount: 0, commentContent: '', commentLength: 0, commentReply: null, commentBusy: false, commentError: '', commentDeleteBusyId: '',
    reportReasons: REPORT_REASONS, reportOpen: false, reportTarget: null, reportReason: '', reportDetail: '', reportLength: 0, reportBusy: false, reportError: '' },
  onLoad(options) { this.postId = detailPath(options.id) ? options.id : ''; this.updateShareMenu(false); },
  async onShow() {
    this._visible = true;
    const version = this._viewVersion = (this._viewVersion || 0) + 1;
    this._loadVersion = (this._loadVersion || 0) + 1;
    this._shareUserId = null;
    this.syncCommentUser();
    this.resetComments();
    this.resetReport();
    this.setData({ eventBusy: !!this._eventOperation, post: null, canVerify: false, loading: true, error: '', eventError: '' });
    this.updateShareMenu(false);
    const user = await requireLogin(this);
    if (version !== this._viewVersion || !this._visible) return;
    if (user) { this.syncCommentUser(); this._shareUserId = user.id; this._unverified = !user.verified; return this.load(); }
    this.setData({ loading: false });
  },
  onHide() { this._visible = false; this._viewVersion = (this._viewVersion || 0) + 1; this._loadVersion = (this._loadVersion || 0) + 1; this.resetComments(); this.resetReport(); this.updateShareMenu(false); },
  onUnload() { this.onHide(); this.resetComments(true); },
  async load() {
    const version = this._loadVersion = (this._loadVersion || 0) + 1;
    this._commentDetailVersion = (this._commentDetailVersion || 0) + 1;
    const userId = getApp().globalData.user && getApp().globalData.user.id;
    this.syncCommentUser();
    this.resetComments();
    this.updateShareMenu(false);
    this.setData({ loading: true, error: '', post: null, eventError: '', canVerify: false });
    if (!detailPath(this.postId)) { this.setData({ error: '内容链接无效，请返回首页查看', loading: false }); return; }
    try {
      const post = await api.get(`/posts/${this.postId}`);
      if (version === this._loadVersion) {
        if (!getApp().globalData.user || getApp().globalData.user.id !== userId) {
          this.setData({ error: '登录状态已变化，请重新加载' });
          return;
        }
        this.setData({ post: formatPost(post) });
        this.updateShareMenu(this.shareAllowed(post));
        if (post.status === 'approved') this.loadComments();
        else this.resetComments(true);
      }
    }
    catch (error) { if (version === this._loadVersion) { this.resetComments([401, 403, 404].includes(error.statusCode)); this.setData({ error: error.message, canVerify: error.statusCode === 403 && this._unverified }); } }
    finally { if (version === this._loadVersion) this.setData({ loading: false }); }
  },
  retry() { if (!this._eventOperation) return this.load(); },
  async onPullDownRefresh() { try { if (!this._eventOperation) await this.load(); } finally { if (typeof wx.stopPullDownRefresh === 'function') wx.stopPullDownRefresh(); } },
  onReachBottom() { if (this.data.commentsHasMore && !this.data.commentsError) return this.loadComments(false); },
  syncCommentUser() {
    const user = getApp().globalData.user;
    const userId = user && user.id || null;
    if (this._commentUserId !== userId) {
      this._commentUserId = userId;
      this._commentOperation = null;
      this._commentDeleteOperation = null;
      this.resetComments(true);
      this.resetReport();
    }
  },
  resetComments(discardDraft = false) {
    this._commentsVersion = (this._commentsVersion || 0) + 1;
    this._commentsRead = null;
    const values = { comments: [], commentsReady: false, commentsLoading: false, commentsMoreLoading: false, commentsError: '', commentsPage: 0,
      commentsHasMore: false, commentCount: 0, commentBusy: !!this._commentOperation, commentDeleteBusyId: this._commentDeleteOperation && this._commentDeleteOperation.id || '' };
    if (discardDraft) { this._commentRequest = null; Object.assign(values, { commentContent: '', commentLength: 0, commentReply: null, commentError: '' }); }
    this.setData(values);
  },
  commentContext() {
    const user = getApp().globalData.user;
    if (!user || user.id !== this._commentUserId) { this.syncCommentUser(); this.setData({ post: null }); this.updateShareMenu(false); return null; }
    const post = this.data.post;
    return this._visible !== false && post && post.status === 'approved'
      ? { userId: user.id, postId: post.id, view: this._viewVersion, load: this._commentDetailVersion } : null;
  },
  commentContextCurrent(context) {
    const current = this.commentContext();
    return !!(current && context && current.userId === context.userId && current.postId === context.postId && current.view === context.view && current.load === context.load);
  },
  async commentAccessFailure(error, context, mutation = false) {
    if (!this.commentContextCurrent(context) || ![401, 403, 404].includes(error.statusCode)) return false;
    if (mutation && error.statusCode === 404) {
      // A missing reply target and an unavailable post share this status. Recheck the post before discarding its draft.
      const recheck = this.load();
      const expected = { ...context, load: this._commentDetailVersion };
      await recheck;
      if (this.commentContextCurrent(expected)) this.setData({ commentError: error.message || '回复目标已不可用，请取消回复后重试' });
      return true;
    }
    this._loadVersion = (this._loadVersion || 0) + 1;
    this._commentDetailVersion = (this._commentDetailVersion || 0) + 1;
    this.resetComments(true);
    this.updateShareMenu(false);
    this.setData({ post: null, error: error.message || '内容暂不可访问，请重新加载', loading: false, canVerify: error.statusCode === 403 && this._unverified });
    return true;
  },
  async loadComments(reset = true) {
    const context = this.commentContext();
    if (!context) return;
    if (this._commentsRead) return this._commentsRead.promise;
    if (!reset && !this.data.commentsHasMore) return;
    const page = reset ? 1 : this.data.commentsPage + 1;
    const operation = { version: this._commentsVersion, context };
    this._commentsRead = operation;
    this.setData({ commentsLoading: !!reset, commentsMoreLoading: !reset, commentsError: '', ...(reset ? { comments: [], commentsReady: false, commentsPage: 0, commentsHasMore: false } : {}) });
    const current = () => this._commentsRead === operation && operation.version === this._commentsVersion && this.commentContextCurrent(context);
    operation.promise = (async () => {
      try {
        const response = await api.get(`/posts/${context.postId}/comments?page=${page}&pageSize=${COMMENT_PAGE_SIZE}`);
        if (!current()) return;
        const result = readCommentPage(response, context.postId, page);
        const comments = mergeComments(reset ? [] : this.data.comments, result.items);
        const reply = this.data.commentReply;
        const deletedReply = reply && result.items.some(item => item.id === reply.id && item.deleted);
        const awaitingReply = deletedReply && this._commentRequest && this._commentRequest.parentId === reply.id && this._commentRequest.content === this.data.commentContent.trim();
        this.setData({ comments, commentsReady: true, commentsPage: page, commentsHasMore: result.hasMore, commentCount: result.activeCount,
          ...(deletedReply ? awaitingReply
            ? { commentError: '原评论已删除，请再次发送核对上次结果，或取消回复后另发评论' }
            : { commentReply: null, commentError: '回复的评论已删除，可以直接发表你的评论' } : {}) });
      } catch (error) {
        if (current() && !await this.commentAccessFailure(error, context)) this.setData({ commentsError: error.message || '评论加载失败，请检查网络后重试' });
      } finally {
        if (this._commentsRead === operation) { this._commentsRead = null; this.setData({ commentsLoading: false, commentsMoreLoading: false }); }
      }
    })();
    return operation.promise;
  },
  refreshComments() { return this.loadComments(true); },
  loadMoreComments() { return this.loadComments(false); },
  retryComments() { return this.loadComments(this.data.commentsPage === 0); },
  commentInput(event) {
    if (!this.commentContext() || this._commentOperation) return;
    const content = event.detail && typeof event.detail.value === 'string' ? event.detail.value : '';
    this.setData({ commentContent: content, commentLength: content.length, commentError: '' });
  },
  replyComment(event) {
    if (!this.commentContext() || this._commentOperation) return;
    const item = this.data.comments.find(value => value.id === event.currentTarget.dataset.id);
    if (item && item.canReply && !item.deleted) this.setData({ commentReply: { id: item.id, nickname: item.author.nickname }, commentError: '' }, () => {
      if (typeof wx.pageScrollTo === 'function') wx.pageScrollTo({ selector: '#comment-composer', duration: 200 });
    });
  },
  cancelReply() { if (!this.commentContext() || this._commentOperation) return; this.setData({ commentReply: null, commentError: '' }); },
  resetReport() {
    this._reportOperation = null;
    this.setData({ reportOpen: false, reportTarget: null, reportReason: '', reportDetail: '', reportLength: 0, reportBusy: false, reportError: '' });
  },
  openPostReport() {
    const post = this.data.post;
    if (!post || !post.canReport) return;
    this.openReport({ type: 'post', id: post.id, label: post.title || '这条内容' });
  },
  openCommentReport(event) {
    const item = this.data.comments.find(value => value.id === event.currentTarget.dataset.id);
    if (!item || !item.canReport) return;
    this.openReport({ type: 'comment', id: item.id, label: `评论：${item.author.nickname}` });
  },
  openReport(target) {
    if (!this.commentContext() || this._reportOperation) return;
    this.setData({ reportOpen: true, reportTarget: target, reportReason: '', reportDetail: '', reportLength: 0, reportError: '' });
  },
  closeReport() {
    if (this._reportOperation) return;
    this.setData({ reportOpen: false, reportTarget: null, reportReason: '', reportDetail: '', reportLength: 0, reportError: '' });
  },
  noop() {},
  chooseReportReason(event) {
    if (this._reportOperation) return;
    const code = event.currentTarget.dataset.code;
    if (REPORT_REASONS.some(item => item.code === code)) this.setData({ reportReason: code, reportError: '' });
  },
  reportDetailInput(event) {
    if (this._reportOperation) return;
    const value = event.detail && typeof event.detail.value === 'string' ? event.detail.value : '';
    this.setData({ reportDetail: value, reportLength: value.length, reportError: '' });
  },
  async submitReport() {
    const context = this.commentContext();
    const target = this.data.reportTarget;
    if (!context || !target || this._reportOperation) return;
    let payload;
    try { payload = reportPayload(target.type, target.id, reportDraft(this.data.reportReason, this.data.reportDetail)); }
    catch (error) { this.setData({ reportError: error.message }); return; }
    const operation = { context, targetType: target.type, targetId: target.id };
    this._reportOperation = operation;
    this.setData({ reportBusy: true, reportError: '' });
    try {
      const result = formatReportResult(await api.post('/reports', payload));
      if (!this.commentContextCurrent(context) || this._reportOperation !== operation) return;
      this.setData({ reportOpen: false, reportTarget: null, reportReason: '', reportDetail: '', reportLength: 0 });
      wx.showToast({ title: result.duplicate ? '已提交过，正在处理' : '举报已提交', icon: 'none' });
    } catch (error) {
      if (this._reportOperation === operation) this.setData({ reportError: error.message || '举报提交失败，请检查网络后重试' });
    } finally {
      if (this._reportOperation === operation) {
        this._reportOperation = null;
        this.setData({ reportBusy: false });
      }
    }
  },
  async submitComment() {
    const context = this.commentContext();
    if (!context || this._commentOperation) return;
    let request;
    try { request = prepareCommentRequest(this._commentRequest, commentDraft(this.data.commentContent, this.data.commentReply && this.data.commentReply.id)); }
    catch (error) { this.setData({ commentError: error.message }); return; }
    this._commentRequest = request;
    const operation = { context };
    this._commentOperation = operation;
    this.setData({ commentBusy: true, commentError: '' });
    try {
      const result = await api.post(`/posts/${context.postId}/comments`, { content: request.content, clientRequestId: request.clientRequestId, ...(request.parentId ? { parentId: request.parentId } : {}) });
      if (!this.commentContextCurrent(context)) return;
      if (!result || !result.id || result.postId !== context.postId || (!result.deleted && result.content !== request.content) || (result.parent && result.parent.id || null) !== request.parentId) throw new Error('暂未确认发送结果，请重试；相同内容不会重复发送');
      this._commentRequest = null;
      this.setData({ commentContent: '', commentLength: 0, commentReply: null, commentError: '' });
      wx.showToast({ title: result.deleted ? '这条评论已删除' : '评论已发送', icon: 'none' });
      // Discard an older list read so it cannot restore the pre-mutation count.
      this.resetComments();
      await this.loadComments(true);
    } catch (error) {
      if (this.commentContextCurrent(context) && !await this.commentAccessFailure(error, context, true)) this.setData({ commentError: error.message || '发送失败，请检查网络后重试' });
    } finally {
      if (this._commentOperation === operation) { this._commentOperation = null; this.setData({ commentBusy: false }); }
    }
  },
  async deleteComment(event) {
    const context = this.commentContext();
    if (!context || this._commentDeleteOperation || this._commentOperation) return;
    const item = this.data.comments.find(value => value.id === event.currentTarget.dataset.id);
    if (!item || !item.canDelete || item.deleted) return;
    const operation = { context, id: item.id };
    this._commentDeleteOperation = operation;
    this.setData({ commentDeleteBusyId: item.id, commentError: '' });
    try {
      if (!await confirmCommentDeletion(wx) || !this.commentContextCurrent(context)) return;
      const result = await api.delete(`/posts/${context.postId}/comments/${item.id}`);
      if (!this.commentContextCurrent(context)) return;
      if (!result || result.deleted !== true || result.id !== item.id) throw new Error('暂未确认删除结果，请刷新评论后重试');
      if (this.data.commentReply && this.data.commentReply.id === item.id) this.setData({ commentReply: null });
      wx.showToast({ title: '评论已删除', icon: 'none' });
      this.resetComments();
      await this.loadComments(true);
    } catch (error) {
      if (this.commentContextCurrent(context) && !await this.commentAccessFailure(error, context, true)) this.setData({ commentError: error.message || '删除失败，请检查网络后重试' });
    } finally {
      if (this._commentDeleteOperation === operation) { this._commentDeleteOperation = null; this.setData({ commentDeleteBusyId: '' }); }
    }
  },
  shareAllowed(post = this.data.post) {
    const user = getApp().globalData.user;
    return !!(this._visible && user && this._shareUserId === user.id && post && post.status === 'approved' && detailPath(post.id));
  },
  updateShareMenu(allowed) {
    this.setData({ canShare: !!allowed });
    if (allowed && typeof wx.showShareMenu === 'function') wx.showShareMenu({ menus: ['shareAppMessage'] });
    else if (typeof wx.hideShareMenu === 'function') wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
  },
  onShareAppMessage() { return contentShare(this.shareAllowed() ? this.data.post : null); },
  openTopic() {
    const post = this.data.post;
    const url = post && post.status === 'approved' && topicPath(post.tag);
    if (url) wx.navigateTo({ url });
  },
  openAuthor() {
    const url = authorProfilePath(this.data.post && this.data.post.author);
    if (url) wx.navigateTo({ url });
  },
  openCommentAuthor(event) {
    const item = this.data.comments.find(comment => comment.id === event.currentTarget.dataset.id);
    const url = item && !item.deleted && authorProfilePath(item.author);
    if (url) wx.navigateTo({ url });
  },
  toVerify() { wx.navigateTo({ url: `/pages/verify/index?returnTo=${encodeURIComponent(detailPath(this.postId))}` }); },
  previewImage() {
    const url = this.data.post && this.data.post.imageUrl;
    if (url) wx.previewImage({ current: url, urls: [url] });
  },
  previewGallery(event) {
    const post = this.data.post;
    const index = Number(event.currentTarget.dataset.index);
    if (!post || !Array.isArray(post.imageUrls) || !post.imageUrls[index]) return;
    wx.previewImage({ current: post.imageUrls[index], urls: post.imageUrls });
  },
  async like() {
    if (!this.data.post || this.data.post.status !== 'approved') return;
    try { const result = await api.post(`/posts/${this.data.post.id}/likes`, {}); this.setData({ 'post.liked': result.liked, 'post.likeCount': result.likeCount }); }
    catch (error) { wx.showToast({ title: error.message, icon: 'none' }); }
  },
  async favorite() {
    if (!this.data.post || this.data.post.status !== 'approved') return;
    try { const result = await api.post(`/posts/${this.data.post.id}/favorite`, {}); this.setData({ 'post.favorited': result.favorited }); }
    catch (error) { wx.showToast({ title: error.message, icon: 'none' }); }
  },
  async register() {
    return this.changeRegistration(true);
  },
  async cancelRegistration() {
    return this.changeRegistration(false);
  },
  async changeRegistration(registered) {
    const post = this.data.post;
    if (this._eventOperation || this.data.loading || !post || !post.event || !(registered ? post.event.registerable : post.event.cancelable)) return;
    const operation = { version: this._viewVersion, eventId: post.event.id };
    this._eventOperation = operation;
    const isCurrent = () => this._visible !== false && this._viewVersion === operation.version && this.data.post && this.data.post.event && this.data.post.event.id === operation.eventId;
    this.setData({ eventBusy: true, eventError: '' });
    let requested = false;
    try {
      if (!registered && !await confirmEventCancellation(wx, post.title)) return;
      if (!isCurrent()) return;
      requested = true;
      const result = await changeEventRegistration(api, operation.eventId, registered);
      if (!isCurrent()) return;
      this._loadVersion = (this._loadVersion || 0) + 1;
      this.setData({ post: formatPost({ ...this.data.post, event: { ...this.data.post.event, ...result } }) });
      wx.showToast({ title: registered ? '报名成功，已加入计划' : '已取消报名', icon: 'none' });
    } catch (error) {
      if (isCurrent()) this.setData({ eventError: error.message || '操作失败，请检查网络后重试' });
    } finally {
      if (this._eventOperation === operation) {
        this._eventOperation = null;
        if (this._visible !== false) {
          this.setData({ eventBusy: false });
          // A request may finish after this page has been shown again; reload the current server state.
          if (requested && this._viewVersion !== operation.version) this.load();
        }
      }
    }
  }
}));
