# HAFlux

Multi‑HAProxy control plane: визуальное управление одной или несколькими инсталляциями HAProxy через Data Plane API.

> Аналоги по идее — **Nginx Proxy Manager**, **BunkerWeb**, **Roxy‑WI**.
> Отличие: глубокая интеграция с HAProxy (DPAPI v3 + Runtime API), мульти‑узловая модель из коробки, мастер выпуска wildcard‑сертификатов через Cloudflare DNS‑01.

Полное ТЗ: [`docs/SPEC.md`](docs/SPEC.md).

## Стек

- **Frontend** — Vite + React 19 + HeroUI + TailwindCSS + TanStack Query. Тема — монохромная (light/dark).
- **Backend** — NestJS 11 (Fastify) + Prisma + PostgreSQL + Redis + BullMQ. Модуль `haproxy` рендерит `haproxy.cfg` + модули (maps, acl, errorfiles, lua, spoe, certs) и доставляет их на ноды (shared volume локально, SSH/SFTP для удалённых).
- **HAProxy** — официальный образ `haproxy:3.x-alpine`, master‑worker, host network, без custom‑бинарей сверху.
- **Deploy** — `docker compose` для одной машины и **Ansible** (`deploy/ansible/`) для multi‑node инсталляций.

## Быстрый старт (демо, одна нода)

```bash
git clone https://github.com/haflux/haflux.git
cd haflux
cp deploy/docker/env.example deploy/docker/.env
./deploy/docker/scripts/init-secrets.sh   # сгенерирует JWT_SECRET, ENCRYPTION_KEY, DB_PASSWORD
docker compose -f deploy/docker/compose.yml --env-file deploy/docker/.env up -d --build
```

UI откроется на `http://localhost:8080`. Дефолтный логин выводится в логах `api` контейнера при первом старте.

## Структура репозитория

```
haflux/
├── apps/
│   ├── api/          # NestJS backend (модуль haproxy: render + transports)
│   └── web/          # Vite + React UI
├── packages/
│   └── contracts/    # Общие Zod-схемы и типы
├── deploy/
│   ├── docker/       # docker compose + haproxy-data/
│   └── ansible/      # bootstrap control-plane и нод
├── docs/             # SPEC.md, ADR, инструкции
└── .github/          # CI и шаблоны issues/PR
```

## Multi‑node через Ansible

```bash
ansible-galaxy install -r deploy/ansible/requirements.yml
cp deploy/ansible/inventory/hosts.example.ini deploy/ansible/inventory/hosts.ini
$EDITOR deploy/ansible/inventory/hosts.ini
ansible-playbook -i deploy/ansible/inventory/hosts.ini deploy/ansible/site.yml
```

Подробности — [`deploy/ansible/README.md`](deploy/ansible/README.md).

## Разработка

Требуется Node ≥ 20.18, pnpm ≥ 9.15, Docker.

```bash
pnpm install
pnpm dev          # api + web в watch-режиме
pnpm lint
pnpm typecheck
pnpm test
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
