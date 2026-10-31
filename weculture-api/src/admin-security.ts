import { HttpException, HttpStatus } from '@nestjs/common';

export const DEMO_ADMIN_PASSWORD = 'Weculture@2026';

/** Per-process bounded protection; the public gateway also limits client traffic. */
export class AdminLoginLimiter {
  private readonly failures = new Map<string, { attempts: number; expiresAt: number }>();
  constructor(private readonly limit = 5, private readonly windowMs = 15 * 60_000, private readonly maxEntries = 1000) {}

  reserve(username: string) {
    const now = Date.now();
    for (const [key, value] of this.failures) if (value.expiresAt <= now) this.failures.delete(key);
    const key = username.toLocaleLowerCase();
    const previous = this.failures.get(key);
    if ((previous && previous.attempts >= this.limit) || (!previous && this.failures.size >= this.maxEntries)) throw new HttpException('登录尝试过多，请15分钟后重试', HttpStatus.TOO_MANY_REQUESTS);
    // Reserve before awaiting bcrypt so concurrent requests cannot bypass the cap.
    this.failures.set(key, { attempts: (previous?.attempts || 0) + 1, expiresAt: previous?.expiresAt || now + this.windowMs });
  }

  success(username: string) { this.failures.delete(username.toLocaleLowerCase()); }
}

export const validNewAdminPassword = (value: unknown): value is string => typeof value === 'string'
  && value.length >= 12 && Buffer.byteLength(value, 'utf8') <= 72
  && /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value) && /[^A-Za-z0-9\s]/.test(value)
  && !/[\u0000-\u001f\u007f]/.test(value) && value !== DEMO_ADMIN_PASSWORD;
