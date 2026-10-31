const reviewStates = {
  pending: { label: '审核中', hint: '审核通过后，本校认证成员就能看到这条内容。' },
  approved: { label: '已发布', hint: '已向本校认证成员展示。' },
  rejected: { label: '已驳回', hint: '本次投稿未通过审核。' },
  offline: { label: '已下架', hint: '内容已停止展示。' },
  draft: { label: '草稿', hint: '内容尚未提交。' }
};

function reviewInfo(post) {
  const state = reviewStates[post.status] || { label: '状态待确认', hint: '请刷新查看最新审核结果。' };
  const publicPost = ['city', 'international'].includes(post.circle) || post.scope === 'platform';
  const audience = post.circle === 'city' ? `${post.city || '所选城市'}的同城圈` : '国际圈';
  const hint = publicPost && post.status === 'pending' ? `审核通过后将在${audience}公开展示。` : publicPost && post.status === 'approved' ? `已在${post.circle ? audience : '平台'}公开展示。` : state.hint;
  return { statusLabel: state.label, statusHint: hint, reviewReason: ['rejected', 'offline'].includes(post.status) ? post.rejectionReason || '暂未提供原因，请联系运营人员。' : '' };
}

function submissionData(form) {
  const title = form.title.trim();
  const content = form.content.trim();
  if (title.length < 2 || title.length > 40) throw new Error('标题需为2至40个字');
  if (content.length < 2 || content.length > 2000) throw new Error('正文需为2至2000个字');
  const { CIRCLES, CONTENT_LANGUAGES, normalizeCity } = require('./circles');
  const circle = form.circle || 'campus';
  if (!CIRCLES[circle]) throw new Error('请选择发布圈层');
  const data = { type: form.type, title, content, tag: form.type === 'market' && form.price ? `闲置 · ¥${form.price}` : form.tag, circle };
  if (circle === 'city') {
    const city = normalizeCity(form.city);
    if (!city || city.length > 50) throw new Error('请选择发布城市');
    data.city = city;
  }
  if (circle === 'international') {
    if (!CONTENT_LANGUAGES.some(item => item.value === form.contentLanguage)) throw new Error('请选择内容语言');
    data.contentLanguage = form.contentLanguage;
  }
  if (form.type === 'event') {
    const start = new Date(`${form.startDate}T${form.startTime}`);
    const end = new Date(`${form.endDate}T${form.endTime}`);
    const deadline = new Date(`${form.deadlineDate}T${form.deadlineTime}`);
    const capacity = Number(form.capacity);
    if (!form.location.trim()) throw new Error('请填写活动地点');
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('人数上限需为大于0的整数');
    if (![start, end, deadline].every((value) => Number.isFinite(+value)) || start >= end || deadline >= start) throw new Error('请检查活动时间：截止时间应早于开始时间，结束时间应晚于开始时间');
    Object.assign(data, { location: form.location.trim(), startsAt: start.toISOString(), endsAt: end.toISOString(), registrationDeadline: deadline.toISOString(), capacity });
  }
  return data;
}

module.exports = { reviewInfo, submissionData };
