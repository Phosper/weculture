const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { commentDraft, prepareCommentRequest, readCommentPage } = require('../utils/comments');

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const content = changes => ({ id: 'post', title: '文化故事', status: 'approved', circle: 'city', author: { id: 'author', nickname: '作者' }, ...changes });
const comment = (id = 'comment', changes = {}) => ({ id, postId: 'post', content: '很有启发', createdAt: '2026-10-20T02:00:00.000Z', deleted: false,
  author: { id: 'reader', nickname: '同学', avatarUrl: '' }, isPostAuthor: false, canDelete: true, canReply: true, parent: null, ...changes });
const listing = (items = [], changes = {}) => ({ items, page: 1, pageSize: 20, total: items.length, activeCount: items.filter(item => !item.deleted).length, hasMore: false, ...changes });
const tap = id => ({ currentTarget: { dataset: { id } } });
const input = value => ({ detail: { value } });
const statusError = statusCode => Object.assign(new Error(`访问失败${statusCode}`), { statusCode });

function harness(api = {}) {
  let definition;
  const app = { globalData: { user: { id: 'reader', nickname: '同学', verified: true } } };
  const wx = { modals: [], toasts: [], menus: [], stopped: 0,
    showToast: options => wx.toasts.push(options.title), showModal: options => wx.modals.push(options),
    showShareMenu: () => wx.menus.push(true), hideShareMenu: () => wx.menus.push(false), stopPullDownRefresh: () => { wx.stopped += 1; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/detail/index.js'), 'utf8'), {
    Page: value => { definition = value; }, wx, getApp: () => app,
    require: id => {
      if (id.endsWith('/typography')) return { withTypography: value => value };
      if (id.endsWith('/guard')) return { requireLogin: async () => app.globalData.user };
      if (id.endsWith('/api')) return { api };
      return require(path.resolve(__dirname, '../pages/detail', id));
    }
  });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) {
    for (const [key, value] of Object.entries(values)) {
      const keys = key.split('.'); let target = this.data;
      while (keys.length > 1) target = target[keys.shift()];
      target[keys[0]] = value;
    }
  } };
  page.onLoad({ id: 'post' });
  return { page, app, wx };
}
async function open(api = {}) {
  const result = harness({ get: async url => url.includes('/comments?') ? listing([comment()]) : content(), ...api });
  await result.page.onShow();
  if (result.page._commentsRead) await result.page._commentsRead.promise;
  return result;
}

test('draft validation trims content and rejects blank or overlong comments', () => {
  assert.deepEqual(commentDraft('  同好\n  ', 'parent'), { content: '同好', parentId: 'parent' });
  assert.equal(commentDraft('文'.repeat(500)).content.length, 500);
  assert.throws(() => commentDraft(' \n\t'), /写点内容/);
  assert.throws(() => commentDraft('文'.repeat(501)), /500/);
  const request = prepareCommentRequest(null, commentDraft('  同好  '));
  assert.equal(prepareCommentRequest(request, commentDraft('同好')), request);
  assert.notEqual(prepareCommentRequest(request, commentDraft('别的话')).clientRequestId, request.clientRequestId);
  assert.notEqual(prepareCommentRequest(request, commentDraft('同好', 'parent')).clientRequestId, request.clientRequestId);
  assert.ok(request.clientRequestId.length <= 80);
});

test('comment formatting hides deleted content and rejects a response for another post', () => {
  const result = readCommentPage(listing([comment('gone', { deleted: true, content: '不应显示', canReply: true, canDelete: true })]), 'post', 1);
  assert.equal(result.items[0].content, '');
  assert.equal(result.items[0].canReply, false);
  assert.equal(result.items[0].canDelete, false);
  assert.throws(() => readCommentPage(listing([comment('other', { postId: 'other-post' })]), 'post', 1), /重试/);
  assert.throws(() => readCommentPage(listing([], { activeCount: -1 }), 'post', 1), /重试/);
});

test('author previews never read comments and ordinary comment failure keeps detail and sharing usable', async () => {
  for (const status of ['pending', 'rejected', 'offline']) {
    const calls = [];
    const { page } = await open({ get: async url => { calls.push(url); return content({ status }); } });
    assert.deepEqual(calls, ['/posts/post']);
    page.commentInput(input('预览不发评论')); await page.submitComment();
    assert.equal(page.data.commentContent, '');
    assert.equal(page.data.commentsReady, false);
  }
  const { page } = await open({ get: async url => { if (url.includes('/comments?')) throw new Error('评论网络异常'); return content(); } });
  assert.equal(page.data.post.id, 'post'); assert.equal(page.data.canShare, true);
  assert.equal(page.data.error, ''); assert.equal(page.data.commentsError, '评论网络异常');
});

