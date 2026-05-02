import { type ArgumentsHost, Catch, type ExceptionFilter, NotFoundException } from '@nestjs/common';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * SPA fallback: любой GET-запрос, которого нет в Nest-роутах и не /api/* /
 * /health, → отдать index.html (Vite-build SPA). Это позволяет F5 на
 * /clusters / /proxy-hosts и т.п. без 404.
 *
 * Эту филтру регистрируем через app.useGlobalFilters() — Nest её зовёт
 * вместо стандартной 404, не трогая fastify.setNotFoundHandler (который
 * Nest уже установил, повторно его установить нельзя).
 */
@Catch(NotFoundException)
export class SpaFallbackFilter implements ExceptionFilter {
  private readonly indexPath = path.resolve(process.cwd(), 'public/index.html');
  private readonly indexExists = existsSync(this.indexPath);

  catch(_exception: NotFoundException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<{
      method: string;
      url: string;
      raw?: { url?: string };
    }>();
    const reply = ctx.getResponse<{
      status: (code: number) => { send: (body: unknown) => void };
      sendFile?: (filename: string) => unknown;
    }>();

    const url = req.url ?? req.raw?.url ?? '';

    // API + health + non-GET → стандартная 404 в JSON
    if (
      req.method !== 'GET' ||
      url.startsWith('/api/') ||
      url === '/api' ||
      url.startsWith('/health')
    ) {
      reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `Cannot ${req.method} ${url}`,
      });
      return;
    }

    // SPA fallback
    if (this.indexExists && reply.sendFile) {
      return reply.sendFile('index.html');
    }
    reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: 'SPA index.html not built',
    });
  }
}
