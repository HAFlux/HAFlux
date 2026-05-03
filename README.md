# HAFlux

[![CI](https://github.com/HAFlux/HAFlux/actions/workflows/ci.yml/badge.svg)](https://github.com/HAFlux/HAFlux/actions/workflows/ci.yml)
[![Release](https://github.com/HAFlux/HAFlux/actions/workflows/release.yml/badge.svg)](https://github.com/HAFlux/HAFlux/actions/workflows/release.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

Multi‑HAProxy control plane: визуальное управление одной или несколькими инсталляциями HAProxy через Data Plane API.

> Аналоги по идее — **Nginx Proxy Manager**, **BunkerWeb**, **Roxy‑WI**.
> Отличие: глубокая интеграция с HAProxy (DPAPI v3 + Runtime API), мульти‑узловая модель из коробки, мастер выпуска wildcard‑сертификатов через Cloudflare DNS‑01.

Полное ТЗ: [`docs/SPEC.md`](docs/SPEC.md).

## Стек

- **Frontend** — Vite + React 19 + HeroUI + TailwindCSS + TanStack Query. Тема — монохромная (light/dark).
- **Backend** — NestJS 11 (Fastify) + Prisma + PostgreSQL + Redis + BullMQ. Модуль `haproxy` рендерит `haproxy.cfg` + модули (maps, acl, errorfiles, lua, spoe, certs) и доставляет их на ноды (shared volume локально, SSH/SFTP для удалённых).
- **HAProxy** — официальный образ `haproxy:3.x-alpine`, master‑worker, host network, без custom‑бинарей сверху.
- **Deploy** — `docker compose` для одной машины и **Ansible** (`deploy/ansible/`) для multi‑node инсталляций.

## Быстрый старт (Docker Compose, одна нода)

API-образ публикуется на каждом теге `v*.*.*` в `ghcr.io/haflux/api`. По умолчанию compose тянет
`:latest`; сборка из исходников не нужна.

```bash
git clone https://github.com/HAFlux/HAFlux.git
cd HAFlux
cp deploy/docker/env.example deploy/docker/.env
./deploy/docker/scripts/init-secrets.sh         # JWT_SECRET, ENCRYPTION_KEY, DB_PASSWORD
docker compose -f deploy/docker/compose.yml --env-file deploy/docker/.env up -d
```

UI: <http://localhost:8080> (HAProxy фронт), напрямую API: <http://localhost:3000/api/v1>.
Дефолтный логин (или сгенерированный пароль) выводится в логах `api` при первом старте:

```bash
docker compose -f deploy/docker/compose.yml --env-file deploy/docker/.env logs api | grep -i bootstrap
```

Чтобы зафиксировать конкретный релиз — поставьте `HAFLUX_API_TAG=v0.1.0` в `.env`.
Чтобы собрать API локально из исходников — добавьте `--build` к `docker compose up`.

Полные опции и dev-режим — в [`deploy/docker/README.md`](deploy/docker/README.md).

## Multi‑node через Ansible

Control‑plane на одной машине, HAProxy‑ноды на остальных. Управление нодами — по SSH (SFTP +
ssh‑exec), без custom‑агента.

```bash
ansible-galaxy install -r deploy/ansible/requirements.yml
cp deploy/ansible/inventory/hosts.example.ini deploy/ansible/inventory/hosts.ini
$EDITOR deploy/ansible/inventory/hosts.ini
ansible-playbook -i deploy/ansible/inventory/hosts.ini deploy/ansible/site.yml
```

Подробности и переменные — в [`deploy/ansible/README.md`](deploy/ansible/README.md).

## Структура репозитория

```
HAFlux/
├── apps/
│   ├── api/          # NestJS backend, бандлит SPA в /app/public (Fastify static)
│   └── web/          # Vite + React UI (билдится в apps/api/Dockerfile)
├── packages/
│   └── contracts/    # Общие Zod‑схемы и типы (api ↔ web)
├── deploy/
│   ├── docker/       # docker compose + haproxy-data/ (single-host)
│   └── ansible/      # роли control_plane / haproxy_node + playbooks
├── docs/             # SPEC.md, ADR
└── .github/
    ├── workflows/    # ci.yml, release.yml, codeql.yml
    └── ISSUE_TEMPLATE/
```

## CI/CD

| Workflow | Триггер | Что делает |
|---|---|---|
| `ci.yml` | push в `main`, любой PR | install → prisma generate → contracts build → biome lint → tsc typecheck → vitest → pnpm build → docker build (smoke) с GHA-кэшем |
| `release.yml` | push тега `v*.*.*` | multi-arch (`amd64`/`arm64`) сборка api образа, push в `ghcr.io/haflux/api` со всеми семвер-тегами + `latest`, GitHub Release с авто-changelog |
| `codeql.yml` | push в `main`, PR в `main`, weekly cron | CodeQL для TypeScript |

### Релиз

```bash
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions соберёт и опубликует:

- `ghcr.io/haflux/api:v0.1.0`
- `ghcr.io/haflux/api:0.1.0`
- `ghcr.io/haflux/api:0.1`
- `ghcr.io/haflux/api:0`
- `ghcr.io/haflux/api:latest`

И создаст GitHub Release с авто‑сгенерированными release notes по PR с прошлого тега.

## Разработка

Требуется Node ≥ 20.18, pnpm ≥ 9.15, Docker.

```bash
pnpm install
pnpm --filter @haflux/contracts build   # один раз — для алиасов в api/web
pnpm dev                                # api + web в watch-режиме
pnpm lint                               # biome
pnpm typecheck                          # tsc --noEmit во всех пакетах
pnpm test                               # vitest run во всех пакетах
pnpm build                              # production build всех пакетов
```

## Дорожная карта

- **MVP (v0.1)** — auth, одна нода, HTTP/HTTPS Proxy Hosts, TCP Stream Hosts, ACME (HTTP‑01 + Cloudflare DNS‑01 wildcard), live‑логи.
- **v0.5** — multi‑node, ACME‑провайдеры, Maps/ACL editor, OIDC SSO, уведомления.
- **v1.0** — HA + Keepalived wizard, WAF (ModSecurity + CRS), Prometheus dashboards, бэкапы.
- **v2.0** — Service discovery (Consul/k8s), Operator/CRD, Helm.

Подробности — [`docs/SPEC.md` §16](docs/SPEC.md#16-дорожная-карта).

## Сообщество

- Issues / Discussions — на GitHub.
- Сообщить об уязвимости — [`SECURITY.md`](SECURITY.md).
- Участвовать в разработке — [`CONTRIBUTING.md`](CONTRIBUTING.md).
