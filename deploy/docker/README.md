# Docker compose (manual quickstart)

> Самый быстрый способ — **`curl install.sh | bash`** из главного [README](../../README.md).
> Этот документ — про ручной путь, если не хочется однокомандный инсталлер.

## Quickstart (prebuilt image)

По умолчанию api тянется готовым из `ghcr.io/haflux/api:latest`. Локальная сборка не нужна.

```bash
cp deploy/docker/env.example deploy/docker/.env
./deploy/docker/scripts/init-secrets.sh
docker compose -f deploy/docker/compose.yml --env-file deploy/docker/.env up -d
```

UI: <http://localhost:8080>. OpenAPI docs: <http://localhost:3000/api/docs>.

Чтобы зафиксировать конкретный релиз — выставите `HAFLUX_API_TAG=v0.1.0` в `.env`
(или `HAFLUX_API_IMAGE=registry.example.com/haflux/api:custom` для приватного registry).

Дефолтный пароль root-юзера: `init-secrets.sh` его НЕ генерирует — Nest сгенерит сам при
первом старте api и выведет в логи. Чтобы заранее задать свой —
`BOOTSTRAP_ROOT_PASSWORD=mypassword` в `.env`. Установщик `install.sh` генерирует пароль
заранее и печатает его в баннере; здесь, при ручной установке, придётся вытащить из логов:

```bash
docker compose -f deploy/docker/compose.yml --env-file deploy/docker/.env logs api | grep -A4 -i bootstrap
```

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

`compose.yml` поднимает control-plane + локальную ноду HAProxy на одной машине. Для
нескольких нод поднимайте control-plane на одной машине через `install.sh`, а на каждом
дополнительном узле — отдельный HAProxy и заведите ноду в UI с `transport=SSH`.
Подробности транспорта см. в `apps/api/src/haproxy/transports/`.