test('pagination preserves prior items on failure and retries the same page without duplicates', async () => {
  const calls = []; let failing = true;
  const { page } = await open({ get: async url => {
    if (!url.includes('/comments?')) return content();
    calls.push(url);
    if (url.includes('page=1&')) return listing([comment('first')], { hasMore: true, total: 3, activeCount: 3 });
    if (failing) throw new Error('第二页断网');
    return listing([comment('first'), comment('next')], { page: 2, total: 3, activeCount: 3 });
  } });
  await page.loadMoreComments();
  assert.equal(page.data.comments[0].id, 'first'); assert.equal(page.data.commentsPage, 1);
  assert.equal(page.data.commentsError, '第二页断网');
  failing = false; await page.retryComments();
  assert.deepEqual(Array.from(page.data.comments, item => item.id), ['first', 'next']);
  assert.equal(page.data.commentsPage, 2); assert.equal(page.data.commentsHasMore, false);
  assert.equal(calls.filter(url => url.includes('page=2&')).length, 2);
});

test('a lost send response preserves its draft and retry reuses the request id and parent', async () => {
  const requests = []; let fail = true;
  const { page } = await open({ post: async (url, body) => {
    requests.push({ url, ...body });
    if (fail) throw new Error('响应丢失');
    return comment('reply', { content: body.content, parent: { id: body.parentId, nickname: '同学', deleted: false } });
  } });
  page.replyComment(tap('comment')); page.commentInput(input('  谢谢分享  '));
  assert.equal(page.data.commentLength, 8);
  await page.submitComment();
  assert.equal(page.data.commentContent, '  谢谢分享  '); assert.equal(page.data.commentReply.id, 'comment');
  assert.equal(page.data.commentError, '响应丢失'); assert.equal(page.data.commentBusy, false);
  fail = false; await page.submitComment();
  assert.equal(requests[0].content, '谢谢分享'); assert.equal(requests[0].parentId, 'comment');
  assert.equal(requests[1].clientRequestId, requests[0].clientRequestId);
  assert.equal(page.data.commentContent, ''); assert.equal(page.data.commentReply, null);
});

test('changed text or reply target uses a new key while a busy send ignores edits and duplicate taps', async () => {
  const requests = []; const pending = deferred();
  const { page } = await open({ post: (url, body) => { requests.push(body); return requests.length === 1 ? Promise.reject(new Error('断网')) : pending.promise; } });
  page.commentInput(input('第一句话')); await page.submitComment();
  page.replyComment(tap('comment')); page.commentInput(input('换句话'));
  const sending = page.submitComment();
  page.commentInput(input('发送中编辑')); page.cancelReply(); await page.submitComment();
  assert.equal(requests.length, 2); assert.notEqual(requests[0].clientRequestId, requests[1].clientRequestId);
  assert.equal(page.data.commentContent, '换句话'); assert.equal(page.data.commentReply.id, 'comment');
  pending.resolve(comment('reply', { content: '换句话', parent: { id: 'comment', nickname: '同学', deleted: false } })); await sending;
  assert.equal(page.data.commentBusy, false); assert.equal(page.data.commentContent, '');
});

test('success followed by list refresh failure clears the draft and reports only a list error', async () => {
  let sent = false;
  const { page, wx } = await open({
    get: async url => { if (!url.includes('/comments?')) return content(); if (sent) throw new Error('列表断网'); return listing(); },
    post: async (url, body) => { sent = true; return comment('new', { content: body.content }); }
  });
  page.commentInput(input('已成功写入')); await page.submitComment();
  assert.equal(page.data.commentContent, ''); assert.equal(page.data.commentError, ''); assert.equal(page.data.commentsError, '列表断网');
  assert.deepEqual(wx.toasts, ['评论已发送']);
});

test('an idempotent replay of a deleted comment is confirmed and does not trap the draft', async () => {
  const { page, wx } = await open({ post: async () => comment('gone', { deleted: true, content: '' }) });
  page.commentInput(input('之前已经发过')); await page.submitComment();
  assert.equal(page.data.commentContent, ''); assert.equal(page.data.commentError, ''); assert.deepEqual(wx.toasts, ['这条评论已删除']);
});

test('a confirmed existing reply remains successful when its parent was deleted before the response arrived', async () => {
  const { page } = await open({ post: async (url, body) => comment('reply', { content: body.content, parent: { id: body.parentId, nickname: '同学', deleted: true } }) });
  page.replyComment(tap('comment')); page.commentInput(input('已经写入的回复')); await page.submitComment();
  assert.equal(page.data.commentContent, ''); assert.equal(page.data.commentError, ''); assert.equal(page.data.commentReply, null);
});

