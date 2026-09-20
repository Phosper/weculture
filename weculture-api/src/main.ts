import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ApiErrorFilter, ResponseInterceptor, RetryTransientReadInterceptor } from './common';
import { corsOrigins, validateRuntimeConfig } from './config';

async function bootstrap() {
  validateRuntimeConfig();
  const app = await NestFactory.create(AppModule, { cors: { origin: corsOrigins() } });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalInterceptors(new RetryTransientReadInterceptor(), new ResponseInterceptor());
  app.useGlobalFilters(new ApiErrorFilter());
  await app.listen(Number(process.env.PORT || 3000));
}
bootstrap();
