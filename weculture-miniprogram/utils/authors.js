const { formatPost } = require('./format');

const AUTHOR_PAGE_SIZE = 20;
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);

function authorPath(id) {
  return safeId(id) ? `/pages/author/index?id=${encodeURIComponent(id)}` : '';
}

function authorFromPath(value) {
  const match = typeof value === 'string' && /^\/pages\/author\/index\?id=([a-zA-Z0-9_-]{1,80})$/.exec(value);
  return match ? match[1] : '';
}

function authorProfilePath(author) {
  return author && author.profileAvailable === true ? authorPath(author.id) : '';
}

function readAuthorProfile(value, id) {
  if (!value || value.id !== id || !safeId(value.id) || value.profileAvailable === false ||
      typeof value.nickname !== 'string' || !value.nickname.trim() ||
      (value.avatarUrl != null && typeof value.avatarUrl !== 'string') ||
      !Number.isInteger(value.visiblePostCount) || value.visiblePostCount < 0) {
    throw new Error('作者资料暂时无法加载，请重试');
  }
  // Keep only public profile fields; school membership never belongs on this page.
  return { id: value.id, nickname: value.nickname, avatarUrl: value.avatarUrl || '',
    initial: value.nickname.slice(0, 1), visiblePostCount: value.visiblePostCount };
}

function readAuthorPosts(value, id, page) {
  if (!value || !Array.isArray(value.items) || value.page !== page || value.pageSize !== AUTHOR_PAGE_SIZE ||
      !Number.isInteger(value.total) || value.total < value.items.length || value.items.length > AUTHOR_PAGE_SIZE || typeof value.hasMore !== 'boolean' ||
      value.items.some(post => !post || !safeId(post.id) || post.status !== 'approved' || !post.author || post.author.id !== id || post.author.profileAvailable === false)) {
    throw new Error('作品暂时无法加载，请重试');
  }
  return { ...value, items: value.items.map(formatPost) };
}

function mergeAuthorPosts(existing, incoming) {
  const seen = new Set();
  return existing.concat(incoming).filter(post => { if (seen.has(post.id)) return false; seen.add(post.id); return true; });
}

module.exports = { AUTHOR_PAGE_SIZE, authorPath, authorFromPath, authorProfilePath, readAuthorProfile, readAuthorPosts, mergeAuthorPosts };
