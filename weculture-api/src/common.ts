import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Injectable, NestInterceptor, CallHandler, Logger, ExecutionContext } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { defer, retry, timer } from 'rxjs';
import { map } from 'rxjs/operators';

export const ok = <T>(data: T, message = 'ok') => ({ code: 'OK', message, data });

@Injectable()
export class RetryTransientReadInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.switchToHttp().getRequest().method !== 'GET') return next.handle();
    return defer(() => next.handle()).pipe(retry({
      count: 1,
      delay: (error: unknown) => {
        const failure = error as { code?: string; driverError?: { code?: string } };
        const code = failure?.driverError?.code || failure?.code;
        if (code !== 'ECONNRESET' && code !== 'PROTOCOL_CONNECTION_LOST') throw error;
        Logger.warn(`Retrying GET after transient database disconnect (${code})`, RetryTransientReadInterceptor.name);
        return timer(200);
      },
    }));
  }
}

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
