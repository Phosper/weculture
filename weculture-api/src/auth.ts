import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtPayload, verify, sign } from 'jsonwebtoken';

export type Session = { id: string; kind: 'user' | 'admin'; role?: string; schoolId?: string | null };
const secret = () => process.env.JWT_SECRET || 'weculture-local-development-secret';

export const createToken = (session: Session) => sign(session, secret(), { expiresIn: '8h' });
export const readToken = (token: string): Session => verify(token, secret()) as JwtPayload as Session;

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
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('请先登录');
    try { const session = readToken(token); if (session.kind !== 'admin') throw new Error(); request.admin = session; return true; }
    catch { throw new UnauthorizedException('管理员登录状态已失效'); }
  }
}
