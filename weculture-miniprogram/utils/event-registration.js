function confirmEventCancellation(ui, title) {
  return new Promise((resolve, reject) => ui.showModal({
    title: '取消活动报名',
    content: `确认取消“${title || '这场活动'}”的报名？取消后将从我的计划中移除，名额会释放。`,
    confirmText: '确认取消',
    cancelText: '保留报名',
    success: result => resolve(!!result.confirm),
    fail: () => reject(new Error('暂时无法确认取消，请重试'))
  }));
}

async function changeEventRegistration(api, eventId, registered) {
  const result = registered
    ? await api.post(`/events/${eventId}/registrations`, {})
    : await api.delete(`/events/${eventId}/registrations/me`);
  if (!result || result.registered !== registered || !Number.isInteger(result.registeredCount) || result.registeredCount < 0) {
    throw new Error('暂未确认报名结果，请刷新后重试');
  }
  return result;
}

module.exports = { confirmEventCancellation, changeEventRegistration };
