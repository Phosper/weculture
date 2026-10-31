const HOME_PATH = '/pages/home/index';
const { topicPath, topicFromPath } = require('./topics');
const { authorPath, authorFromPath } = require('./authors');
const PAGES = ['home', 'community', 'travel', 'profile', 'publish', 'assistant', 'verify', 'typography'];

function detailPath(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id)
    ? `/pages/detail/index?id=${encodeURIComponent(id)}` : '';
}

function safeReturnPath(value) {
  if (typeof value !== 'string' || value.length > 2000) return HOME_PATH;
  // Preserve an already canonical topic path before decoding an outer login parameter.
  if (topicFromPath(value)) return value;
  if (authorFromPath(value)) return value;
  let candidate;
  try { candidate = decodeURIComponent(value); } catch (_) { return HOME_PATH; }
  if (/^\/pages\/detail\/index\?id=[a-zA-Z0-9_-]{1,80}$/.test(candidate)) return candidate;
  if (topicFromPath(candidate)) return candidate;
  if (authorFromPath(candidate)) return candidate;
  return PAGES.some(page => candidate === `/pages/${page}/index`) ? candidate : HOME_PATH;
}

function currentReturnPath(page, current) {
  if (current && current.route === 'pages/detail/index') {
    return detailPath(current.options && current.options.id || page.postId) || HOME_PATH;
  }
  if (current && current.route === 'pages/topic/index') return topicPath(page.data && page.data.tag) || HOME_PATH;
  if (current && current.route === 'pages/author/index') return authorPath(current.options && current.options.id || page.authorId) || HOME_PATH;
  if (current && current.route === 'pages/verify/index' && page.returnTo) {
    const returnTo = safeReturnPath(page.returnTo);
    if (returnTo.startsWith('/pages/detail/index?id=') || topicFromPath(returnTo) || authorFromPath(returnTo)) return returnTo;
  }
  return safeReturnPath(current && current.route ? `/${current.route}` : '');
}

module.exports = { HOME_PATH, detailPath, safeReturnPath, currentReturnPath };