test('an older refresh cannot restore the comment list or count from before a successful send', async () => {
  const oldRead = deferred(); let reads = 0;
  const { page } = await open({ get: async url => {
    if (!url.includes('/comments?')) return content();
    reads += 1;
    if (reads === 2) return oldRead.promise;
    return listing(reads === 1 ? [] : [comment('new')]);
  }, post: async (url, body) => comment('new', { content: body.content }) });
  const stale = page.refreshComments(); page.commentInput(input('新的评论')); await page.submitComment();
  oldRead.resolve(listing()); await stale;
  assert.equal(page.data.commentCount, 1); assert.equal(page.data.comments[0].id, 'new');
});

test('deleted comments cannot be selected for replies and refresh cancels a deleted target without losing text', async () => {
  let deleted = false;
  const { page } = await open({ get: async url => url.includes('/comments?') ? listing([comment('comment', { deleted, content: deleted ? '' : '正文' })]) : content() });
  page.replyComment(tap('comment')); page.commentInput(input('写到一半'));
  deleted = true; await page.refreshComments();
  assert.equal(page.data.commentReply, null); assert.equal(page.data.commentContent, '写到一半');
  page.replyComment(tap('comment')); assert.equal(page.data.commentReply, null);
});

test('a deleted reply target does not change the key or turn an unconfirmed saved reply into a new top-level comment', async () => {
  const requests = []; let deleted = false;
  const { page } = await open({
    get: async url => url.includes('/comments?') ? listing([comment('comment', { deleted, content: deleted ? '' : '原评论' })]) : content(),
    post: async (url, body) => {
      requests.push(body);
      if (requests.length === 1) throw new Error('写入后的响应丢失');
      return comment('saved-reply', { content: body.content, parent: { id: body.parentId, nickname: '同学', deleted: true } });
    }
  });
  page.replyComment(tap('comment')); page.commentInput(input('已经保存的回复')); await page.submitComment();
  deleted = true; await page.refreshComments();
  assert.equal(page.data.commentReply.id, 'comment');
  await page.submitComment();
  assert.equal(requests[1].parentId, 'comment'); assert.equal(requests[1].clientRequestId, requests[0].clientRequestId);
  assert.equal(page.data.commentContent, ''); assert.equal(page.data.commentReply, null);
});

test('deletion requires confirmation, retains failed data, then refreshes count and tombstone', async () => {
  let deleted = false; let fail = true; let calls = 0;
  const { page, wx } = await open({ get: async url => url.includes('/comments?') ? listing([comment('comment', { deleted, content: deleted ? '' : '原文' })]) : content(),
    delete: async () => { calls += 1; if (fail) throw new Error('删除断网'); deleted = true; return { deleted: true, id: 'comment' }; }
  });
  page.commentInput(input('我的草稿'));
  let deleting = page.deleteComment(tap('comment')); await page.deleteComment(tap('comment'));
  assert.equal(wx.modals.length, 1); wx.modals[0].success({ confirm: false }); await deleting; assert.equal(calls, 0);
  deleting = page.deleteComment(tap('comment')); wx.modals[1].success({ confirm: true }); await deleting;
  assert.equal(page.data.comments[0].content, '原文'); assert.equal(page.data.commentContent, '我的草稿'); assert.equal(page.data.commentError, '删除断网');
  fail = false; deleting = page.deleteComment(tap('comment')); wx.modals[2].success({ confirm: true }); await deleting;
  assert.equal(page.data.commentCount, 0); assert.equal(page.data.comments[0].deleted, true); assert.equal(page.data.comments[0].canReply, false);
  assert.equal(page.data.commentContent, '我的草稿'); assert.equal(page.data.commentDeleteBusyId, '');
});

test('leaving while confirming deletion prevents the write and late list results stay hidden', async () => {
  let calls = 0;
  const { page, wx } = await open({ delete: async () => { calls += 1; } });
  const deleting = page.deleteComment(tap('comment')); page.onHide(); wx.modals[0].success({ confirm: true }); await deleting;
  assert.equal(calls, 0); assert.equal(page.data.comments.length, 0);
  const pending = deferred();
  // A separately opened page starts its list request before it is hidden.
  const late = harness({ get: async url => url.includes('/comments?') ? pending.promise : content() });
  await late.page.onShow(); late.page.onHide(); pending.resolve(listing([comment('late')])); await Promise.resolve(); await Promise.resolve();
  assert.equal(late.page.data.comments.length, 0); assert.equal(late.page.data.commentsReady, false);
});

test('switching accounts clears drafts before login finishes and ignores the old send response', async () => {
  const pending = deferred();
  const { page, app, wx } = await open({ post: () => pending.promise });
  page.commentInput(input('账号甲的私密草稿')); const sending = page.submitComment();
  page.onHide(); app.globalData.user = { id: 'reader-b', verified: true }; const showing = page.onShow();
  assert.equal(page.data.commentContent, ''); assert.equal(page.data.commentReply, null);
  await showing; await page.loadComments(); page.commentInput(input('账号乙的新草稿'));
  pending.resolve(comment('from-a', { content: '账号甲的私密草稿' })); await sending;
  assert.equal(page.data.commentContent, '账号乙的新草稿'); assert.deepEqual(wx.toasts, []);
});

