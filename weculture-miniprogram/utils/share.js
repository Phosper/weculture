const { HOME_PATH, detailPath } = require('./return-path');
const DEFAULT_IMAGE = '/assets/home-tea.jpg';

function contentShare(post) {
  const path = post && post.status === 'approved' && detailPath(post.id);
  if (!path) return { title: 'Weculture · 发现文化生活', path: HOME_PATH, imageUrl: DEFAULT_IMAGE };
  // A chat card is visible before the recipient's school permission is checked.
  const campus = post.circle === 'campus' || post.visibility === 'school' || !!post.schoolId;
  const image = typeof post.imageUrl === 'string' && (/^https:\/\//.test(post.imageUrl) || /^\/assets\/[a-zA-Z0-9_.-]+$/.test(post.imageUrl)) ? post.imageUrl : DEFAULT_IMAGE;
  return {
    title: campus ? '校园圈内容 · 需本校认证后查看' : post.title || 'Weculture · 文化分享',
    path,
    imageUrl: campus ? DEFAULT_IMAGE : image
  };
}

module.exports = { contentShare };
