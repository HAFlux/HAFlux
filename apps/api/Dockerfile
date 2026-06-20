## ─── Builder ─────────────────────────────────────────────────────────────
FROM node:26-alpine AS builder
WORKDIR /repo

# Тег релиза (например v0.1.0) пробрасывается release.yml через --build-arg
# и попадает в Vite-build SPA как import.meta.env.VITE_APP_VERSION.
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=${APP_VERSION}

RUN corepack enable && corepack prepare pnpm@10.33.3 --activate

# Lockfile + manifests — отдельный слой: при смене только исходников кэш store не инвалидируется.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json biome.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Скачиваем артефакты в pnpm store (без node_modules) — быстрее повторные сборки в CI.
RUN pnpm fetch

# Sources
COPY packages/contracts ./packages/contracts
COPY apps/api ./apps/api
COPY apps/web ./apps/web

# Линковка из store (строго по lockfile — предсказуемые образы).
RUN pnpm install --frozen-lockfile --prefer-offline

# Build: contracts → web (Vite SPA) → prisma generate → api (Nest)
# pnpm 10 disabled the legacy deploy by default (ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE).
# Полный переход на injected workspace-deps потребует переписать workspace-ссылки;
# `--legacy` сохраняет прежнее поведение и работает с нашими `workspace:*` ссылками.
RUN pnpm --filter @haflux/contracts build \
 && pnpm --filter @haflux/web build \
 && pnpm --filter @haflux/api exec prisma generate \
 && pnpm --filter @haflux/api build \
 && pnpm --filter @haflux/api deploy --legacy --prod /out

## ─── Runtime ─────────────────────────────────────────────────────────────
FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# openssl/libstdc++ — prisma engine + argon2 native
# docker-cli      — reload локального haproxy через docker kill
# openssh-client  — SSH-транспорт на удалённые ноды
# socat           — master CLI socket reload
RUN apk add --no-cache openssl libstdc++ docker-cli openssh-client socat

COPY --from=builder /out ./
COPY --from=builder /repo/apps/api/prisma ./prisma
# Prisma 7: prisma.config.ts держит DATABASE_URL для CLI (db push / migrate)
# и обязан лежать рядом с `prisma generate` запуском.
COPY --from=builder /repo/apps/api/prisma.config.ts ./prisma.config.ts
COPY --from=builder /repo/apps/api/dist ./dist
# Vite-build SPA отдаём из /app/public — main.ts регистрирует @fastify/static
COPY --from=builder /repo/apps/web/dist ./public

# pnpm deploy --prod пересобрал node_modules и не унёс .prisma/client.
# Регенерим клиент уже в runtime — schema лежит рядом в ./prisma.
RUN ./node_modules/.bin/prisma generate

EXPOSE 3000

CMD ["sh", "-c", "./node_modules/.bin/prisma db push --accept-data-loss && node dist/main.js"]
