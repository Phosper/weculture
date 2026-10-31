const test = require('node:test');
const assert = require('node:assert/strict');
const { formatEvent } = require('../utils/format');

const event = (changes = {}) => ({ status: 'active', startsAt: '2026-12-01T01:00:00.000Z', endsAt: '2026-12-01T04:00:00.000Z',
  registrationDeadline: '2026-11-30T10:00:00.000Z', capacity: 30, registeredCount: 2, location: '教室',
  changeNote: '', cancellationReason: '', changedAt: null, ...changes });

test('changed events expose the operator note and update time', () => {
  const formatted = formatEvent(event({ status: 'changed', changeNote: '地点改到新教室', changedAt: '2026-11-01T02:00:00.000Z' }));
  assert.equal(formatted.changeNotice, '地点改到新教室');
  assert.equal(formatted.changeNote, '地点改到新教室');
  assert.match(formatted.changedAtText, /2026年11月1日/);
  assert.equal(formatted.eventStatusText, '活动安排有变更，请留意最新信息');
});

test('cancelled events prefer the cancellation reason and fall back to a clear message', () => {
  assert.equal(formatEvent(event({ status: 'cancelled', cancellationReason: '天气原因' })).changeNotice, '天气原因');
  assert.equal(formatEvent(event({ status: 'cancelled' })).changeNotice, '活动已取消');
  assert.equal(formatEvent(event()).changeNotice, '');
});

test('trimmed notes cannot render as blank change banners', () => {
  assert.equal(formatEvent(event({ status: 'changed', changeNote: '   ' })).changeNotice, '活动安排有变更，请留意最新信息');
  assert.equal(formatEvent(event({ status: 'cancelled', cancellationReason: '   ' })).changeNotice, '活动已取消');
});
