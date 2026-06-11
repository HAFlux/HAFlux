<p align="center">
  <img src="preview.png" alt="HAFlux — control plane" width="640">
</p>

<p align="center">
  <a href="https://github.com/HAFlux/HAFlux/actions/workflows/ci.yml"><img src="https://github.com/HAFlux/HAFlux/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/HAFlux/HAFlux/actions/workflows/release.yml"><img src="https://github.com/HAFlux/HAFlux/actions/workflows/release.yml/badge.svg" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"></a>
</p>

# HAFlux

Multi‑HAProxy control plane: визуальное управление одной или несколькими инсталляциями HAProxy через Data Plane API.

> Аналоги по идее — **Nginx Proxy Manager**, **BunkerWeb**, **Roxy‑WI**.
> Отличие: глубокая интеграция с HAProxy (DPAPI v3 + Runtime API), мульти‑узловая модель из коробки, мастер выпуска wildcard‑сертификатов через Cloudflare DNS‑01.

## Стек

- **Frontend** — Vite + React 19 + HeroUI + TailwindCSS + TanStack Query. Тема — монохромная (light/dark).
- **Backend** — NestJS 11 (Fastify) + Prisma + PostgreSQL + Redis + BullMQ. Модуль `haproxy` рендерит `haproxy.cfg` + модули (maps, acl, errorfiles, lua, spoe, certs) и доставляет их на ноды (shared volume локально, SSH/SFTP для удалённых).
- **HAProxy** — официальный образ `haproxy:3.x-alpine`, master‑worker, host network, без custom‑бинарей сверху.
- **Deploy** — однокомандный bash-инсталлер `install.sh` (Ubuntu/Debian) или `docker compose` руками.

## Установка одной командой

На свежем Ubuntu/Debian (root):

```bash
curl -fsSL https://raw.githubusercontent.com/HAFlux/HAFlux/main/install.sh | sudo bash
```

Что произойдёт:

1. Поставится Docker engine + compose plugin (если отсутствует).
2. Затюнится sysctl и nofile-лимиты под HAProxy.
3. В `/opt/haflux/` развернётся: `compose.yml`, `.env`, директория `haproxy-data/`.
4. Сгенерируются секреты (jwt, encryption, db_password, root_password) — идемпотентно, в `/opt/haflux/.secrets/` (mode 0600).
5. Стянется готовый `ghcr.io/haflux/api:latest` (никакой компиляции на клиенте).
6. Поднимется стек: `db` (postgres-16), `redis-7`, `api`, `haproxy:3.x`.
7. В конце выведется баннер с URL/email/паролем — **сохрани их сразу**.

