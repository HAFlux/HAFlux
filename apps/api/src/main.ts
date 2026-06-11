import 'reflect-metadata';
import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { SpaFallbackFilter } from './spa.filter';

async function bootstrap() {
  // trustProxy: доверяем X-Forwarded-* только от нашего фронтового HAProxy.
  // `true` означало бы доверие любому клиентскому X-Forwarded-For — тогда
  // brute-force throttle по IP обходится подменой заголовка. По умолчанию
  // HAProxy ходит на api с loopback; список можно расширить через TRUSTED_PROXIES.
  const trustProxy = process.env.TRUSTED_PROXIES?.trim()
    ? process.env.TRUSTED_PROXIES.split(',').map((s) => s.trim())
    : ['127.0.0.1/8', '::1/128'];
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy, bodyLimit: 100 * 1024 * 1024 }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  // ─── Раздаём собранный SPA ─────────────────────────────────────────
  // Vite-build веба копируется в /app/public (см. apps/api/Dockerfile).
  const staticDir = path.resolve(process.cwd(), 'public');
  if (existsSync(staticDir)) {
    const fastify = app.getHttpAdapter().getInstance() as unknown as {
      register: (plugin: unknown, opts: unknown) => Promise<void>;
    };

    await fastify.register(
      fastifyStatic as unknown as never,
      {
        root: staticDir,
        prefix: '/',
        decorateReply: true,
        wildcard: false,
        cacheControl: true,
        maxAge: '1h',
      } as never,
    );
  }

  // SPA fallback через ExceptionFilter (потому что fastify.setNotFoundHandler
  // уже установлен Nest'ом и повторно вызвать его нельзя).
  app.useGlobalFilters(new SpaFallbackFilter());

  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });

  const logger = new Logger('Bootstrap');
  logger.log(`HAFlux API listening on http://0.0.0.0:${port}`);
  if (existsSync(staticDir)) {
    logger.log(`Serving SPA from ${staticDir}`);
  }
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
