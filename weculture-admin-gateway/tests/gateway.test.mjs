import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createAdminGateway, runtimeConfig } from '../server.mjs';

const POST_ID = '12345678-abcd-4abc-8def-1234567890ab';
const PRIVATE_ORIGIN = 'http://private-api.example.internal:3000/';
const AUTH = 'Bearer test-admin-token';
let temporaryRoot;
let publicDir;
let symlinkAvailable = false;

before(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'weculture-gateway-tests-'));
  publicDir = join(temporaryRoot, 'public');
  await mkdir(join(publicDir, 'assets'), { recursive: true });
  await mkdir(join(temporaryRoot, 'outside'));
  await Promise.all([
    writeFile(join(publicDir, 'index.html'), '<!doctype html><title>Admin test</title>'),
    writeFile(join(publicDir, 'assets', 'main-abcd.js'), 'console.log("test");'),
    writeFile(join(publicDir, 'assets', 'main-abcd.js.map'), '{"sources":["private.ts"]}'),
    writeFile(join(publicDir, '.env'), 'THIS_MUST_NOT_BE_SERVED=test'),
    writeFile(join(publicDir, 'private.json'), '{"secret":"test"}'),
    writeFile(join(temporaryRoot, 'outside.html'), '<title>Outside root</title>'),
    writeFile(join(temporaryRoot, 'outside', 'escaped.html'), '<title>Escaped symlink</title>'),
  ]);
  try {
    await symlink(join(temporaryRoot, 'outside'), join(publicDir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    symlinkAvailable = true;
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
  }
});

after(async () => {
  if (!temporaryRoot) return;
  const resolvedRoot = await realpath(temporaryRoot);
  const resolvedTemp = await realpath(tmpdir());
  const pathFromTemp = relative(resolvedTemp, resolvedRoot);
  assert.ok(!pathFromTemp.startsWith(`..${sep}`) && pathFromTemp !== '..', 'cleanup must stay in the system temporary directory');
  assert.ok(basename(resolvedRoot).startsWith('weculture-gateway-tests-'), 'cleanup must target this test fixture only');
  await rm(resolvedRoot, { recursive: true, force: true });
});

function upstreamJson(value = { ok: true }, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
}

