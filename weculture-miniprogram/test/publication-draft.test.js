const test = require('node:test');
const assert = require('node:assert/strict');
const { DRAFT_VERSION, draftKey, draftFromForm, draftHasContent, writeDraft, readDraft, clearDraft } = require('../utils/publication-draft');

function storage() {
  const map = new Map();
  return { map, getStorageSync: key => map.get(key) || '', setStorageSync: (key, value) => map.set(key, value), removeStorageSync: key => map.delete(key) };
}
const form = (changes = {}) => ({ type: 'event', circle: 'city', city: '北京', contentLanguage: 'zh', title: '文化行走', content: '周末一起去故宫。', tag: '文化活动', price: '', location: '故宫', startDate: '2026-12-01', startTime: '09:00', endDate: '2026-12-01', endTime: '12:00', deadlineDate: '2026-11-30', deadlineTime: '18:00', capacity: 20, ...changes });

test('drafts are scoped by user and round-trip all text and event fields', () => {
  const store = storage();
  assert.equal(writeDraft(store, 'user-a', form()), true);
  const saved = readDraft(store, 'user-a');
  assert.equal(saved.version, DRAFT_VERSION);
  assert.deepEqual(saved, { ...draftFromForm(form()) });
  assert.equal(readDraft(store, 'user-b'), null);
  assert.notEqual(draftKey('user-a'), draftKey('user-b'));
  clearDraft(store, 'user-a');
  assert.equal(readDraft(store, 'user-a'), null);
});

test('empty drafts are removed and only meaningful text counts as content', () => {
  const store = storage();
  assert.equal(draftHasContent(draftFromForm(form({ title: '', content: '', tag: '', location: '', price: '' }))), false);
  writeDraft(store, 'user-a', form());
  assert.equal(writeDraft(store, 'user-a', form({ title: '', content: '', tag: '', price: '', location: '' })), false);
  assert.equal(store.map.has(draftKey('user-a')), false);
  assert.equal(draftHasContent(draftFromForm(form({ title: '  ' }))), true);
});

test('corrupt, wrong-version and oversized drafts are sanitized or ignored', () => {
  const store = storage();
  store.setStorageSync(draftKey('user-a'), '{bad json');
  assert.equal(readDraft(store, 'user-a'), null);
  store.setStorageSync(draftKey('user-a'), JSON.stringify({ ...form(), version: 99 }));
  assert.equal(readDraft(store, 'user-a'), null);
  store.setStorageSync(draftKey('user-a'), JSON.stringify({ ...form({ title: '题'.repeat(80), content: '文'.repeat(2100), type: 'unknown', circle: 'unknown', contentLanguage: 'xx', capacity: 999999 }), version: 1 }));
  const saved = readDraft(store, 'user-a');
  assert.equal(saved.title.length, 40);
  assert.equal(saved.content.length, 2000);
  assert.equal(saved.type, 'dynamic');
  assert.equal(saved.circle, 'campus');
  assert.equal(saved.contentLanguage, 'zh');
  assert.equal(saved.capacity, 100000);
});

test('storage failures never throw and never create a draft', () => {
  const store = storage();
  store.setStorageSync = () => { throw new Error('quota'); };
  assert.equal(writeDraft(store, 'user-a', form()), false);
  store.getStorageSync = () => { throw new Error('unavailable'); };
  assert.equal(readDraft(store, 'user-a'), null);
  clearDraft(store, 'user-a');
});

test('invalid users and temporary images are not persisted', () => {
  const store = storage();
  assert.equal(writeDraft(store, '', form()), false);
  const saved = readDraft(store, 'user-a');
  assert.equal(saved, null);
  writeDraft(store, 'user-a', form({ imageTempPath: 'wxfile://tmp.jpg' }));
  assert.equal('imageTempPath' in readDraft(store, 'user-a'), false);
});
