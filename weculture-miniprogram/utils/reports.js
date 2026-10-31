const REPORT_DETAIL_LIMIT = 500;
const REPORT_REASONS = [
  { code: 'spam', label: '垃圾广告' },
  { code: 'harassment', label: '辱骂骚扰' },
  { code: 'false_info', label: '虚假信息' },
  { code: 'inappropriate', label: '低俗不当' },
  { code: 'privacy', label: '泄露隐私' },
  { code: 'other', label: '其他' }
];
const REPORT_TYPES = ['post', 'comment'];

function reportDraft(reason, detail) {
  if (typeof reason !== 'string' || !REPORT_REASONS.some(item => item.code === reason)) throw new Error('请选择举报原因');
  const text = typeof detail === 'string' ? detail.trim() : '';
  if (text.length > REPORT_DETAIL_LIMIT) throw new Error('补充说明不能超过500字');
  if (reason === 'other' && !text) throw new Error('选择“其他”时请补充说明');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error('补充说明包含无效字符');
  return { reason, detail: text };
}

function reportPayload(targetType, targetId, draft) {
  if (!REPORT_TYPES.includes(targetType)) throw new Error('举报对象无效');
  const id = typeof targetId === 'string' ? targetId.trim() : '';
  if (!id || id.length > 80) throw new Error('举报对象无效');
  if (!draft || typeof draft.reason !== 'string') throw new Error('请选择举报原因');
  return { targetType, targetId: id, reason: draft.reason, detail: draft.detail || '' };
}

function formatReportResult(result) {
  if (!result || typeof result.id !== 'string' || typeof result.duplicate !== 'boolean') throw new Error('举报结果暂未确认，请重试');
  return { id: result.id, status: result.status, duplicate: result.duplicate };
}

module.exports = { REPORT_DETAIL_LIMIT, REPORT_REASONS, reportDraft, reportPayload, formatReportResult };