> **Важно:** GHCR-пакеты от GitHub Actions по умолчанию приватные. После
> первого релиза зайди в [Settings → Packages → api → Change visibility
> → Public](https://github.com/users/HAFlux/packages/container/api/settings),
> иначе `docker pull` упадёт. install.sh выведет понятную ошибку с этой
> ссылкой и не будет пытаться билдить локально.

После установки:

```
URL:      https://<your-host>:8080   (self-signed)
Email:    admin@haflux.local
Password: <напечатан в баннере>
```

Панель слушает **только** свой порт (`HAFLUX_WEB_PORT`, по умолчанию `8080`).
Порты 80/443 остаются свободными под proxy host'ы: домен, приземлённый на
сервер, получает 404, а не панель.

Управление стеком:

```bash
docker compose -f /opt/haflux/compose.yml --env-file /opt/haflux/.env [up|down|logs|ps|pull]
```

### Опции инсталлера

Передаются через env-переменные перед `bash`:

```bash
curl -fsSL https://raw.githubusercontent.com/HAFlux/HAFlux/main/install.sh \
  | sudo HAFLUX_API_TAG=v0.1.0 HAFLUX_WEB_PORT=9443 bash
```

| Переменная | По умолчанию | Описание |
|---|---|---|
| `HAFLUX_INSTALL_DIR` | `/opt/haflux` | куда складывать compose.yml и секреты |
| `HAFLUX_WEB_PORT` | `8080` | порт панели (https, self-signed); не ставь 80/443 — они под proxy host'ы |
| `HAFLUX_API_PORT` | `3000` | порт api контейнера (на loopback) |
| `HAFLUX_API_TAG` | `latest` | тег `ghcr.io/haflux/api` |
| `HAFLUX_API_IMAGE` | вычисляется из тега | полный image override (для приватного registry) |
| `HAFLUX_PUBLIC_HOST` | первый IPv4 | адрес панели для CORS / баннера |
| `HAFLUX_ROOT_EMAIL` | `admin@haflux.local` | email root-юзера |
| `HAFLUX_ROOT_PASSWORD` | сгенерируется | задать корневой пароль явно |

## Альтернатива: docker compose руками

Если не хочется `curl | bash`:

```bash
git clone https://github.com/HAFlux/HAFlux.git /opt/haflux/src
cd /opt/haflux/src
cp deploy/docker/env.example deploy/docker/.env
./deploy/docker/scripts/init-secrets.sh
docker compose -f deploy/docker/compose.yml --env-file deploy/docker/.env up -d
```

Подробности — в [`deploy/docker/README.md`](deploy/docker/README.md).

## Мультинодовость: кластеры и ноды

**Кластер** — логическая группа HAProxy-нод с общей конфигурацией: один набор
proxy host'ов, сертификатов и групп доступа рендерится в один `haproxy.cfg`
и доставляется на каждую ноду кластера. Управление: **Кластеры → карточка
кластера → [Ноды]**, применение конфига — кнопка **[Применить]** там же.

### Типы нод

| Транспорт | Что это | Доставка конфига |
|---|---|---|
| `LOCAL` | HAProxy на той же машине, где панель | запись в `haproxy-data/` (shared volume) |
| `SSH` | удалённый сервер с HAProxy | SFTP: `haproxy.cfg` + certs + ACL/гео-списки + error pages |

`LOCAL`-нода может быть **только одна на инсталляцию** — иначе два кластера
перезаписывали бы общий `haproxy-data/haproxy.cfg`. При обновлении со старых
версий LOCAL-нода создаётся автоматически и привязывается к самому старому
кластеру (поведение не меняется).

### Добавление SSH-ноды

1. На удалённом сервере должен стоять HAProxy (пакет или контейнер) и быть
   доступен SSH.
2. В модалке **[Ноды]** скопируй **публичный SSH-ключ панели** (генерируется
   один раз, приватная часть хранится в БД зашифрованной) и добавь его в
   `~/.ssh/authorized_keys` указанного пользователя на ноде.
3. Заполни поля: хост/порт/пользователь, каталог HAProxy (по умолчанию
   `/etc/haproxy`), режим reload и роль.
4. Кнопка **Тест** выполнит `haproxy -v` по SSH — нода получит статус ONLINE
   и определённую версию HAProxy.

### Режимы reload

После записи конфига нода перезагружается gracefully (SIGUSR2 / `reload`):

| Режим | Команда на ноде | Target по умолчанию |
|---|---|---|
| `SYSTEMD` | `systemctl reload <target>` | `haproxy` |
| `CONTAINER` | `docker kill -s USR2 <target>` | `haproxy-balancer` |
| `SIGNAL` | `kill -USR2 $(cat <target>)` | `/var/run/haproxy.pid` |
| `MASTER_CLI` | `echo reload \| socat - UNIX-CONNECT:<target>` | `/var/run/haproxy/admin.sock` |

### Что делает «Применить»

1. Конфиг рендерится один раз на весь кластер.
2. **LOCAL-нода**: запись `haproxy.cfg` → валидация `haproxy -c` **до**
   reload → при ошибке откат на предыдущий конфиг (422 в UI).
3. **SSH-ноды**: deploy → валидация → reload, последовательно по нодам.
   Ошибка одной ноды не останавливает остальные — результат по каждой ноде
   виден в окне результата (✓/✗ + текст ошибки), статус ноды обновляется.
4. Панель (fe_panel на `WEB_PORT`) рендерится только на LOCAL-ноде —
   на удалённых нодах живут только proxy host'ы.

### Роли и режимы кластера

- **PRIMARY / SECONDARY** — метки ролей; сменить вручную — кнопка
  **Promote** (нода становится PRIMARY, остальные — SECONDARY).
- Фоновый health-check каждые 60 секунд: для SSH-нод — TCP-проба до
  ssh-порта, LOCAL всегда ONLINE.
- **`ACTIVE_PASSIVE`**: если PRIMARY уходит в OFFLINE и есть живая
  SECONDARY — роли переключаются автоматически. **Важно:** это смена меток
  в панели; реальное переключение трафика требует VIP (keepalived) или
  DNS-failover на стороне инфраструктуры.
- **`STANDALONE`** и **`ACTIVE_ACTIVE`** — пока только информационные метки
  (балансировка между нодами и синхронизация состояния — в дорожной карте).

## Структура репозитория

```
HAFlux/
├── install.sh        # однокомандный инсталлер (curl | bash)
├── apps/
│   ├── api/          # NestJS backend, бандлит SPA в /app/public (Fastify static)
│   └── web/          # Vite + React UI (билдится в apps/api/Dockerfile)
├── packages/
│   └── contracts/    # Общие Zod‑схемы и типы (api ↔ web)
├── deploy/
│   └── docker/       # docker compose + haproxy-data/ (single-host)
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

## Сообщество

- Issues / Discussions — на GitHub.
- Сообщить об уязвимости — [`SECURITY.md`](SECURITY.md).
- Участвовать в разработке — [`CONTRIBUTING.md`](CONTRIBUTING.md).
