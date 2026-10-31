const { formatDateTime } = require('./format');

const COMMENT_LIMIT = 500;
const COMMENT_PAGE_SIZE = 20;
let requestSequence = 0;

function commentDraft(content, parentId) {
  const text = typeof content === 'string' ? content.trim() : '';
  if (!text) throw new Error('写点内容再发送吧');
  if (text.length > COMMENT_LIMIT) throw new Error('评论不能超过500字');
  return { content: text, parentId: parentId || null };
}

function prepareCommentRequest(previous, draft) {
  if (previous && previous.content === draft.content && previous.parentId === draft.parentId) return previous;
  requestSequence += 1;
  return { ...draft, clientRequestId: `comment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}-${requestSequence.toString(36)}` };
}

function formatComment(item) {
  const author = item.author || {};
  return { ...item, content: item.deleted ? '' : item.content, createdAtText: formatDateTime(item.createdAt),
    author: { ...author, nickname: author.nickname || '文化同好', initial: (author.nickname || '文').slice(0, 1) },
    parent: item.parent ? { ...item.parent, nickname: item.parent.nickname || '文化同好' } : null,
    canDelete: !item.deleted && !!item.canDelete, canReply: !item.deleted && !!item.canReply,
    canReport: !item.deleted && !!item.canReport };
}

function readCommentPage(result, postId, page) {
  if (!result || !Array.isArray(result.items) || result.page !== page || !Number.isInteger(result.total) || result.total < 0 ||
      !Number.isInteger(result.activeCount) || result.activeCount < 0 || typeof result.hasMore !== 'boolean' ||
      result.items.some(item => !item || typeof item.id !== 'string' || item.postId !== postId || typeof item.content !== 'string')) {
    throw new Error('评论暂时加载失败，请重试');
  }
  return { ...result, items: result.items.map(formatComment) };
}

function mergeComments(existing, incoming) {
  const seen = new Set();
  return existing.concat(incoming).filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; });
}

function confirmCommentDeletion(ui) {
  return new Promise((resolve, reject) => ui.showModal({
    title: '删除这条评论', content: '删除后将显示“评论已删除”，已有回复会保留。', confirmText: '确认删除', confirmColor: '#C5532E',
    success: result => resolve(!!result.confirm), fail: () => reject(new Error('暂时无法确认删除，请重试'))
  }));
}

module.exports = { COMMENT_LIMIT, COMMENT_PAGE_SIZE, commentDraft, prepareCommentRequest, formatComment, readCommentPage, mergeComments, confirmCommentDeletion };
