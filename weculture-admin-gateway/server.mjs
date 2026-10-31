import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const postId = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const routes = [
  ['POST', /^\/api\/v1\/admin\/auth\/login$/],
  ['GET', /^\/api\/v1\/admin\/(me|dashboard|schools|posts)$/],
  ['POST', /^\/api\/v1\/admin\/me\/password$/],
  ['POST', /^\/api\/v1\/admin\/posts$/],
  ['PATCH', new RegExp(`^/api/v1/admin/posts/${postId}$`, 'i')],
  ['POST', new RegExp(`^/api/v1/admin/posts/${postId}/review$`, 'i')],
  ['GET', new RegExp(`^/api/v1/admin/posts/${postId}/media$`, 'i')],
];
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.webp': 'image/webp',
};

function secureHeaders(response, production) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'");
  if (production) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

function json(response, status, message) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify({ code: `HTTP_${status}`, message }));
}

function requestBody(request, maxBytes) {
  return new Promise((resolveBody, rejectBody) => {
    let bytes = 0;
    let finished = false;
    const chunks = [];
    // Keep draining after rejection so an oversized chunked upload receives
    // the JSON 413 response instead of a connection reset.
    request.on('data', (chunk) => {
      if (finished) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        finished = true;
        chunks.length = 0;
        rejectBody(new Error('BODY_TOO_LARGE'));
      } else chunks.push(chunk);
    });
    request.once('end', () => {
      if (!finished) { finished = true; resolveBody(Buffer.concat(chunks)); }
    });
    const fail = () => { if (!finished) { finished = true; rejectBody(new Error('BODY_INTERRUPTED')); } };
    request.once('error', fail);
    request.once('aborted', fail);
  });
}

async function upstreamJson(result) {
  if (!/^application\/json(?:\s*;|$)/i.test(result.headers.get('content-type') || '')) throw new Error('UPSTREAM_INVALID');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of result.body || []) {
    bytes += chunk.length;
    if (bytes > 2097152) throw new Error('UPSTREAM_TOO_LARGE');
    chunks.push(chunk);
  }
  const content = Buffer.concat(chunks).toString('utf8');
  JSON.parse(content);
  return content;
}

function parseUpstreamTimeout(value) {
  const timeoutMs = value === undefined ? 50000 :
    (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) ? Number(value) : NaN;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5000 || timeoutMs > 55000) {
    throw new Error('API_UPSTREAM_TIMEOUT_MS 必须是 5000 到 55000 的整数毫秒');
  }
  return timeoutMs;
}

export function runtimeConfig(env = process.env) {
  const upstreamBase = env.API_UPSTREAM_URL;
  if (!upstreamBase) throw new Error('需要配置现有 API 的内网访问地址 API_UPSTREAM_URL');
  const upstream = new URL(upstreamBase);
  if (upstream.protocol !== 'http:' || upstream.username || upstream.password || upstream.search || upstream.hash || upstream.pathname !== '/') {
    throw new Error('API_UPSTREAM_URL 必须是无凭证、无路径的 HTTP 内网服务地址');
  }
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 无效');
  const upstreamTimeoutMs = parseUpstreamTimeout(env.API_UPSTREAM_TIMEOUT_MS);
  return { upstreamBase: upstream.href, port, upstreamTimeoutMs, production: env.NODE_ENV === 'production', publicDir: resolve(projectRoot, 'public') };
}

export function createAdminGateway({ upstreamBase, publicDir, production = false, upstreamTimeoutMs = 50000, fetchUpstream = fetch }) {
  const upstream = new URL(upstreamBase);
  const timeoutMs = parseUpstreamTimeout(upstreamTimeoutMs);
  const staticRoot = resolve(publicDir);
  const server = createServer(async (request, response) => {
    secureHeaders(response, production);
    try {
      const url = new URL(request.url || '/', 'http://localhost');
      const pathname = url.pathname;
      if (request.method === 'GET' && pathname === '/health') {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ service: 'weculture-admin-gateway', status: 'healthy' }));
        return;
      }
      if (pathname.startsWith('/api/')) {
        if (!routes.some(([method, pattern]) => method === request.method && pattern.test(pathname))) {
          json(response, 404, '接口不存在');
          return;
        }
        const isLogin = pathname === '/api/v1/admin/auth/login';
        const authorization = request.headers.authorization;
        if (!isLogin && (typeof authorization !== 'string' || !/^Bearer\s+\S{1,8192}$/i.test(authorization))) {
          json(response, 401, '请先登录运营后台');
          return;
        }
        let body;
        if (request.method !== 'GET') {
          if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
            json(response, 415, '请使用 JSON 请求');
            return;
          }
          const length = Number(request.headers['content-length'] || 0);
          if (length > 65536) { json(response, 413, '请求内容过长'); return; }
          body = await requestBody(request, 65536);
          let payload;
          try { payload = JSON.parse(body.toString('utf8')); } catch { json(response, 400, '请求内容无效'); return; }
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) { json(response, 400, '请求内容无效'); return; }
        }
        // Forward only the management request's bearer token and JSON metadata.
        // Client-supplied WeChat identity headers, cookies and forwarding headers
        // never reach the private mini program API.
        const headers = { accept: 'application/json' };
        if (authorization && !isLogin) headers.authorization = authorization;
        if (body) headers['content-type'] = 'application/json';
        const result = await fetchUpstream(new URL(pathname + url.search, upstream), {
          method: request.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
        });
        if (result.status >= 300 && result.status < 400) { json(response, 502, '管理服务暂时不可用'); return; }
        const content = await upstreamJson(result);
        response.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(content);
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method || '')) { json(response, 404, '页面不存在'); return; }
      if (pathname === '/' || pathname === '/admin') {
        response.writeHead(302, { Location: '/admin/', 'Cache-Control': 'no-store' });
        response.end();
        return;
      }
      if (!pathname.startsWith('/admin/')) { json(response, 404, '页面不存在'); return; }
      let filePath;
      try {
        const requested = decodeURIComponent(pathname.slice('/admin/'.length)) || 'index.html';
        if (requested.includes('\0') || requested.includes('\\')) { json(response, 404, '页面不存在'); return; }
        filePath = await realpath(resolve(staticRoot, requested));
        const pathFromRoot = relative(await realpath(staticRoot), filePath);
        if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot) || !(await stat(filePath)).isFile() || !contentTypes[extname(filePath)]) {
          json(response, 404, '页面不存在'); return;
        }
      } catch { json(response, 404, '页面不存在'); return; }
      const bytes = await readFile(filePath);
      const hashedAsset = pathname.startsWith('/admin/assets/');
      response.writeHead(200, {
        'Content-Type': contentTypes[extname(filePath)], 'Content-Length': bytes.length,
        'Cache-Control': hashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (!response.headersSent) json(response, error?.message === 'BODY_TOO_LARGE' ? 413 : 502, error?.message === 'BODY_TOO_LARGE' ? '请求内容过长' : '管理服务暂时不可用');
      else response.end();
    }
  });
  // These deadlines cover receiving the request, not the upstream response wait.
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 40;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = runtimeConfig();
  createAdminGateway(config).listen(config.port, () => {
    console.log(`Weculture admin gateway ready on port ${config.port}`);
  });
}
