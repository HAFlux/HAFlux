# Docker compose

## Quickstart (single host, prebuilt image)

По умолчанию api тянется готовым из `ghcr.io/haflux/api:latest`. Локальная сборка не нужна.

```bash
cp deploy/docker/env.example deploy/docker/.env
./deploy/docker/scripts/init-secrets.sh
docker compose -f deploy/docker/compose.yml --env-file deploy/docker/.env up -d
```

UI: <http://localhost:8080>. OpenAPI docs: <http://localhost:3000/api/docs>.

Чтобы зафиксировать конкретный релиз — выставите `HAFLUX_API_TAG=v0.1.0` в `.env`
(или `HAFLUX_API_IMAGE=registry.example.com/haflux/api:custom` для приватного registry).

## Build from source

```bash
docker compose -f deploy/docker/compose.yml --env-file deploy/docker/.env up -d --build
```

## Dev (hot-reload)

```bash
docker compose \
  -f deploy/docker/compose.yml \
  -f deploy/docker/compose.dev.yml \
  --env-file deploy/docker/.env up
```

Vite слушает 5173, API — 3000.

## Файлы

- `compose.yml` — production/demo stack (api, db, redis, haproxy).
- `compose.dev.yml` — override с монтированием исходников и hot-reload.
- `env.example` — шаблон переменных окружения.
- `scripts/init-secrets.sh` — генерация секретов в `.env` (идемпотентно).

## Multi-node инсталляции

`compose.yml` поднимает control-plane + одну локальную ноду HAProxy. Для нескольких нод
используйте Ansible — см. [`deploy/ansible/README.md`](../ansible/README.md). Control-plane
ставится на одну машину, на каждом дополнительном узле — отдельный HAProxy через SSH-транспорт.
