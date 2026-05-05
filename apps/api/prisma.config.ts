import { defineConfig } from 'prisma/config';

/**
 * Prisma 7: connection URL ушёл из schema.prisma. CLI (`prisma migrate`,
 * `prisma db push`, `prisma studio`) читает его отсюда. Runtime PrismaClient
 * получает URL отдельно через адаптер @prisma/adapter-pg (см.
 * src/prisma/prisma.service.ts).
 *
 * .env здесь не подхватывается автоматически (в отличие от schema): в Docker
 * переменная приходит из compose, в dev — из реального окружения / .env
 * загружен Nest'ом раньше. Если запускать CLI локально без подгруженного
 * .env — нужно либо `dotenv -e .env -- pnpm prisma …`, либо экспортировать
 * DATABASE_URL руками.
 *
 * Пути — относительные, чтобы не зависеть от того, как esbuild Prisma CLI
 * trans-компилирует этот файл (CommonJS/ESM, __dirname наличие).
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
