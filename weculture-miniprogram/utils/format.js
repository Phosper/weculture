const { reviewInfo } = require('./publication');
const { circleLabel } = require('./circles');

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const localMedia = {
  '非遗扇艺工作坊开放报名': 'photo-fan-craft.jpg',
  '沉浸式体验非遗：我们在校园里办了一场茶艺社！': 'home-tea.jpg',
  '当水墨遇见极简主义：我的毕业展倒计时。': 'photo-ink-painting.jpg',
  '剪纸艺术进校园，这就是指尖上的中国魅力！': 'photo-paper-cutting.jpg',
  '寻找校园里的“梁思成”：中式古建的结构之美。': 'home-autumn-roof.jpg',
  '本周校园文化活动清单': 'photo-culture-night.jpg',
  '周末故宫文化行': 'photo-forbidden-city-trip.jpg',
  '京城文化 3 日游': 'photo-forbidden-city-tour.jpg',
  '上海海派风情 2 日游': 'photo-shanghai-travel.jpg'
};

function resolveMedia(value, title) {
  const file = localMedia[title] || (typeof value === 'string' && value.startsWith('asset://') ? value.slice(8) : '');
  return file ? `/assets/${file}` : value || '';
}

function formatEvent(event, postStatus = 'approved') {
  const now = Date.now();
  const registered = !!event.registered;
  const ended = new Date(event.endsAt).getTime() <= now;
  const deadlinePassed = new Date(event.registrationDeadline).getTime() <= now;
  const full = event.registeredCount >= event.capacity;
  const changeNote = typeof event.changeNote === 'string' ? event.changeNote.trim() : '';
  const cancellationReason = typeof event.cancellationReason === 'string' ? event.cancellationReason.trim() : '';
  const changeNotice = event.status === 'cancelled' ? (cancellationReason || '活动已取消')
    : event.status === 'changed' ? (changeNote || '活动安排有变更，请留意最新信息') : '';
  const eventStatusText = event.status === 'cancelled' ? '活动已取消'
    : event.status === 'changed' ? '活动安排有变更，请留意最新信息'
      : ended ? '活动已结束' : deadlinePassed ? '报名已截止' : full ? '名额已满' : '报名中';
  return {
    ...event,
    registered,
    startsAtText: formatDateTime(event.startsAt),
    endsAtText: formatDateTime(event.endsAt),
    registrationDeadlineText: formatDateTime(event.registrationDeadline),
    changedAtText: formatDateTime(event.changedAt),
    changeNote,
    cancellationReason,
    changeNotice,
    eventStatusText,
    eventNextStep: event.status === 'cancelled' ? '活动已取消，可取消报名并移出计划。' : event.status === 'changed' ? '安排有变更，请点击卡片核对最新时间和地点。' : ended ? '活动已结束，可查看详情或取消报名移出计划。' : '点击卡片查看最新安排，按活动时间和地点参加。',
    cancelable: postStatus === 'approved' && registered,
    registerable: postStatus === 'approved' && !registered && event.status === 'active' && !ended && new Date(event.registrationDeadline).getTime() > now && !full,
    actionText: registered ? '已报名' : postStatus !== 'approved' ? (postStatus === 'pending' ? '审核通过后可报名' : '内容暂不可报名') : event.status !== 'active' ? '活动暂不可报名' : ended ? '活动已结束' : deadlinePassed ? '报名已截止' : full ? '名额已满' : '立即报名'
  };
}

function formatPost(post) {
  if (!post) return post;
  const legacyDemo = post.circle == null && post.visibility === 'platform' && !post.schoolId;
  const fallbackImage = resolveMedia(post.imageUrl, legacyDemo ? post.title : undefined);
  const imageUrls = Array.isArray(post.imageUrls) && post.imageUrls.length
    ? post.imageUrls.map((value) => resolveMedia(value))
    : (fallbackImage ? [fallbackImage] : []);
  const coverIndex = Number.isInteger(post.coverIndex) && post.coverIndex >= 0 && post.coverIndex < imageUrls.length ? post.coverIndex : 0;
  return {
    ...post,
    ...reviewInfo(post),
    circleLabel: circleLabel(post),
    imageUrl: imageUrls[coverIndex] || '',
    imageUrls,
    coverIndex,
    coverUrl: imageUrls[coverIndex] || '',
    communityImageUrl: legacyDemo && post.title === '沉浸式体验非遗：我们在校园里办了一场茶艺社！' ? '/assets/community-tea.jpg' : '',
    collageImages: legacyDemo && post.title === '沉浸式体验非遗：我们在校园里办了一场茶艺社！' ? ['/assets/home-tea.jpg', '/assets/community-cups.jpg'] : null,
    createdAtText: formatDateTime(post.createdAt),
    author: { ...(post.author || { nickname: 'Weculture' }), initial: (post.author && post.author.nickname || 'Weculture').slice(0, 1) },
    event: post.event ? formatEvent(post.event, post.status) : null
  };
}

function formatRoute(route) {
  return {
    ...route,
    ...(route.type === 'event' ? formatEvent({ ...route, registered: true }) : {}),
    circleLabel: route.type === 'event' ? circleLabel(route) : '',
    coverUrl: resolveMedia(route.coverUrl, route.title),
    stopsText: Array.isArray(route.stops) ? route.stops.join(' → ') : '',
    highlightsText: Array.isArray(route.highlights) ? route.highlights.join(' · ') : ''
  };
}

module.exports = { formatDateTime, formatPost, formatRoute, formatEvent, resolveMedia };
