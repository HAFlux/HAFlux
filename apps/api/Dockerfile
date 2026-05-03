## ─── Builder ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

# Тег релиза (например v0.1.0) пробрасывается release.yml через --build-arg
# и попадает в Vite-build SPA как import.meta.env.VITE_APP_VERSION.
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=${APP_VERSION}

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Lockfile + manifests всех пакетов воркспейса (включая web)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json biome.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Один общий install для api+web+contracts (workspace links)
RUN pnpm install --frozen-lockfile=false

# Sources
COPY packages/contracts ./packages/contracts
COPY apps/api ./apps/api
COPY apps/web ./apps/web

# Build: contracts → web (Vite SPA) → prisma generate → api (Nest)
RUN pnpm --filter @haflux/contracts build \
 && pnpm --filter @haflux/web build \
 && pnpm --filter @haflux/api exec prisma generate \
 && pnpm --filter @haflux/api build \
 && pnpm --filter @haflux/api deploy --prod /out

## ─── Runtime ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# openssl/libstdc++ — prisma engine + argon2 native
# docker-cli      — reload локального haproxy через docker kill
# openssh-client  — SSH-транспорт на удалённые ноды
# socat           — master CLI socket reload
RUN apk add --no-cache openssl libstdc++ docker-cli openssh-client socat

COPY --from=builder /out ./
COPY --from=builder /repo/apps/api/prisma ./prisma
COPY --from=builder /repo/apps/api/dist ./dist
# Vite-build SPA отдаём из /app/public — main.ts регистрирует @fastify/static
COPY --from=builder /repo/apps/web/dist ./public

# pnpm deploy --prod пересобрал node_modules и не унёс .prisma/client.
# Регенерим клиент уже в runtime — schema лежит рядом в ./prisma.
RUN ./node_modules/.bin/prisma generate

EXPOSE 3000

CMD ["sh", "-c", "./node_modules/.bin/prisma db push --skip-generate --accept-data-loss && node dist/main.js"]
