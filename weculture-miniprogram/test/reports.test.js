const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { reportDraft, reportPayload } = require('../utils/reports');

const content = changes => ({ id: 'post', title: '文化故事', status: 'approved', circle: 'city',
  author: { id: 'author', nickname: '作者' }, canReport: true, ...changes });
const comment = changes => ({ id: 'comment-1', postId: 'post', content: '这是一条评论', createdAt: '2026-11-01T02:00:00.000Z',
  deleted: false, author: { id: 'other', nickname: '评论者' }, isPostAuthor: false, canDelete: false, canReply: true, canReport: true, parent: null, ...changes });
const listing = items => ({ items, page: 1, pageSize: 20, total: items.length, activeCount: items.filter(item => !item.deleted).length, hasMore: false });
const tap = (code) => ({ currentTarget: { dataset: { code } } });
const commentTap = id => ({ currentTarget: { dataset: { id } } });
const input = value => ({ detail: { value } });

function harness(overrides = {}) {
  let definition;
  const app = { globalData: { user: { id: 'reader', nickname: '同学', verified: true } } };
  const calls = [];
  const wx = { toasts: [], menus: [], stopped: 0,
    showToast: options => wx.toasts.push(options.title),
    showShareMenu: () => wx.menus.push(true), hideShareMenu: () => wx.menus.push(false),
    stopPullDownRefresh: () => { wx.stopped += 1; } };
  const api = {
    get: overrides.get || (async url => url.includes('/comments?') ? listing([comment()]) : content()),
    post: async (url, body) => {
      calls.push({ url, body });
      return (overrides.post || (async () => ({ id: 'report-1', status: 'pending', duplicate: false })))(url, body);
    }
  };
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
  return { page, app, wx, calls };
}
async function open(overrides = {}) {
  const result = harness(overrides);
  await result.page.onShow();
  if (result.page._commentsRead) await result.page._commentsRead.promise;
  return result;
}

test('report drafts validate reason, other detail and the 500 character limit', () => {
  assert.deepEqual(reportDraft('spam', '  广告  '), { reason: 'spam', detail: '广告' });
  assert.deepEqual(reportDraft('spam'), { reason: 'spam', detail: '' });
  assert.throws(() => reportDraft('other', '  '), /其他/);
  assert.throws(() => reportDraft('spam', '文'.repeat(501)), /500/);
  assert.throws(() => reportDraft('unknown', ''), /举报原因/);
  assert.deepEqual(reportPayload('post', 'post', reportDraft('spam')), { targetType: 'post', targetId: 'post', reason: 'spam', detail: '' });
  assert.throws(() => reportPayload('user', 'post', reportDraft('spam')), /对象无效/);
});

test('post report submits only ids and reason, then closes and reports success', async () => {
  const { page, calls, wx } = await open();
  page.openPostReport();
  assert.equal(page.data.reportOpen, true);
  assert.equal(page.data.reportTarget.type, 'post');
  page.chooseReportReason(tap('spam'));
  page.reportDetailInput(input('  广告  '));
  await page.submitReport();
  assert.deepEqual(calls.at(-1), { url: '/reports', body: { targetType: 'post', targetId: 'post', reason: 'spam', detail: '广告' } });
  assert.equal(page.data.reportOpen, false);
  assert.equal(page.data.reportBusy, false);
  assert.deepEqual(wx.toasts, ['举报已提交']);
});

test('comment report targets the selected comment and duplicate submissions are idempotent', async () => {
  const duplicate = await open({ post: async () => ({ id: 'report-2', status: 'pending', duplicate: true }) });
  duplicate.page.openCommentReport(commentTap('comment-1'));
  assert.equal(duplicate.page.data.reportTarget.type, 'comment');
  duplicate.page.chooseReportReason(tap('harassment'));
  await duplicate.page.submitReport();
  assert.deepEqual(duplicate.calls.at(-1), { url: '/reports', body: { targetType: 'comment', targetId: 'comment-1', reason: 'harassment', detail: '' } });
  assert.deepEqual(duplicate.wx.toasts, ['已提交过，正在处理']);
});

test('failed submissions keep the report sheet and its content for retry', async () => {
  const result = await open({ post: async () => { throw new Error('网络中断'); } });
  result.page.openPostReport();
  result.page.chooseReportReason(tap('false_info'));
  result.page.reportDetailInput(input('请核实'));
  await result.page.submitReport();
  assert.equal(result.page.data.reportOpen, true);
  assert.equal(result.page.data.reportBusy, false);
  assert.match(result.page.data.reportError, /网络中断/);
  assert.equal(result.page.data.reportDetail, '请核实');
});

test('other requires detail and invalid reasons are ignored', async () => {
  const { page, calls } = await open();
  page.openPostReport();
  page.chooseReportReason(tap('other'));
  await page.submitReport();
  assert.match(page.data.reportError, /其他/);
  assert.equal(calls.length, 0);
  page.chooseReportReason(tap('not-a-reason'));
  assert.equal(page.data.reportReason, 'other');
});

test('own content and deleted comments expose no report entry', async () => {
  const result = await open({ get: async url => url.includes('/comments?') ? listing([comment({ canReport: false })]) : content({ canReport: false }) });
  result.page.openPostReport();
  result.page.openCommentReport(commentTap('comment-1'));
  assert.equal(result.page.data.reportOpen, false);
  assert.equal(result.page.data.reportTarget, null);
});

test('account changes close the report sheet before a late response can reuse it', async () => {
  const { page, app } = await open();
  page.openPostReport();
  assert.equal(page.data.reportOpen, true);
  app.globalData.user = { id: 'another', nickname: '另一位同学', verified: true };
  page.syncCommentUser();
  assert.equal(page.data.reportOpen, false);
  assert.equal(page.data.reportTarget, null);
});
