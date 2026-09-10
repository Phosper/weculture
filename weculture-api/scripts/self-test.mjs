const base = process.env.API_BASE_URL || 'http://127.0.0.1:3000/api/v1';
const request = async (path, method = 'GET', body, token) => {
  const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await response.json();
  if (!response.ok || json.code !== 'OK') throw new Error(`${method} ${path}: ${json.message || response.status}`);
  return json.data;
};
const assert = (condition, message) => { if (!condition) throw new Error(`FAILED: ${message}`); console.log(`PASS: ${message}`); };

try {
  await request('/health'); console.log('PASS: health endpoint');
  const login = await request('/auth/wechat/login', 'POST', { code: `automated-${Date.now()}` });
  const token = login.token;
  await request('/me', 'PATCH', { nickname: '自动化自测用户' }, token);
  let restricted = false;
  try { await request('/posts?scope=school', 'GET', undefined, token); } catch { restricted = true; }
  assert(restricted, 'unverified user cannot read school feed');
  const verified = await request('/me/school-verifications', 'POST', { code: 'BLCU2026' }, token);
  assert(verified.verified, 'invite code creates verified school membership');
  const submitted = await request('/posts', 'POST', { type: 'dynamic', title: `自动化审核 ${Date.now()}`, content: '用于验证待审核到发布的完整状态流转。', tag: '自动化测试' }, token);
  assert(submitted.status === 'pending', 'user publication enters pending review state');
  const beforeInvalidEvent = (await request('/me/posts', 'GET', undefined, token)).length;
  let invalidEventRejected = false;
  try { await request('/posts', 'POST', { type: 'event', title: '无效活动', content: '这条活动不应被写入。', location: '测试地点', startsAt: '2024-01-01T09:00', endsAt: '2024-01-01T10:00', registrationDeadline: '2023-12-31T10:00', capacity: 'abc' }, token); } catch { invalidEventRejected = true; }
  const afterInvalidEvent = (await request('/me/posts', 'GET', undefined, token)).length;
  assert(invalidEventRejected && beforeInvalidEvent === afterInvalidEvent, 'invalid event is rejected before any post is created');
  const admin = await request('/admin/auth/login', 'POST', { username: 'admin', password: 'Weculture@2026' });
  const pending = await request('/admin/posts?status=pending', 'GET', undefined, admin.token);
  assert(pending.some((post) => post.id === submitted.id), 'administrator can see pending content');
  await request(`/admin/posts/${submitted.id}/review`, 'POST', { status: 'approved' }, admin.token);
  const schoolFeed = await request('/posts?scope=school', 'GET', undefined, token);
  assert(schoolFeed.some((post) => post.id === submitted.id), 'approved content appears in school feed');
  const eventPost = schoolFeed.find((post) => post.type === 'event');
  const first = await request(`/events/${eventPost.event.id}/registrations`, 'POST', {}, token);
  const second = await request(`/events/${eventPost.event.id}/registrations`, 'POST', {}, token);
  assert(first.registered && second.registered, 'event registration is idempotent');
  const routes = await request('/travel-routes', 'GET', undefined, token);
  const planned = await request(`/travel-routes/${routes[0].id}/plans`, 'POST', {}, token);
  assert(planned.planned, 'route can be added to user plan');
  const assistant = await request('/assistant/messages', 'POST', { content: '怎么参加校园活动？' }, token);
  assert(Boolean(assistant.assistant?.content), 'assistant returns configured answer');
  const reviewer = await request('/admin/auth/login', 'POST', { username: 'blcu-reviewer', password: 'Weculture@2026' });
  let roleBlocked = false;
  try { await request('/admin/invites', 'POST', { batchName: 'should-not-work', maxUses: 1 }, reviewer.token); } catch { roleBlocked = true; }
  assert(roleBlocked, 'reviewer cannot manage invite codes');
  console.log('SELF TEST COMPLETED');
} catch (error) { console.error(error.message); process.exitCode = 1; }
