function normalizeTopic(value) {
  if (typeof value !== 'string') return '';
  const tag = value.trim();
  return tag && tag.length <= 80 && !/[\u0000-\u001f\u007f]/.test(tag) ? tag : '';
}

function topicPath(value) {
  const tag = normalizeTopic(value);
  return tag ? `/pages/topic/index?tag=${encodeURIComponent(tag)}` : '';
}

function topicFromQuery(value) {
  if (typeof value !== 'string' || value.length > 800) return '';
  try { return normalizeTopic(decodeURIComponent(value)); } catch (_) { return ''; }
}

function topicFromPath(value) {
  const prefix = '/pages/topic/index?tag=';
  if (typeof value !== 'string' || !value.startsWith(prefix)) return '';
  const tag = topicFromQuery(value.slice(prefix.length));
  return tag && topicPath(tag) === value ? tag : '';
}

module.exports = { normalizeTopic, topicPath, topicFromQuery, topicFromPath };