test('an account change during a list read clears old detail, sharing, and the private draft immediately', async () => {
  const pending = deferred(); let slow = false;
  const { page, app } = await open({ get: async url => url.includes('/comments?') ? (slow ? pending.promise : listing([comment()])) : content() });
  page.replyComment(tap('comment')); page.commentInput(input('旧账号的草稿')); slow = true;
  const reading = page.refreshComments(); app.globalData.user = { id: 'another-reader', verified: true };
  pending.resolve(listing([comment('old-result')])); await reading;
  assert.equal(page.data.post, null); assert.equal(page.data.canShare, false); assert.equal(page.data.comments.length, 0);
  assert.equal(page.data.commentContent, ''); assert.equal(page.data.commentReply, null);
});

test('hidden successful send preserves the same account retry key without announcing a late success', async () => {
  const pending = deferred(); const requests = [];
  const { page, wx } = await open({ post: async (url, body) => { requests.push(body); if (requests.length === 1) return pending.promise; return comment('sent', { content: body.content }); } });
  page.commentInput(input('弱网发言')); const sending = page.submitComment(); page.onHide();
  pending.resolve(comment('sent', { content: '弱网发言' })); await sending;
  assert.equal(page.data.commentContent, '弱网发言'); assert.deepEqual(wx.toasts, []);
  await page.onShow(); await page.loadComments(); await page.submitComment();
  assert.equal(requests[1].clientRequestId, requests[0].clientRequestId); assert.equal(page.data.commentContent, '');
});

test('post reload invalidates a pending list and revoked comment access clears protected content and drafts', async () => {
  for (const statusCode of [401, 403, 404]) {
    let revoked = false;
    const { page } = await open({ get: async url => {
      if (!url.includes('/comments?')) return content();
      if (revoked) throw statusError(statusCode);
      return listing([comment()]);
    } });
    page.replyComment(tap('comment')); page.commentInput(input('受保护草稿')); revoked = true; await page.refreshComments();
    assert.equal(page.data.post, null); assert.equal(page.data.canShare, false); assert.equal(page.data.comments.length, 0);
    assert.equal(page.data.commentContent, ''); assert.equal(page.data.commentReply, null); assert.equal(page.data.commentBusy, false);
  }
  const slow = deferred(); let preview = false;
  const { page } = harness({ get: async url => url.includes('/comments?') ? slow.promise : content({ status: preview ? 'pending' : 'approved' }) });
  await page.onShow(); preview = true; await page.load(); slow.resolve(listing([comment('late')])); await Promise.resolve(); await Promise.resolve();
  assert.equal(page.data.post.status, 'pending'); assert.equal(page.data.comments.length, 0);
});

test('a missing reply target rechecks detail once and a new account never receives its late error', async () => {
  const recheck = deferred(); const recheckStarted = deferred(); let detailReads = 0;
  const { page, app } = await open({ get: async url => {
    if (url.includes('/comments?')) return listing([comment()]);
    detailReads += 1;
    if (detailReads === 2) { recheckStarted.resolve(); return recheck.promise; }
    return content();
  }, post: async () => { throw statusError(404); } });
  page.replyComment(tap('comment')); page.commentInput(input('回复仍保留')); const sending = page.submitComment();
  await recheckStarted.promise;
  assert.equal(detailReads, 2);
  page.onHide(); app.globalData.user = { id: 'new-account', verified: true }; await page.onShow(); await page.loadComments();
  page.commentInput(input('新的草稿')); recheck.resolve(content()); await sending;
  assert.equal(page.data.commentError, ''); assert.equal(page.data.commentContent, '新的草稿'); assert.equal(detailReads, 3);
});

test('event registration can finish during a comment read without invalidating that read', async () => {
  const pending = deferred();
  const { page } = harness({ get: async url => url.includes('/comments?') ? pending.promise : content({ event: {
    id: 'event', status: 'active', registered: false, registeredCount: 0, capacity: 10,
    startsAt: '2099-12-02T09:00:00+08:00', endsAt: '2099-12-02T12:00:00+08:00', registrationDeadline: '2099-12-01T18:00:00+08:00'
  } }), post: async () => ({ registered: true, registeredCount: 1, capacity: 10 }) });
  await page.onShow(); await page.register(); pending.resolve(listing([comment()])); await page.loadComments();
  assert.equal(page.data.commentsReady, true); assert.equal(page.data.comments.length, 1); assert.equal(page.data.post.event.registered, true);
});