async function gateway(t, responder = () => upstreamJson(), options = {}) {
  const calls = [];
  const server = createAdminGateway({
    upstreamBase: PRIVATE_ORIGIN,
    publicDir,
    ...options,
    fetchUpstream: async (url, requestOptions) => {
      const call = { url: new URL(url), ...requestOptions, headers: { ...requestOptions.headers } };
      calls.push(call);
      return responder(call);
    },
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  t.after(async () => {
    await new Promise(resolveClose => {
      server.close(resolveClose);
      server.closeAllConnections();
    });
  });
  return { calls, port: server.address().port, server };
}

function request(port, path, { method = 'GET', headers = {}, body, chunks } = {}) {
  return new Promise((resolveResponse, reject) => {
    const outgoing = httpRequest({ hostname: '127.0.0.1', port, path, method, headers, agent: false }, incoming => {
      const data = [];
      incoming.on('data', chunk => data.push(chunk));
      incoming.on('error', reject);
      incoming.on('end', () => resolveResponse({ status: incoming.statusCode, headers: incoming.headers, text: Buffer.concat(data).toString('utf8') }));
    });
    outgoing.setTimeout(5000, () => outgoing.destroy(new Error('local gateway request timed out')));
    outgoing.on('error', reject);
    if (chunks) {
      for (const chunk of chunks) outgoing.write(chunk);
      outgoing.end();
    } else {
      outgoing.end(body);
    }
  });
}

function jsonRequest(body = {}, authorization = AUTH) {
  const text = JSON.stringify(body);
  return { headers: { authorization, 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) }, body: text };
}

function assertSecurityHeaders(response, production = false) {
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-frame-options'], 'DENY');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
  assert.match(response.headers['permissions-policy'], /camera=\(\)/);
  assert.match(response.headers['permissions-policy'], /microphone=\(\)/);
  assert.match(response.headers['content-security-policy'], /default-src 'none'/);
  assert.match(response.headers['content-security-policy'], /connect-src 'self'/);
  assert.match(response.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(response.headers['access-control-allow-origin'], undefined);
  assert.equal(response.headers['set-cookie'], undefined);
  assert.equal(response.headers['strict-transport-security'], production ? 'max-age=31536000' : undefined);
}

test('runtime configuration requires a plain HTTP origin and a valid listener port', () => {
  assert.throws(() => runtimeConfig({}));
  for (const value of [
    'https://private.example.internal/',
    'file:///private',
    'http://user:password@private.example.internal/',
    'http://private.example.internal/api/v1/',
    'http://private.example.internal/?token=test',
    'http://private.example.internal/#token',
  ]) assert.throws(() => runtimeConfig({ API_UPSTREAM_URL: value }), value);
  for (const port of ['0', '-1', '65536', '3.5', 'not-a-port']) {
    assert.throws(() => runtimeConfig({ API_UPSTREAM_URL: PRIVATE_ORIGIN, PORT: port }), port);
  }
  const config = runtimeConfig({ API_UPSTREAM_URL: PRIVATE_ORIGIN, PORT: '8080', NODE_ENV: 'production' });
  assert.equal(config.upstreamBase, PRIVATE_ORIGIN);
  assert.equal(config.port, 8080);
  assert.equal(config.production, true);
  assert.equal(config.publicDir, resolve(config.publicDir));
  assert.equal(config.upstreamTimeoutMs, 50000);
  for (const timeout of ['5000', '50000', '55000']) {
    assert.equal(runtimeConfig({ API_UPSTREAM_URL: PRIVATE_ORIGIN, API_UPSTREAM_TIMEOUT_MS: timeout }).upstreamTimeoutMs, Number(timeout));
  }
  for (const timeout of ['', '4999', '55001', '5000.5', '-5000', 'NaN', 'Infinity', '50s', ' 5000 ', '5e3', null]) {
    assert.throws(() => runtimeConfig({ API_UPSTREAM_URL: PRIVATE_ORIGIN, API_UPSTREAM_TIMEOUT_MS: timeout }), /API_UPSTREAM_TIMEOUT_MS/);
    assert.throws(() => createAdminGateway({ upstreamBase: PRIVATE_ORIGIN, publicDir, upstreamTimeoutMs: timeout }), /API_UPSTREAM_TIMEOUT_MS/);
  }
});

test('default and configured upstream waits leave incoming request deadlines unchanged', async t => {
  const durations = [];
  t.mock.method(AbortSignal, 'timeout', duration => { durations.push(duration); return new AbortController().signal; });
  for (const timeout of [undefined, 5000, 55000]) {
    const fixture = await gateway(t, () => upstreamJson(), { upstreamTimeoutMs: timeout });
    const response = await request(fixture.port, '/api/v1/admin/auth/login', { ...jsonRequest(), method: 'POST' });
    assert.equal(response.status, 200);
    assert.equal(fixture.calls.length, 1);
    assert.equal(durations.at(-1), timeout ?? 50000);
    assert.equal(fixture.server.requestTimeout, 30000);
    assert.equal(fixture.server.headersTimeout, 10000);
    assert.equal(fixture.server.timeout, 0);
  }
});

test('an aborted upstream login returns a safe failure without retrying the POST', async t => {
  t.mock.method(AbortSignal, 'timeout', duration => {
    assert.equal(duration, 5000);
    const controller = new AbortController();
    queueMicrotask(() => controller.abort(new DOMException('upstream timeout detail', 'TimeoutError')));
    return controller.signal;
  });
  const fixture = await gateway(t, call => new Promise((resolveResponse, reject) => {
    call.signal.addEventListener('abort', () => reject(call.signal.reason), { once: true });
  }), { upstreamTimeoutMs: 5000 });
  const response = await request(fixture.port, '/api/v1/admin/auth/login', { ...jsonRequest(), method: 'POST' });
  assert.equal(response.status, 502);
  assert.equal(fixture.calls.length, 1);
  assert.equal(JSON.parse(response.text).message, '管理服务暂时不可用');
  assert.doesNotMatch(response.text, /timeout detail|TimeoutError/);
});

test('only the explicit management routes and HTTP methods reach the private API', async t => {
  const fixture = await gateway(t);
  const allowed = [
    ['POST', '/api/v1/admin/auth/login'],
    ['GET', '/api/v1/admin/me'],
    ['GET', '/api/v1/admin/dashboard'],
    ['GET', '/api/v1/admin/schools'],
    ['GET', '/api/v1/admin/posts'],
    ['POST', '/api/v1/admin/me/password'],
    ['POST', '/api/v1/admin/posts'],
    ['PATCH', `/api/v1/admin/posts/${POST_ID}`],
    ['POST', `/api/v1/admin/posts/${POST_ID}/review`],
    ['GET', `/api/v1/admin/posts/${POST_ID}/media`],
  ];
  for (const [method, path] of allowed) {
    const options = method === 'GET' ? { headers: { authorization: AUTH } } : jsonRequest();
    const response = await request(fixture.port, path, { ...options, method });
    assert.equal(response.status, 200, `${method} ${path}`);
  }
  assert.equal(fixture.calls.length, allowed.length);
  assert.deepEqual(fixture.calls.map(call => [call.method, call.url.pathname]), allowed);
});

test('mini program routes, admin account management, malformed IDs and method overrides stay private', async t => {
  const fixture = await gateway(t);
  const rejected = [
    ['POST', '/api/v1/auth/wechat/login'],
    ['GET', '/api/v1/posts'],
    ['GET', '/api/v1/me'],
    ['GET', '/api/v1/admin/admin-users'],
    ['POST', '/api/v1/admin/users'],
    ['DELETE', `/api/v1/admin/posts/${POST_ID}`],
    ['POST', `/api/v1/admin/posts/${POST_ID}/media`],
    ['PATCH', '/api/v1/admin/posts/not-a-post'],
    ['GET', `/api/v1/admin/posts/${POST_ID}/extra/media`],
    ['POST', '/api/v1/admin/auth/login/'],
    ['POST', '/api/v1/admin%2fauth%2flogin'],
    ['HEAD', '/api/v1/admin/posts'],
    ['OPTIONS', '/api/v1/admin/posts'],
  ];
  for (const [method, path] of rejected) {
    const response = await request(fixture.port, path, { ...jsonRequest(), method, headers: { ...jsonRequest().headers, 'x-http-method-override': 'GET' } });
    assert.equal(response.status, 404, `${method} ${path}`);
  }
  assert.equal(fixture.calls.length, 0);
});

test('management endpoints require a bounded bearer header before forwarding', async t => {
  const fixture = await gateway(t);
  for (const authorization of [undefined, '', 'Basic test', 'Bearer', 'Bearer ', 'Bearer a Bearer b', `Bearer ${'x'.repeat(8193)}`]) {
    const headers = authorization === undefined ? {} : { authorization };
    const response = await request(fixture.port, '/api/v1/admin/posts', { headers });
    assert.equal(response.status, 401, authorization ? authorization.slice(0, 40) : 'missing bearer');
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  assert.equal(fixture.calls.length, 0);
  assert.equal((await request(fixture.port, '/api/v1/admin/me', { headers: { authorization: 'bearer test-token' } })).status, 200);
});

test('untrusted WeChat identity, cookies and routing headers are never forwarded', async t => {
  const fixture = await gateway(t, () => upstreamJson({ pending: true }, 200, {
    'set-cookie': 'upstream-session=must-not-leak',
    'x-wx-openid': 'must-not-leak',
    'access-control-allow-origin': '*',
  }));
  const response = await request(fixture.port, `/api/v1/admin/posts/${POST_ID}/review?reason=a%20b`, {
    method: 'POST',
    ...jsonRequest({ status: 'rejected' }),
    headers: {
      ...jsonRequest({ status: 'rejected' }).headers,
      host: 'attacker.example',
      'X-WX-OPENID': 'forged-user',
      'x-wx-source': 'wx_client',
      'x-wx-appid': 'forged-app',
      'x-wx-env': 'foreign-env',
      'x-wx-from-openid': 'forged-owner',
      cookie: 'admin_session=forged',
      forwarded: 'for=127.0.0.1;host=attacker.example;proto=https',
      'x-forwarded-for': '127.0.0.1',
      'x-forwarded-host': 'attacker.example',
      'x-forwarded-proto': 'https',
      'x-original-forwarded-for': '127.0.0.1',
      'x-http-method-override': 'DELETE',
    },
  });
  assert.equal(response.status, 200);
  assert.equal(fixture.calls.length, 1);
  const [call] = fixture.calls;
  assert.equal(call.url.origin, new URL(PRIVATE_ORIGIN).origin);
  assert.equal(call.url.search, '?reason=a%20b');
  assert.equal(call.method, 'POST');
  assert.equal(call.redirect, 'manual');
  assert.ok(call.signal instanceof AbortSignal);
  assert.deepEqual(call.headers, { accept: 'application/json', authorization: AUTH, 'content-type': 'application/json' });
  assert.equal(Buffer.from(call.body).toString('utf8'), JSON.stringify({ status: 'rejected' }));
  assertSecurityHeaders(response);
  assert.equal(response.headers['x-wx-openid'], undefined);
});

test('login does not forward an unsolicited bearer token or WeChat headers', async t => {
  const fixture = await gateway(t);
  const response = await request(fixture.port, '/api/v1/admin/auth/login', {
    ...jsonRequest({ username: 'test', password: 'test-only' }),
    method: 'POST',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(fixture.calls[0].headers, { accept: 'application/json', 'content-type': 'application/json' });
});

test('mutations reject content types that are not JSON before reaching upstream', async t => {
  const fixture = await gateway(t);
  for (const contentType of [undefined, 'text/plain', 'application/x-www-form-urlencoded', 'application/jsonp', 'text/html; profile="application/json"']) {
    const headers = { authorization: AUTH };
    if (contentType) headers['content-type'] = contentType;
    const response = await request(fixture.port, '/api/v1/admin/posts', { method: 'POST', headers, body: '{}' });
    assert.equal(response.status, 415, contentType || 'missing content type');
  }
  assert.equal(fixture.calls.length, 0);
  assert.equal((await request(fixture.port, '/api/v1/admin/posts', {
    method: 'POST', headers: { authorization: AUTH, 'content-type': 'Application/JSON; charset=utf-8' }, body: '{}',
  })).status, 200);
});

test('mutations require a valid JSON object rather than scalars, arrays or malformed data', async t => {
  const fixture = await gateway(t);
  for (const body of ['', '{invalid}', 'null', '[]', '"text"', '42', 'true']) {
    const response = await request(fixture.port, '/api/v1/admin/posts', {
      method: 'POST', headers: { authorization: AUTH, 'content-type': 'application/json' }, body,
    });
    assert.equal(response.status, 400, body || 'empty body');
  }
  assert.equal(fixture.calls.length, 0);
});

test('JSON body size is measured in bytes and the 64 KB boundary is exact', async t => {
  const fixture = await gateway(t);
  const atLimit = JSON.stringify({ text: 'a'.repeat(65525) });
  assert.equal(Buffer.byteLength(atLimit), 65536);
  assert.equal((await request(fixture.port, '/api/v1/admin/posts', {
    method: 'POST', headers: { authorization: AUTH, 'content-type': 'application/json', 'content-length': 65536 }, body: atLimit,
  })).status, 200);
  for (const body of [JSON.stringify({ text: 'a'.repeat(65526) }), JSON.stringify({ text: '一'.repeat(22000) })]) {
    const response = await request(fixture.port, '/api/v1/admin/posts', {
      method: 'POST', headers: { authorization: AUTH, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, body,
    });
    assert.equal(response.status, 413);
  }
  assert.equal(fixture.calls.length, 1);
});

test('chunked bodies cannot bypass 64 KB and receive a readable 413 response', async t => {
  const fixture = await gateway(t);
  const response = await request(fixture.port, '/api/v1/admin/posts', {
    method: 'POST',
    headers: { authorization: AUTH, 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
    chunks: ['{"text":"', 'a'.repeat(40000), 'b'.repeat(40000), '"}'],
  });
  assert.equal(response.status, 413);
  assert.equal(JSON.parse(response.text).code, 'HTTP_413');
  assert.equal(fixture.calls.length, 0);
});

test('upstream redirects are returned as 502 instead of followed or exposed', async t => {
  for (const status of [301, 302, 307, 308]) {
    const fixture = await gateway(t, () => new Response('{}', { status, headers: { 'content-type': 'application/json', location: 'https://attacker.example/' } }));
    const response = await request(fixture.port, '/api/v1/admin/me', { headers: { authorization: AUTH } });
    assert.equal(response.status, 502, String(status));
    assert.equal(response.headers.location, undefined);
    assert.equal(fixture.calls[0].redirect, 'manual');
  }
});

test('upstream responses must have an actual JSON media type', async t => {
  for (const contentType of ['text/html', 'application/jsonp', 'text/html; profile="application/json"', 'application/json-patch+json']) {
    const fixture = await gateway(t, () => new Response('{}', { headers: { 'content-type': contentType } }));
    const response = await request(fixture.port, '/api/v1/admin/me', { headers: { authorization: AUTH } });
    assert.equal(response.status, 502, contentType);
  }
  const fixture = await gateway(t, () => new Response('{"ok":true}', { headers: { 'content-type': 'Application/JSON; charset=utf-8' } }));
  assert.equal((await request(fixture.port, '/api/v1/admin/me', { headers: { authorization: AUTH } })).status, 200);
});

test('upstream HTML disguised as JSON fails closed', async t => {
  const fixture = await gateway(t, () => new Response('<!doctype html><script>bad()</script>', { headers: { 'content-type': 'application/json' } }));
  const response = await request(fixture.port, '/api/v1/admin/me', { headers: { authorization: AUTH } });
  assert.equal(response.status, 502);
  assert.equal(JSON.parse(response.text).code, 'HTTP_502');
  assert.doesNotMatch(response.text, /script|doctype/);
});

test('upstream JSON is bounded at 2 MB even without a content-length header', async t => {
  const limit = 2 * 1024 * 1024;
  const exactBody = JSON.stringify({ text: 'a'.repeat(limit - 11) });
  assert.equal(Buffer.byteLength(exactBody), limit);
  const accepted = await gateway(t, () => new Response(exactBody, { headers: { 'content-type': 'application/json' } }));
  const acceptedResponse = await request(accepted.port, '/api/v1/admin/me', { headers: { authorization: AUTH } });
  assert.equal(acceptedResponse.status, 200);
  assert.equal(Buffer.byteLength(acceptedResponse.text), limit);

  let cancelled = false;
  const rejected = await gateway(t, () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.from('{"text":"'));
      controller.enqueue(Buffer.alloc(1024 * 1024, 97));
      controller.enqueue(Buffer.alloc(1024 * 1024, 97));
      controller.enqueue(Buffer.from('"}'));
    },
    cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'application/json' } }));
  const rejectedResponse = await request(rejected.port, '/api/v1/admin/me', { headers: { authorization: AUTH } });
  assert.equal(rejectedResponse.status, 502);
  assert.equal(JSON.parse(rejectedResponse.text).code, 'HTTP_502');
  assert.equal(cancelled, true, 'oversized upstream streams must be cancelled');
  assertSecurityHeaders(rejectedResponse);
});

test('JSON authorization and moderation errors retain their upstream status', async t => {
  for (const status of [400, 401, 403, 404, 409, 429]) {
    const fixture = await gateway(t, () => upstreamJson({ message: 'test validation failure', code: 'TEST_CODE' }, status));
    const response = await request(fixture.port, '/api/v1/admin/posts', { headers: { authorization: AUTH } });
    assert.equal(response.status, status);
    assert.deepEqual(JSON.parse(response.text), { message: 'test validation failure', code: 'TEST_CODE' });
    assert.equal(response.headers['cache-control'], 'no-store');
  }
});

test('network failures do not expose internal server details', async t => {
  const fixture = await gateway(t, () => { throw new Error('secret=private-database-password internal-api.example'); });
  const response = await request(fixture.port, '/api/v1/admin/me', { headers: { authorization: AUTH } });
  assert.equal(response.status, 502);
  assert.doesNotMatch(response.text, /secret|password|internal-api/);
  assertSecurityHeaders(response);
});

test('health and admin entry points do not forward requests', async t => {
  const fixture = await gateway(t, () => { throw new Error('health must be local'); });
  const health = await request(fixture.port, '/health');
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.text), { service: 'weculture-admin-gateway', status: 'healthy' });
  for (const path of ['/', '/admin']) {
    const response = await request(fixture.port, path);
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/admin/');
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  assert.equal(fixture.calls.length, 0);
});

test('admin assets have correct content types, caching and body-free HEAD', async t => {
  const fixture = await gateway(t);
  const index = await request(fixture.port, '/admin/');
  assert.equal(index.status, 200);
  assert.match(index.headers['content-type'], /^text\/html/);
  assert.equal(index.headers['cache-control'], 'no-cache');
  assert.match(index.text, /Admin test/);
  const asset = await request(fixture.port, '/admin/assets/main-abcd.js');
  assert.equal(asset.status, 200);
  assert.match(asset.headers['content-type'], /^text\/javascript/);
  assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable');
  const head = await request(fixture.port, '/admin/assets/main-abcd.js', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.text, '');
  assert.equal(head.headers['content-length'], asset.headers['content-length']);
  assert.equal(fixture.calls.length, 0);
});

test('ordinary missing resources and undeclared files return 404 without an HTML fallback', async t => {
  const fixture = await gateway(t);
  for (const path of ['/missing.js', '/admin/missing.js', '/admin/missing-route', '/admin/.env', '/admin/private.json', '/admin/assets/main-abcd.js.map']) {
    const response = await request(fixture.port, path);
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(response.text, /Admin test|MUST_NOT_BE_SERVED|private\.ts/);
    assertSecurityHeaders(response);
  }
  assert.equal((await request(fixture.port, '/admin/', { method: 'POST', body: '{}' })).status, 404);
  assert.equal(fixture.calls.length, 0);
});

test('encoded traversal, absolute paths, backslashes and null bytes cannot escape static root', async t => {
  const fixture = await gateway(t);
  for (const path of [
    '/admin/../outside.html',
    '/admin/%2e%2e%2foutside.html',
    '/admin/%2e%2e%5coutside.html',
    '/admin/%252e%252e%252foutside.html',
    '/admin/%2foutside.html',
    '/admin/%00index.html',
    '/admin/%zz',
    '/admin/assets/',
  ]) {
    const response = await request(fixture.port, path);
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(response.text, /Outside root/);
  }
  assert.equal(fixture.calls.length, 0);
});

test('realpath prevents directory symlinks or junctions from escaping static root', async t => {
  if (!symlinkAvailable) { t.skip('operating system did not permit the temporary directory symlink fixture'); return; }
  const fixture = await gateway(t);
  const response = await request(fixture.port, '/admin/linked/escaped.html');
  assert.equal(response.status, 404);
  assert.doesNotMatch(response.text, /Escaped symlink/);
});

test('production security headers apply to static, JSON, redirect and denied responses', async t => {
  const fixture = await gateway(t, () => upstreamJson(), { production: true });
  for (const path of ['/admin/', '/health', '/', '/api/v1/admin/posts', '/missing']) {
    assertSecurityHeaders(await request(fixture.port, path), true);
  }
});
