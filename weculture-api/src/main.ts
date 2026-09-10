import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ApiErrorFilter, ResponseInterceptor } from './common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: { origin: true } });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new ApiErrorFilter());
  await app.listen(Number(process.env.PORT || 3000));
}
bootstrap();
