import { NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { isIP } from 'node:net';

const DOWNLOAD_ENDPOINT = 'http://api.weixin.qq.com/tcb/batchdownloadfile';
const EXPIRES_IN = 600;

function safeHttpsUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 8192 || !value.startsWith('https://') || /[\\\u0000-\u0020\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash
      && !isIP(host) && host.includes('.') && !host.endsWith('.')
      && !['localhost', 'localhost.localdomain'].includes(host) && !host.endsWith('.localhost')
      && !host.endsWith('.local') && !host.endsWith('.internal') && (!url.port || url.port === '443');
  } catch { return false; }
}

/** Receives only the image field from an already authorized database post. */
export async function previewStoredImage(imageUrl: string) {
  if (!imageUrl) throw new NotFoundException('此投稿没有图片');
  if (safeHttpsUrl(imageUrl)) return { url: imageUrl, expiresIn: null, expiresAt: null };
  if (!imageUrl.startsWith('cloud://')) throw new UnprocessableEntityException('此图片地址不支持安全预览，请使用 HTTPS 或已接通的云存储图片');
  const env = process.env.CLOUD_STORAGE_ENV?.trim();
  if (!env || !/^[a-zA-Z0-9-]{1,100}$/.test(env)) throw new ServiceUnavailableException('云存储图片预览尚未配置');
  const suffix = imageUrl.slice('cloud://'.length);
  const slash = suffix.indexOf('/');
  const authority = suffix.slice(0, slash);
  const path = suffix.slice(slash + 1);
  const filename = path.slice('weculture/posts/'.length);
  if (slash < 1 || !authority.startsWith(`${env}.`) || !/^[a-zA-Z0-9-]{1,100}$/.test(authority.slice(env.length + 1))
    || !path.startsWith('weculture/posts/') || !/^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,254}$/.test(filename) || filename.includes('..')) {
    throw new UnprocessableEntityException('此图片不属于允许的投稿存储范围');
  }
  if (process.env.CLOUD_STORAGE_PROXY_ENABLED !== 'true') throw new ServiceUnavailableException('云存储图片预览尚未接通');
  try {
    // The fixed HTTP endpoint is intercepted by the Cloud Run sidecar. Never
    // accept an endpoint or file ID supplied by the browser, and never retry
    // with a credential or a guessed permanent download domain.
    const response = await fetch(DOWNLOAD_ENDPOINT, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ env, file_list: [{ fileid: imageUrl, max_age: EXPIRES_IN }] }),
    });
    if (!response.ok) throw new Error();
    const body = await response.text();
    if (body.length > 65_536) throw new Error();
    const result = JSON.parse(body);
    const file = result?.file_list?.[0];
    if (result?.errcode !== 0 || !Array.isArray(result.file_list) || result.file_list.length !== 1
      || file?.fileid !== imageUrl || file?.status !== 0 || !safeHttpsUrl(file?.download_url)) throw new Error();
    return { url: file.download_url as string, expiresIn: EXPIRES_IN, expiresAt: new Date(Date.now() + EXPIRES_IN * 1000).toISOString() };
  } catch {
    // Do not include upstream errmsg, file IDs, secrets, or signed URLs.
    throw new ServiceUnavailableException('云存储图片预览暂时不可用，请稍后重试或联系管理员核对服务权限');
  }
}
