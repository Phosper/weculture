const DRAFT_VERSION = 1;
const TYPES = ['dynamic', 'event', 'market'];
const CIRCLES = ['city', 'international', 'campus'];
const LANGUAGES = ['zh', 'en', 'ru', 'fr', 'es', 'ar', 'other'];
const LIMITS = { title: 40, content: 2000, tag: 80, price: 20, location: 200, city: 50,
  startDate: 10, startTime: 5, endDate: 10, endTime: 5, deadlineDate: 10, deadlineTime: 5 };
const STRING_FIELDS = Object.keys(LIMITS);
const CONTENT_FIELDS = ['title', 'content', 'tag', 'price', 'location'];

function draftKey(userId) {
  return typeof userId === 'string' && userId ? `wecultureDraft:${userId}` : '';
}

function text(value, maximum) {
  return typeof value === 'string' ? value.slice(0, maximum) : '';
}

function draftFromForm(form) {
  const draft = { version: DRAFT_VERSION,
    type: TYPES.includes(form && form.type) ? form.type : 'dynamic',
    circle: CIRCLES.includes(form && form.circle) ? form.circle : 'campus',
    contentLanguage: LANGUAGES.includes(form && form.contentLanguage) ? form.contentLanguage : 'zh',
    capacity: Number.isInteger(Number(form && form.capacity)) ? Math.min(100000, Math.max(1, Number(form.capacity))) : 30 };
  for (const field of STRING_FIELDS) draft[field] = text(form && form[field], LIMITS[field]);
  return draft;
}

function draftHasContent(draft) {
  return CONTENT_FIELDS.some(field => typeof draft[field] === 'string' && draft[field].trim());
}

function writeDraft(storage, userId, form) {
  const key = draftKey(userId);
  if (!key) return false;
  const draft = draftFromForm(form);
  try {
    if (!draftHasContent(draft)) { storage.removeStorageSync(key); return false; }
    storage.setStorageSync(key, JSON.stringify(draft));
    return true;
  } catch (_) { return false; }
}

function readDraft(storage, userId) {
  const key = draftKey(userId);
  if (!key) return null;
  try {
    const raw = storage.getStorageSync(key);
    if (!raw) return null;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || parsed.version !== DRAFT_VERSION) return null;
    const draft = draftFromForm(parsed);
    return draftHasContent(draft) ? draft : null;
  } catch (_) { return null; }
}

function clearDraft(storage, userId) {
  const key = draftKey(userId);
  if (!key) return;
  try { storage.removeStorageSync(key); } catch (_) {}
}

module.exports = { DRAFT_VERSION, draftKey, draftFromForm, draftHasContent, writeDraft, readDraft, clearDraft };
