import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { JwtPayload, verify, sign } from 'jsonwebtoken';
import { Repository } from 'typeorm';
import { getJwtSecret } from './config';
import { AdminAccount } from './entities';
import { DbRetry } from './db-retry';

export type Session = { id: string; kind: 'user' | 'admin'; role?: string; schoolId?: string | null; authVersion?: string };
export const createToken = (session: Session) => sign(session, getJwtSecret(), { expiresIn: '8h' });
export const readToken = (token: string): Session => verify(token, getJwtSecret()) as JwtPayload as Session;
export const adminAuthVersion = (passwordHash: string) => createHmac('sha256', getJwtSecret()).update(passwordHash).digest('hex');

@Injectable()
export class UserGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('请先登录');
    try { const session = readToken(token); if (session.kind !== 'user') throw new Error(); request.user = session; return true; }
    catch { throw new UnauthorizedException('登录状态已失效'); }
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@InjectRepository(AdminAccount) private readonly admins: Repository<AdminAccount>) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('请先登录');
    let session: Session;
    try { session = readToken(token); if (session.kind !== 'admin' || typeof session.id !== 'string') throw new Error(); }
    catch { throw new UnauthorizedException('管理员登录状态已失效，请重新登录'); }
    const admin = await DbRetry.read(() => this.admins.findOneBy({ id: session.id }));
    if (!admin || admin.status !== 'active') throw new ForbiddenException('管理员账号不可用');
    const expected = adminAuthVersion(admin.passwordHash);
    if (typeof session.authVersion !== 'string' || !/^[a-f0-9]{64}$/.test(session.authVersion) || !timingSafeEqual(Buffer.from(session.authVersion, 'hex'), Buffer.from(expected, 'hex'))) throw new UnauthorizedException('管理员登录状态已失效，请重新登录');
    // Current database role and school always supersede the token's old claims.
    request.admin = { id: admin.id, kind: 'admin', role: admin.role, schoolId: admin.schoolId, authVersion: expected };
    return true;
  }
}
