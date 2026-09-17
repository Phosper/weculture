function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatPost(post) {
  if (!post) return post;
  return {
    ...post,
    createdAtText: formatDateTime(post.createdAt),
    event: post.event ? {
      ...post.event,
      startsAtText: formatDateTime(post.event.startsAt),
      registrationDeadlineText: formatDateTime(post.event.registrationDeadline)
    } : null
  };
}

module.exports = { formatDateTime, formatPost };
