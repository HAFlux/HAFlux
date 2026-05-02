# Docker compose

## Demo (single host)

```bash
cp deploy/docker/env.example deploy/docker/.env
./deploy/docker/scripts/init-secrets.sh
docker compose -f deploy/docker/compose.yml --env-file deploy/docker/.env up -d --build
```

UI: <http://localhost:8080>. OpenAPI docs: <http://localhost:3000/api/docs> (через api контейнер).

## Dev (hot-reload)

```bash
docker compose \
  -f deploy/docker/compose.yml \
  -f deploy/docker/compose.dev.yml \
  --env-file deploy/docker/.env up
```

Vite слушает 5173, API — 3000.

## Файлы

- `compose.yml` — продакшн/демо stack (api, web, db, redis, haproxy, agent).
- `compose.dev.yml` — override с монтированием исходников и hot-reload.
- `env.example` — шаблон переменных окружения.
- `scripts/init-secrets.sh` — генерация секретов в `.env` (идемпотентно).

## Multi-node инсталляции

`compose.yml` поднимает control-plane + одну ноду. Для нескольких нод:

1. Control-plane (api/web/db/redis) — на отдельной машине.
2. На каждой ноде HAProxy — отдельный compose только с сервисами `haproxy` и `agent`,
   `HAPILOT_API_URL` указывает на control-plane.
3. Токен агента создаётся в UI (Settings → Nodes → Add node).
