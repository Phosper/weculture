import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Injectable, NestInterceptor, CallHandler, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { map } from 'rxjs/operators';

export const ok = <T>(data: T, message = 'ok') => ({ code: 'OK', message, data });

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_: unknown, next: CallHandler) { const requestId = randomUUID(); return next.handle().pipe(map((data) => ({ ...(data?.code ? data : ok(data)), requestId }))); }
}

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const requestId = randomUUID();
    if (!(error instanceof HttpException)) {
      const failure = error as { name?: string; message?: string; driverError?: { code?: string; sqlMessage?: string } };
      Logger.error(JSON.stringify({
        requestId,
        name: failure?.name || 'UnknownError',
        message: failure?.driverError ? undefined : (failure?.message || String(error)).slice(0, 500),
        driverCode: failure?.driverError?.code,
        sqlMessage: failure?.driverError?.sqlMessage,
      }), undefined, ApiErrorFilter.name);
    }
    const exception = error instanceof HttpException ? error : new HttpException('服务暂时不可用', HttpStatus.INTERNAL_SERVER_ERROR);
    const raw = exception.getResponse();
    const message = typeof raw === 'string' ? raw : (raw as { message?: string | string[] }).message || '请求失败';
    response.status(exception.getStatus()).json({ code: `HTTP_${exception.getStatus()}`, message: Array.isArray(message) ? message[0] : message, requestId });
  }
}
