# ТЗ: Multi‑HAProxy Control Plane (рабочее имя — **HAPilot**)

> Веб‑панель для централизованного управления одной или несколькими инсталляциями HAProxy.
> Аналоги‑референсы: **Roxy‑WI**, **Nginx Proxy Manager (NPM)**, **BunkerWeb**.
> Стек: **Vite + React + HeroUI** (frontend), **NestJS** (backend), **Go‑агент** на нодах HAProxy, **PostgreSQL + Redis**, развёртывание через **docker compose**.
> Лицензия: **AGPL‑3.0** (по умолчанию для open‑source панелей такого класса; обсуждаемо).

---

## 0. Оглавление

1. [Цели и не‑цели](#1-цели-и-не-цели)
2. [Глоссарий](#2-глоссарий)
3. [Целевая аудитория и сценарии](#3-целевая-аудитория-и-сценарии-использования)
4. [Анализ аналогов](#4-анализ-аналогов)
5. [Функциональные требования](#5-функциональные-требования)
6. [Нефункциональные требования](#6-нефункциональные-требования)
7. [Архитектура](#7-архитектура)
8. [Технологический стек](#8-технологический-стек)
9. [Модель данных](#9-модель-данных)
10. [API контракты](#10-api-контракты)
11. [UI: разделы и user flows](#11-ui-разделы-и-user-flows)
12. [Безопасность](#12-безопасность)
13. [Развёртывание (docker compose)](#13-развёртывание-docker-compose)
14. [Open‑source подготовка](#14-open-source-подготовка)
15. [CI/CD и качество](#15-cicd-и-качество)
16. [Дорожная карта](#16-дорожная-карта)
17. [Риски и открытые вопросы](#17-риски-и-открытые-вопросы)

---

## 1. Цели и не‑цели

### 1.1 Цели

- **Один UI на множество HAProxy‑узлов и кластеров.** Узлы могут быть standalone, парой `master/backup` (Keepalived/VRRP) или кластером N узлов с синхронизацией конфигов.
- **Полное визуальное управление** HAProxy без захода на сервер: frontends, backends, listen, servers, ACL, maps, stick‑tables, peers, certificates, runtime‑команды, формат логов, глобальные параметры.
- **Безопасный режим правки конфига** — все изменения применяются через HAProxy Data Plane API (DPAPI) с транзакциями и валидацией перед reload.
- **Поддержка TCP/UDP** (mode tcp, mode http, QUIC/HTTP3 при наличии в дистрибутиве HAProxy ≥ 2.6/3.x).
- **Lifecycle сертификатов**: загрузка, ACME (Let's Encrypt / ZeroSSL) с DNS‑01 и HTTP‑01, авторотация.
- **WAF и базовая защита** (опциональный модуль): ModSecurity + OWASP CRS через SPOA, либо встроенные правила (rate‑limit, bot‑protect, IP‑lists, geo).
- **Аудит и версии**: каждое изменение конфига — это коммит во встроенный git‑репозиторий с автором, diff, возможностью отката.
- **Мониторинг и логи в реальном времени**: stats page, Prometheus exporter, потоковый просмотр access/error логов в UI.
- **Мультиарендность (multi‑tenant)**: организации, проекты, RBAC, изоляция нод по проектам.
- **Полностью open‑source‑ready** репозиторий: корректные лицензии, шаблоны, чистая история, CI, контейнеры.

### 1.2 Не‑цели (для MVP)

- Не делаем полноценную замену CDN/Anycast.
- Не реализуем собственный DNS‑сервер (только ACME‑клиент к существующим провайдерам).
- Не подменяем системы оркестрации (Kubernetes Ingress) — это смежная ниша.
- Не цель MVP — поддержка nginx и apache (Roxy‑WI это умеет; мы фокусируемся **только на HAProxy** ради глубины интеграции; в v2 модуль для nginx — открытый вопрос).

---

## 2. Глоссарий

| Термин | Описание |
|---|---|
| **Node** | Одна инсталляция HAProxy + локальный sidecar‑агент панели. |
| **Cluster** | Логическая группа нод (1 или N) с одной общей конфигурацией. |
| **Frontend / Backend / Listen** | Базовые блоки HAProxy (`frontend`/`backend`/`listen` секции). |
| **Upstream** | Backend в терминологии панели (синоним для UX). |
| **DPAPI** | HAProxy Data Plane API, REST‑шлюз к конфигу/runtime. |
| **Runtime API** | Сокетный API HAProxy для горячих изменений (`enable server`, `set map`, `show stat`). |
| **SPOE / SPOA** | Stream Processing Offload Engine / Agent — внешние агенты (например, ModSecurity). |
| **ACL** | Условия маршрутизации в HAProxy. |
| **Map** | Файлы пар «ключ → значение», подгружаемые в HAProxy. |
| **Stick table** | Таблица состояний для rate‑limit / sticky‑session / детекции аномалий. |
| **Crt‑store / Crt‑list** | Хранилище и список сертификатов в DPAPI v3.x. |

---

## 3. Целевая аудитория и сценарии использования

### 3.1 Аудитория

- DevOps / SRE инженеры в малых и средних командах.
- Хостеры, MSP, небольшие IaaS‑провайдеры.
- Self‑hosters (homelab) — нужна простая UI‑альтернатива редактированию `haproxy.cfg`.

### 3.2 Сценарии (user stories)

1. *Self‑hoster* поднимает панель одним `docker compose up`, добавляет одну ноду HAProxy, через UI создаёт proxy host для своего сервиса с TLS от Let's Encrypt — без правки конфигов.
2. *SRE* импортирует существующий `haproxy.cfg` в панель, видит его в UI, переключает выбранный backend в maintenance, добавляет сервер в пул на лету через Runtime API.
3. *DevOps команда* управляет 6 нодами HAProxy в двух дата‑центрах (по 3 в каждом) как одним кластером: правки идут на master, синхронизация на slave, runtime‑команды (drain/maint) широковещательно.
4. *Поддержка приложения* в режиме read‑only смотрит трафик на frontend, тейлит логи, видит health checks.
5. *Security‑инженер* включает WAF‑модуль, импортирует кастомные правила, смотрит дашборд событий и блокировок.

---

## 4. Анализ аналогов

| Возможность | NPM | BunkerWeb | Roxy‑WI | **HAPilot (наш)** |
|---|---|---|---|---|
| Базовый UI для прокси | ✅ Tabler‑style | ✅ собственный | ✅ собственный | ✅ HeroUI |
| TCP/UDP streams | ✅ | частично | ✅ | ✅ |
| HTTP(S) с ACME | ✅ Let's Encrypt | ✅ | частично | ✅ Let's Encrypt + ZeroSSL + DNS‑01 |
| WAF | ❌ | ✅ ModSecurity + CRS | ❌ | ✅ опциональный модуль |
| Управление множеством серверов | ❌ (один инстанс) | частично | ✅ | ✅ (мультиузловое — first‑class) |
| HA‑кластер с Keepalived | ❌ | ❌ | ✅ | ✅ |
| RBAC | базовый | ✅ | ✅ | ✅ + OIDC + 2FA |
| Аудит и версии конфигов | ❌ | базовый | ✅ git‑style | ✅ git встроенный |
| Open source | ✅ MIT | ✅ AGPL | ✅ Apache‑2.0 (часть Pro платная) | ✅ AGPL‑3.0 |
| Уведомления (TG/Slack/Email) | ❌ | ✅ | ✅ | ✅ |
| API первого класса | базовый | ✅ | ✅ | ✅ OpenAPI 3.1 + WebSocket |
| Прокси HAProxy под капотом | ❌ (nginx) | ❌ (nginx) | ✅ | ✅ ⭐ глубокая интеграция |

**Вывод:** ниша «NPM, но для HAProxy и для нескольких узлов» свободна. Roxy‑WI ближе всего, но имеет устаревший UX (Python‑шаблоны), частично платный Pro‑функционал и не использует DPAPI как основной канал. Мы делаем UX уровня NPM/BunkerWeb, мультиузловую модель уровня Roxy‑WI и интеграцию через DPAPI/Runtime API как стандарт.

---

## 5. Функциональные требования

### 5.1 Управление нодами и кластерами

- **CRUD нод**: имя, тег, адрес/порт DPAPI, креды, тип подключения (`http+basic`/`mtls`).
- **Подключение к существующему HAProxy** (импорт): панель забирает текущий конфиг, парсит и заполняет UI.
- **Развёртывание DPAPI‑агента** одной командой (скрипт + опциональный bootstrap‑контейнер).
- **Group / Cluster**: объединение нод в кластер. Режимы:
  - `standalone` — одна нода;
  - `active‑passive` (Keepalived/VRRP) — генерация и пуш конфигов keepalived;
  - `active‑active` — синхронизация конфигов и одновременный рестарт по очереди (rolling reload).
- **Health‑heartbeat от агента** к панели каждые N секунд; UI показывает `online/offline/degraded`.
- **Версия HAProxy** определяется автоматически (через `haproxy -vv`); фичи в UI скрываются по версии.

### 5.2 HTTP(S) — Frontends / Backends

- **Wizard «Proxy Host»** (NPM‑style): один экран — домен(ы), куда проксировать, опции SSL, кеш, custom headers, ACL.
- Под капотом мастер создаёт/обновляет:
  - frontend `:80` (если ещё нет) с redirect → 443 при включённом SSL;
  - frontend `:443` с SNI map‑файлом → backend per host;
  - backend с одним или несколькими servers, health‑check (`option httpchk`), таймаутами;
  - запись в crt‑list, если предоставлен сертификат.
- **Полноценный режим (Advanced)**: явный CRUD frontend/backend/listen со всеми директивами:
  - `bind` (`v4@*:443 ssl crt @cert-store/...`, `tfo`, `alpn`, `proto h2`/`h3`);
  - `mode http|tcp`, `default_backend`;
  - `option forwardfor`, `option http-server-close`, `option redispatch`;
  - `timeout client/connect/server/queue/tunnel`;
  - `compression algo`, `http-response`, `http-request` (full rule editor);
  - `balance` (roundrobin, leastconn, source, uri, hdr, random, ...);
  - `cookie` (insert/prefix/rewrite, secure, httponly, sameSite);
  - `stick`/`stick-table` (size, expire, store);
  - `errorfile` загружаемые в UI.
- **Servers** в backend: вес, лимиты `maxconn`/`maxqueue`, `check inter/fall/rise`, `cookie`, `weight`, `backup`, `disabled` (maint), `agent-check`.
- **Дублирование (clone) frontend/backend** одним кликом для шаблонизации.

### 5.3 TCP / UDP

- Поддержка `listen`/`frontend` в `mode tcp` для произвольных портов (SSH, SMTP, FTP, MySQL, Postgres, Redis, MongoDB, RDP, WireGuard‑UDP, и т.д.).
- UI «Stream Hosts» аналогично NPM.
- TLS pass‑through (SNI routing без терминации) — `req.ssl_sni` + ACL → backend.
- TCP health checks (`option tcp-check`), готовые шаблоны для Postgres/MySQL/Redis (`mysql-check user`, `pgsql-check`).

### 5.4 SSL / TLS / ACME

- **Источники сертификатов**:
  - загрузка PEM/PFX вручную;
  - ACME (HTTP‑01 / DNS‑01) — встроенный клиент, поддержка Let's Encrypt, ZeroSSL, BuyPass, произвольных RFC‑8555;
  - DNS‑01 провайдеры (MVP): **Cloudflare** (приоритет №1, см. 5.4.1); далее — Route53, DigitalOcean, Hetzner, Yandex, Cloud.ru, RU‑центр (CDN), кастомный (через webhook).
- **Wildcard‑сертификаты обязательны как first‑class сценарий** — выдача `*.example.com` и `example.com` одновременно (SAN), только через DNS‑01.
- **Хранение** через DPAPI v3.x: `crt-store` + `crt-load`, синхронизация на все ноды кластера.
- **Авторотация** за N дней до истечения (по умолчанию 30), уведомления о приближении дедлайна и об успехе/ошибке renew.
- **OCSP stapling**, **CT logs check**.
- **mTLS**: загрузка `ca-file`, `crl-file`, `verify required`, конфиг по host‑match.
- **TLS‑политики** (preset профили: Modern/Intermediate/Old в стиле Mozilla SSL Configurator) — выбор cipher suites, протоколов.

#### 5.4.1 Cloudflare DNS‑01 wildcard (обязательный сценарий MVP)

**Цель:** пользователь, у которого DNS‑зона домена обслуживается Cloudflare, должен в три клика получить wildcard‑сертификат и сразу использовать его для любого Proxy/Stream Host в панели.

**UX‑поток в панели:**

1. **Settings → Certificates → ACME accounts → «Add Cloudflare provider»**.
2. Открывается мастер с двумя вкладками: **«Инструкция»** и **«Подключение»**.
   - Вкладка «Инструкция» содержит пошаговый гайд по получению API‑токена (см. ниже) с подсветкой нужных полей и скриншотами/иллюстрациями. Текст хранится в i18n‑ресурсах (RU/EN).
   - Вкладка «Подключение»: одно поле **API Token** (пароль‑input, тоггл show), необязательное поле **Account ID**, кнопка **«Проверить токен»** (panel выполняет `GET https://api.cloudflare.com/client/v4/user/tokens/verify` и `GET /zones` для проверки прав). Зелёный чек‑лист: токен валиден, видно N зон.
3. После сохранения — токен шифруется (envelope encryption) и кладётся в БД. Сырой токен из БД больше не отдаётся в UI (только маска `cf_xxxx…`).
4. **Certificates → New certificate → выбрать ACME provider = Cloudflare → выбрать домены**:
   - в поле «Domains» автодополнение из списка зон, доступных токену (panel запрашивает `/zones` через сохранённый токен);
   - чек‑бокс **«Wildcard»** (по умолчанию выключен). При включении к списку SAN автоматически добавляется `*.<выбранный домен>` рядом с apex `<домен>`;
   - выбор key type (ECDSA P‑256 по умолчанию, RSA 2048 как fallback).
5. Кнопка **«Issue»** ставит задачу в очередь (BullMQ → ACME воркер):
   - воркер берёт ACME‑аккаунт (или создаёт первый раз), формирует order на Let's Encrypt (по умолчанию) или ZeroSSL/BuyPass на выбор;
   - решает DNS‑01 challenge, добавляя TXT‑запись `_acme-challenge.<domain>` в Cloudflare через API (`POST /zones/{id}/dns_records`);
   - ждёт пропагации (polling Cloudflare API на наличие записи + проверка через 1.1.1.1/8.8.8.8);
   - финализирует order, скачивает chain, удаляет TXT‑запись;
   - кладёт сертификат в DPAPI `crt-store` всех нод кластера, регистрирует в БД, фиксирует событие в `AuditEvent`.
6. UI показывает прогресс по шагам в реалтайме (WebSocket): `account`, `order`, `dns-add`, `dns-propagation`, `validate`, `finalize`, `deploy`.
7. **Использование:** после выдачи сертификат сразу доступен в селектах:
   - в визарде Proxy Host (`HTTPS → Certificate`),
   - в Advanced → Frontends → bind ssl,
   - в TLS pass‑through сценариях (только для метаданных, само passthrough не требует ключа).
8. **Авторенью**: воркер за N дней до `expiresAt` ставит ту же задачу с флагом `renew=true`. По успеху — обновляет crt‑store и (по необходимости) делает мягкий reload.

**Инструкция по получению API‑токена Cloudflare** (текст, отображаемый в мастере):

> 1. Войдите в Cloudflare → **My Profile → API Tokens** (`https://dash.cloudflare.com/profile/api-tokens`).
> 2. Нажмите **«Create Token»**, выберите шаблон **«Edit zone DNS»** (или «Custom token»).
> 3. Настройте права:
>    - **Permissions**: `Zone — DNS — Edit`, `Zone — Zone — Read`.
>    - **Zone Resources**: `Include — Specific zone — <ваш домен>` (рекомендуется ограничить именно нужной зоной; для нескольких зон добавьте каждую отдельной строкой или выберите `All zones from an account`).
>    - **Client IP Address Filtering**: пусто (или укажите публичный IP control‑plane HAPilot).
>    - **TTL**: рекомендуется бессрочный, либо ≥ 1 год — иначе придётся обновлять токен и перевыпускать.
> 4. Нажмите **Continue → Create Token**, скопируйте появившийся токен (он показывается ровно один раз).
> 5. Вставьте токен в поле **API Token** в HAPilot и нажмите **Проверить**. Если зеленый чек — всё ок.
>
> Минимально необходимые права: `Zone:DNS:Edit` + `Zone:Zone:Read`. Никакие другие скоупы (Account, Workers, R2 и т.д.) HAPilot не требует и не запрашивает.

**Проверки и валидация панелью:**

- При сохранении токена — вызов `/user/tokens/verify` (HTTP 200 и `status=active`).
- При выборе домена — наличие зоны в `/zones?name=<domain>` и наличие у токена прав `#dns_records:edit` на этой зоне (получаем из ответа `/tokens/verify` и `/zones/{id}`).
- Если токен потерял права (например, удалили зону) — в UI рядом с провайдером показывается красный бейдж и подсказка, какой скоуп вернуть.

**Безопасность:**

- Токен хранится зашифрованным `ENCRYPTION_KEY` (envelope encryption, AES‑256‑GCM). В БД — только ciphertext.
- В audit‑логе фиксируются операции **«provider added/updated/removed»** и **«certificate issued/renewed»**, но не содержимое токена.
- В live‑логах ACME воркера токен и значения TXT‑записей маскируются.
- Опция `Restrict by IP` в инструкции — если включена, control‑plane должен иметь стабильный исходящий IP (документируется в `docs/CLOUDFLARE.md`).

**Расширяемость:** провайдер Cloudflare — первая реализация общего интерфейса `DnsProvider` (методы `addTxt`, `removeTxt`, `listZones`, `verifyCredentials`). Добавление Route53/Hetzner/Yandex и т.д. в v0.5+ — просто новые имплементации этого интерфейса; UX‑мастер с инструкцией собирается из манифеста провайдера.

### 5.5 ACL, Maps, Stick tables, Peers

- **ACL editor**: выпадашка предикатов (`hdr`, `path`, `src`, `req.ssl_sni`, `urlp`, ...), визуальный конструктор + raw‑mode.
- **Maps**: CRUD пар, импорт/экспорт CSV/TXT, hot‑reload через `set map` Runtime API без рестарта.
- **Stick tables**: создание (`size`, `expire`, `store`), просмотр содержимого, поиск ключа, ручной `clear table`.
- **Peers**: настройка peer‑секции для синхронизации stick‑tables между нодами кластера.

### 5.6 Глобальные настройки HAProxy

- `global`: `maxconn`, `nbthread`, `cpu-map`, `tune.*`, ssl‑defaults (`ssl-default-bind-ciphers`, `ssl-default-bind-options`).
- `defaults`: timeouts, `option httplog`/`tcplog`, `errorfile`, `log-format`.
- **Log format builder**: визуальный конструктор `log-format`/`log-format-sd`/`log-format-tcp` со списком переменных и preview.
- **Resolvers** (DNS service discovery): nameserver pools, `server-template`, `init-addr`, `resolvers`.
- **HTTP errors**: загрузка `errorfile`/`http-errors` секций.

### 5.7 Сырой конфиг и валидация

- Режим **Advanced/Raw**: Monaco editor с подсветкой `haproxy.cfg`, autocomplete по справочнику директив, линтер (предкомпиляция через `haproxy -c -f` на ноде).
- **Diff‑view** перед применением: текущая версия vs новая (двухпанельный diff).
- **Транзакция**: панель открывает транзакцию DPAPI, накатывает изменения, при `commit` DPAPI делает `reload` и сохраняет конфиг; при ошибке — откат.

### 5.8 Версионирование и аудит

- Каждое успешное применение → коммит в **встроенный bare git‑репозиторий** на бекенде (по cluster).
- Метаданные коммита: автор (user из RBAC), source (UI/API/agent), сообщение (UI поле), diff.
- В UI: история, blame на уровне строки конфига, **rollback** в один клик (создаёт новый коммит‑откат).
- Audit log: отдельная таблица для всех действий пользователя (логин, runtime‑команды, экспорт сертификатов и т.п.).

### 5.9 Логи и мониторинг

- **Live tail** access/error логов в UI через WebSocket (агент стримит `tail -F` или syslog UDP).
- **Парсер** строк по формату `httplog`/`tcplog`/custom — таблица с фильтрами (status, host, method, src, latency).
- **Метрики**: каждый агент поднимает HAProxy Prometheus exporter (встроен в HAProxy 2.x+); панель агрегирует и показывает дашборды (Sessions, Req/s, 5xx rate, p95 latency, backend status).
- **Stats page**: проксирование `/stats?stats` нативной HAProxy в UI как fallback.
- **Алерты**: правила (порог 5xx, нода offline, backend down, истечение сертификата) → каналы (email/Telegram/Slack/Webhook).

### 5.10 WAF и защита (опциональный модуль)

- **ModSecurity SPOA** контейнер рядом с HAProxy, OWASP CRS из коробки, переключатель Detection/Block.
- **Bot protection**: списки User‑Agent, JS challenge, captcha (hCaptcha/Turnstile/reCAPTCHA) на frontend через ACL.
- **IP allow/deny lists** (управляются как Maps), связь с публичными blocklists (Spamhaus, Project Honeypot) с авто‑обновлением.
- **GeoIP**: загрузка MaxMind/ipapi баз в map‑файлы (`src,country`) через ACL.
- **Rate limiting**: визарды на базе stick‑tables (`http-request track-sc0`, `deny if { sc_http_req_rate gt N }`).

### 5.11 Резервные копии

- Snapshot конфигов и БД панели по расписанию (cron).
- Хранилище: локальный том или S3‑совместимое (MinIO, Yandex Object Storage, AWS S3).
- Restore из UI (выбор snapshot → подтверждение → применение).

### 5.12 Интеграции / Экосистема

- **Webhooks** на события (config changed, backend down, cert renewed).
- **Service discovery**: HAProxy `server-template` + `resolvers` + DPAPI sync — UI для подключения к Consul, Nomad, etcd, Docker Swarm, Kubernetes (через `kube-proxy` watcher агента — v2).
- **OIDC SSO** (Keycloak, Authentik, Authelia, GitLab, GitHub, Yandex ID).
- **CLI** `hapilotctl` (Go, генерируется из OpenAPI) — экспорт/импорт, диффы, применение из CI.

---

## 6. Нефункциональные требования

| Категория | Требование |
|---|---|
| Производительность UI | TTI ≤ 2 с на средней машине, виртуализация списков ≥ 1000 строк |
| Backend | Поддержка ≥ 50 нод, ≥ 10 000 backends/maps на инсталляцию |
| Apply‑latency | UI «Apply» → reload HAProxy: p95 ≤ 5 с на одну ноду |
| Логи live‑tail | задержка ≤ 1 с от строки в файле до UI |
| Доступность панели | сама панель не критична для трафика — HAProxy продолжает работать без неё |
| Безопасность | OWASP ASVS L2; secrets at rest зашифрованы; mTLS между API и агентами |
| i18n | RU + EN из коробки; архитектурно — любые локали (ICU) |
| a11y | WCAG 2.1 AA для основных flow |
| Темы | Light/Dark + system; HeroUI tokens |
| Платформы | Linux x86_64 и arm64 (Raspberry Pi friendly) |
| Лог‑объём | Ротация и сжатие, отправка в внешние системы (Loki/ELK) — конфигурируемо |

---

## 7. Архитектура

### 7.1 Высокоуровневая схема

```
┌──────────────────────────── Browser ────────────────────────────┐
│  Vite + React + HeroUI SPA  (REST + WebSocket к /api)           │
└──────────────────┬─────────────────────────────────────┬────────┘
                   │ HTTPS                              │ WSS
┌──────────────────▼─────────────────────────────────────▼────────┐
│                    HAPilot Backend (NestJS)                     │
│                                                                 │
│  ┌──────────────── Haproxy module ──────────────────────────┐   │
│  │ config-renderer  ·  validator (haproxy -c)               │   │
│  │ reloader (master CLI socket / signal)                    │   │
│  │ modules: maps · acl-lists · errorfiles · lua · spoe ·    │   │
│  │          certs · crt-list · dh-params                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────── Sync transport ──────────────────────────┐   │
│  │ local fs (shared volume)   |   ssh/sftp + ssh-exec       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Auth · Clusters · Nodes · Certs/ACME · Logs · Audit · RBAC     │
│        Prisma          BullMQ          OpenAPI 3.1              │
└────────┬─────────────────┬──────────────────────────────────────┘
         │                 │
   ┌─────▼──────┐    ┌─────▼─────┐
   │ PostgreSQL │    │   Redis   │
   └────────────┘    └───────────┘

      shared volume / SFTP                shared volume / SFTP
       (/etc/haproxy)                       (/etc/haproxy)
   ┌────────▼─────────┐               ┌──────────▼───────┐
   │   HAProxy node 1 │   . . . . .   │ HAProxy node N   │
   │   ─────────────  │               │   ─────────────  │
   │ haproxy.cfg      │               │ haproxy.cfg      │
   │ maps/   acl/     │               │ maps/   acl/     │
   │ errors/ lua/     │               │ errors/ lua/     │
   │ spoe/   certs/   │               │ spoe/   certs/   │
   │ master CLI sock  │               │ master CLI sock  │
   └──────────────────┘               └──────────────────┘
```

### 7.2 Компоненты

| Компонент | Назначение |
|---|---|
| **web** | SPA, статика, отдаётся через CDN или из контейнера nginx внутри compose |
| **api** | NestJS backend. Содержит модуль `haproxy` — рендер конфига и его модулей, валидация (`haproxy -c`), reload через master CLI socket. Доставка файлов на ноды — shared volume (для local) или SSH/SFTP (для remote) |
| **db** | PostgreSQL 16+ |
| **cache** | Redis 7+ (BullMQ, pub/sub для live‑логов и событий) |
| **haproxy** | Сам HAProxy ≥ 2.6 в master‑worker режиме. Читает `/etc/haproxy/*` из shared volume или с локальной FS (на удалённой ноде). Никакого custom-агента сверху нет |
| **acme** | Воркер ACME‑клиента, кладёт сертификат в `certs/` + обновляет crt‑list, дёргает reload |
| **notifier** | Воркер уведомлений |
| **migrations** | Job контейнер, прогоняет Prisma migrate deploy |

### 7.3 Конфиг и модули как первичный артефакт

Источник истины — нормализованные сущности в БД (см. §9). На каждом Apply сервис **config-renderer** собирает их в дерево файлов. Раскладка совместима с официальным образом `haproxy:3.x-alpine` (главный конфиг в `/usr/local/etc/haproxy/`, вспомогательные ресурсы в `/etc/haproxy/`):

```
deploy/docker/haproxy-data/         # на хосте control-plane (или ноды)
├── haproxy.cfg                     # global + defaults + (опц. userlist/peers/resolvers)
├── conf.d/                         # drop-in: всё, что подключается через -f <dir>
│   ├── 10-resolvers.cfg
│   ├── 20-userlist.cfg
│   ├── 30-frontends.cfg
│   ├── 40-backends.cfg
│   ├── 50-listen.cfg
│   ├── 60-peers.cfg
│   ├── 70-http-errors.cfg
│   └── 80-rings.cfg
├── maps/
│   ├── hosts.map                   # SNI → backend
│   └── geo.map
├── acl/
│   ├── blocklist.lst
│   └── trusted-proxies.lst
├── errors/
│   ├── 503.http
│   └── 429.http
├── lua/
│   ├── rewriter.lua
│   └── auth.lua
├── spoe/
│   └── modsecurity.cfg             # SPOE-агенты (ModSecurity, custom)
├── certs/                          # отдельные .pem файлы
│   ├── example.com.pem
│   └── _wildcard_example.com.pem
├── crt-list/
│   └── default.list                # порядок и фильтры по SNI
├── ca/
│   ├── trusted.crt
│   └── revoked.crl
└── dhparam.pem
```

HAProxy запускается с двумя `-f` (главный + директория `conf.d`):

```
haproxy -W -db \
        -f /usr/local/etc/haproxy/haproxy.cfg \
        -f /usr/local/etc/haproxy/conf.d/
```

Каждый блок сущностей в БД соответствует своей секции в `haproxy.cfg`/`conf.d/*.cfg` или файлу в одной из папок выше. Renderer стабильный и детерминированный — одинаковый стейт даёт байт‑в‑байт одинаковый вывод (важно для diff и git‑истории).

### 7.4 Поток применения изменений

1. Пользователь правит сущность в UI и нажимает **Apply**.
2. Backend валидирует payload (zod) и собирает план: какие файлы пересобрать.
3. **render** → во временную директорию (или временный префикс на ноде).
4. **validate** → `haproxy -c -f /tmp/haproxy.cfg` (на той же ноде, локально или по SSH).
5. **deploy** → атомарный `mv` поверх боевых файлов (или `rsync --delay-updates` для удалённой ноды).
6. **reload** → `echo "reload" | socat - UNIX-CONNECT:/var/run/haproxy/admin.sock` (master CLI, поддерживается с HAProxy 2.4 в режиме `master-worker -W`). Fallback: `kill -USR2 $(cat /run/haproxy.pid)` или `systemctl reload haproxy`.
7. На каждой ноде кластера шаги 3–6 выполняются последовательно (rolling) или параллельно — настраивается на уровне Cluster.
8. При успехе на всех нодах — коммит в git‑репозиторий конфига (на стороне api), audit‑запись, событие в UI (WS).
9. При ошибке хотя бы на одной ноде — restore предыдущей версии из git‑истории и повторный reload.

### 7.5 Доставка на ноды

- **Local node** (HAProxy на той же машине, что и api): shared docker volume `haproxy_cfg`. Renderer пишет напрямую. Master CLI socket смонтирован в api для reload‑команд.
- **Remote node**: панель ходит на ноду по SSH (ed25519 ключ панели, добавляется в `~/.ssh/authorized_keys` на ноде через Ansible bootstrap). Файлы — через SFTP или `rsync --delete` (атомарность гарантируется временной директорией + переименованием). Reload — `ssh node 'haproxy -c -f ... && systemctl reload haproxy'`.
- **Никакого custom‑бинаря на ноде нет** — только пакет `haproxy` и его штатные модули (Lua, SPOE, etc.).

---

## 8. Технологический стек

### 8.1 Frontend (`apps/web`)

- **Vite 5+** (TypeScript strict mode).
- **React 19** + **HeroUI** (NextUI v3) — UI kit.
- **Tailwind CSS** (HeroUI tokens).
- **TanStack Query** — серверное состояние и кеширование.
- **Zustand** — лёгкий клиентский стор (UI state, фильтры).
- **react‑hook‑form** + **zod** — формы и валидация (одна схема на UI и API).
- **TanStack Table** — таблицы серверов/бэкендов/логов.
- **Monaco Editor** — raw‑конфиг, log‑format, custom rules.
- **i18next** + ICU — локализация (RU/EN).
- **react‑router** v7.
- **WebSocket** через нативный API + `reconnecting-websocket`.
- **Charts**: Recharts или Visx (метрики).
- **OpenAPI codegen** → типизированный клиент (orval / openapi‑typescript).
- **Storybook** для дизайн‑системы.
- **Playwright** для e2e.

### 8.2 Backend (`apps/api`)

- **NestJS 11** + Fastify adapter.
- **Prisma 6** + PostgreSQL.
- **BullMQ** (Redis) — очереди (apply, acme, notifications).
- **@nestjs/swagger** — OpenAPI.
- **Passport** — стратегии (local, JWT, OIDC).
- **argon2** — пароли.
- **otplib** — TOTP.
- **isomorphic‑git** или `simple‑git` — встроенный git для версий конфигов.
- **pino** — логирование.
- **opentelemetry** — трейсы и метрики.
- **vitest** — юнит/интеграция; **supertest** — http e2e.

### 8.3 HAProxy на ноде

- **Никакого custom‑бинаря на ноде нет.** На ноде только пакет/контейнер HAProxy ≥ 2.6 (рекомендуется 3.0+).
- Запуск через **docker compose** (паттерн ниже) или через системный пакет + systemd.
- Reload — встроенными средствами HAProxy: master CLI socket (`reload` команда) или сигнал `SIGUSR2` мастеру.
- Доставка файлов с control-plane на удалённую ноду — по **SSH/SFTP**: панель кладёт ed25519 ключ при bootstrap (Ansible), дальше управляет конфигами без агентов.

### 8.4 Монорепо

- **pnpm workspaces** + **Nx** или **Turborepo**.
- Единый `tsconfig.base.json`, общий `packages/contracts` (Zod‑схемы и DTO), общий `packages/ui-icons`.
- Docker‑образы: `Dockerfile` per app, multi‑stage, distroless.

---

## 9. Модель данных

Ключевые таблицы (Prisma‑style, упрощённо):

```prisma
model Organization {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  createdAt DateTime @default(now())
  members   Membership[]
  clusters  Cluster[]
}

model User {
  id          String        @id @default(cuid())
  email       String        @unique
  passwordHash String?
  totpSecret  String?
  oidcSubs    OidcLink[]
  memberships Membership[]
  createdAt   DateTime      @default(now())
}

model Role {
  id    String  @id @default(cuid())
  name  String  // owner | admin | editor | viewer | custom
  permissions Json // { "nodes:read": true, "nodes:write": false, ... }
}

model Membership {
  id     String @id @default(cuid())
  userId String
  orgId  String
  roleId String
  user   User         @relation(fields: [userId], references: [id])
  org    Organization @relation(fields: [orgId],  references: [id])
  role   Role         @relation(fields: [roleId], references: [id])
}

model Cluster {
  id        String  @id @default(cuid())
  orgId     String
  name      String
  mode      ClusterMode // STANDALONE | ACTIVE_PASSIVE | ACTIVE_ACTIVE
  org       Organization @relation(fields: [orgId], references: [id])
  nodes     Node[]
  configs   ConfigVersion[]
}

model Node {
  id            String  @id @default(cuid())
  clusterId     String
  name          String
  address       String   // hostname/ip
  agentToken    String   @unique
  haproxyVer    String?
  status        NodeStatus // ONLINE | OFFLINE | DEGRADED
  role          NodeRole   // PRIMARY | SECONDARY
  lastSeenAt    DateTime?
  cluster       Cluster   @relation(fields: [clusterId], references: [id])
}

model ConfigVersion {
  id         String  @id @default(cuid())
  clusterId  String
  gitSha     String
  authorId   String
  message    String
  diffBlob   String   // unified diff
  createdAt  DateTime @default(now())
  cluster    Cluster  @relation(fields: [clusterId], references: [id])
}

model Frontend  { /* ... */ }
model Backend   { /* ... */ }
model ServerEntry { /* ... */ }
model Acl       { /* ... */ }
model MapFile   { /* ... */ }
model StickTable{ /* ... */ }
model Certificate { /* источник, метаданные, fingerprint, expiresAt */ }
model AcmeAccount { /* провайдер, kid, ключ зашифрован */ }
model AcmeOrder   { /* domain, dns/http-01, status */ }
model AuditEvent  { id; actorId; action; targetType; targetId; payload Json; ip; ua; createdAt }
model Webhook     { /* url, secret, eventTypes[] */ }
model NotificationChannel { /* type: email|tg|slack|webhook, settings json */ }
model Backup      { /* path/s3-key, size, sha256, createdAt */ }
```

Конфиг HAProxy в БД храним **одновременно**:
1. в **нормализованной форме** (модели выше) — для UI и API;
2. в виде **сгенерированного `haproxy.cfg`** (рендер из моделей) — для git‑истории и применения, если ОТКАЗ от DPAPI (fallback).

Источник истины — нормализованные модели; DPAPI вызывается из сериализатора, который собирает запросы из текущего стейта.

---

## 10. API контракты

### 10.1 Принципы

- **REST + JSON**, версионирование `/api/v1`.
- Полная **OpenAPI 3.1** спецификация генерируется из NestJS декораторов.
- **WebSocket** канал `/ws` с топиками: `cluster:{id}:status`, `node:{id}:logs`, `config:apply:{jobId}`, `metrics:{nodeId}`.
- **Идемпотентность** мутаций через `Idempotency-Key`.
- **Pagination**: cursor‑based (`?cursor=&limit=`).
- **Filtering**: RSQL/AIP‑160‑совместимый `?filter=`.

### 10.2 Корневые ресурсы

```
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/totp/verify
GET    /api/v1/me

GET    /api/v1/orgs
POST   /api/v1/orgs
GET    /api/v1/orgs/{orgId}/members
POST   /api/v1/orgs/{orgId}/members

GET    /api/v1/clusters
POST   /api/v1/clusters
GET    /api/v1/clusters/{id}
PATCH  /api/v1/clusters/{id}
DELETE /api/v1/clusters/{id}

GET    /api/v1/clusters/{id}/nodes
POST   /api/v1/clusters/{id}/nodes              # registers a new node, returns enrollment token
DELETE /api/v1/clusters/{id}/nodes/{nodeId}
POST   /api/v1/nodes/{nodeId}/runtime/{cmd}     # enable/disable server, drain, set map, ...

GET    /api/v1/clusters/{id}/frontends
POST   /api/v1/clusters/{id}/frontends
PATCH  /api/v1/clusters/{id}/frontends/{name}
DELETE /api/v1/clusters/{id}/frontends/{name}

GET    /api/v1/clusters/{id}/backends
... (CRUD аналогично) ...

POST   /api/v1/clusters/{id}/apply               # запускает job применения; вернёт jobId
GET    /api/v1/clusters/{id}/config              # рендер cfg + diff
GET    /api/v1/clusters/{id}/versions            # история (git)
POST   /api/v1/clusters/{id}/versions/{sha}/rollback

GET    /api/v1/certificates
POST   /api/v1/certificates                      # upload PEM
POST   /api/v1/acme/orders                       # запросить через ACME

GET    /api/v1/audit
GET    /api/v1/notifications/channels
POST   /api/v1/notifications/channels
```

### 10.3 Agent ↔ API

Отдельная схема `agent.proto` (gRPC):

```
service AgentControl {
  rpc Register(stream Hello) returns (stream Command);   // bi-di
  rpc StreamLogs(LogStreamRequest)  returns (stream LogLine);
  rpc StreamMetrics(MetricsRequest) returns (stream MetricSample);
  rpc ApplyTransaction(ApplyRequest) returns (ApplyResult);
  rpc RuntimeCommand(RuntimeCommandRequest) returns (RuntimeCommandResult);
}
```

---

## 11. UI: разделы и user flows

Глобальная навигация (sidebar):

1. **Dashboard** — health всех кластеров, ключевые метрики, активные алерты.
2. **Clusters & Nodes** — список, статусы, добавление ноды (визард с командой `curl … | bash`).
3. **Hosts** (упрощённый режим NPM):
   - **Proxy Hosts** (HTTP/HTTPS)
   - **Stream Hosts** (TCP/UDP)
   - **Redirection Hosts**
   - **404 / Default Hosts**
4. **Advanced** (полный HAProxy‑режим):
   - **Frontends** / **Backends** / **Listen** / **Defaults** / **Global**
   - **ACLs** / **Maps** / **Stick Tables** / **Peers** / **Resolvers** / **Userlists**
5. **Certificates** — список, ACME‑аккаунты, заказы, авторотация.
6. **Security** (если включён модуль): WAF rules, IP lists, GeoIP, Bot, Rate‑limit.
7. **Logs** — live tail с фильтрами, экспорт.
8. **Metrics** — дашборды Prometheus.
9. **Audit & Versions** — история конфигов, diff, rollback; журнал действий.
10. **Settings**:
    - Users & Roles, OIDC, SMTP, Webhooks, Notifications channels;
    - Backup & Restore;
    - License/Telemetry (анонимная статистика — opt‑in);
    - About (версия, ссылки, лицензия).

### 11.1 Ключевые экраны

- **Add Proxy Host wizard** (3 шага): домен и сертификат → upstream(ы) и health‑check → опции (cache, headers, ACL, redirect rules) → preview cfg + Apply.
- **Backend detail**: серверы (drag‑n‑drop порядок), кнопки `Drain`/`Maintenance`/`Ready` (Runtime API), live‑таблица с current/max sessions.
- **Cert detail**: chain viewer, SAN, алгоритмы, история выпуска, кнопка `Renew now`.
- **Apply preview**: левый/правый diff `haproxy.cfg`, кнопки `Validate (haproxy -c)`, `Apply`, `Save as draft`.
- **Live logs**: виртуализованный список, фильтры (status≥, latency≥, host==, src==), кнопка «Pause», экспорт CSV/NDJSON.

### 11.2 UX‑правила

- Во всём приложении два режима — **Simple** и **Advanced** — переключатель в шапке. Simple прячет 70% директив за разумные дефолты.
- **Никаких неосознанных «Apply» в проде**: подтверждение модалкой с diff и (для prod‑тегов) обязательным сообщением коммита.
- **Read‑only‑баннер** для viewer‑роли.
- **Поиск по всему**: ⌘K палитра — открывает frontend/backend/cert/host по имени.

---

## 12. Безопасность

- **Аутентификация**: локально (email + password + Argon2id), TOTP 2FA, OIDC SSO, magic‑link опционально.
- **Авторизация**: RBAC + ABAC по тегам кластеров/нод. Готовые роли: `owner / admin / editor / viewer`. Custom roles в Pro‑v2.
- **Сессии**: short‑lived JWT (15 мин) + refresh (rotating) в httpOnly Secure SameSite=Strict cookie.
- **CSRF**: double‑submit cookie + SameSite=Strict.
- **Brute‑force**: rate‑limit на `/auth/*`, lockout по IP+аккаунту.
- **Secrets at rest**: ключи ACME, agent‑tokens, OIDC client secrets — шифруются в БД (envelope encryption KMS‑совместимым ключом из ENV).
- **Agent ↔ API**: mTLS, agent‑token + JWT с коротким TTL, rotation.
- **Audit**: каждое чувствительное действие — запись в `AuditEvent`, неудаляемая.
- **CSP**: строгий, `default-src 'self'`, без inline скриптов (Vite‑plugin для nonce).
- **Headers**: HSTS preload, X‑Content‑Type‑Options nosniff, Referrer‑Policy strict‑origin, Permissions‑Policy.
- **Supply chain**: pnpm lockfile + SBOM (CycloneDX) в CI, Renovate, signed commits, Cosign‑подпись Docker‑образов.
- **Secrets scan**: `gitleaks` в pre‑commit и CI.
- **OWASP Top 10 / ASVS L2** — чек‑лист в `docs/SECURITY.md`.
- **Изоляция** компонентов в compose: разные сети для api↔db и web↔api, db не выставлен наружу.

---

## 13. Развёртывание (docker compose)

### 13.1 Структура репозитория

```
hapilot/
├── apps/
│   ├── web/         # Vite + React + HeroUI
│   └── api/         # NestJS + Prisma + модуль haproxy
├── packages/
│   ├── contracts/   # Zod + OpenAPI shared types
│   └── ui-tokens/   # HeroUI / tailwind tokens
├── deploy/
│   ├── docker/
│   │   ├── compose.yml             # для самохостеров (control-plane + локальный haproxy)
│   │   ├── compose.dev.yml         # для разработки
│   │   ├── compose.ha.yml          # пример HA-инсталляции
│   │   ├── env.example
│   │   └── haproxy-data/           # сюда панель пишет haproxy.cfg, conf.d/, certs/, ...
│   └── ansible/                    # bootstrap control-plane и нод HAProxy
├── docs/
│   ├── SPEC.md                     # этот документ
│   ├── ARCHITECTURE.md
│   ├── SECURITY.md
│   ├── CONTRIBUTING.md
│   └── adr/                        # Architecture Decision Records
├── .github/
│   ├── workflows/                  # CI
│   ├── ISSUE_TEMPLATE/
│   └── PULL_REQUEST_TEMPLATE.md
├── NOTICE
├── README.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
└── package.json
```

### 13.2 Эскиз `compose.yml` (самохостер, single‑node demo)

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: hapilot
      POSTGRES_USER: hapilot
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes: [db_data:/var/lib/postgresql/data]
    networks: [internal]

  redis:
    image: redis:7-alpine
    networks: [internal]

  api:
    image: ghcr.io/hapilot/api:latest
    environment:
      DATABASE_URL: postgres://hapilot:${DB_PASSWORD}@db:5432/hapilot
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      ALLOWED_ORIGINS: https://${PUBLIC_HOST}
      HAPROXY_DATA_DIR: /haproxy-data        # куда писать cfg+модули
      HAPROXY_RELOAD_MODE: container         # container | systemd | ssh
      HAPROXY_CONTAINER_NAME: haproxy-balancer
    volumes:
      - ./haproxy-data:/haproxy-data         # rw для api
      - /var/run/docker.sock:/var/run/docker.sock:ro   # чтобы делать reload контейнера
    depends_on: [db, redis]
    networks: [internal, frontend]

  web:
    image: ghcr.io/hapilot/web:latest
    networks: [frontend]

  haproxy:
    image: haproxy:3.1.17-alpine
    container_name: haproxy-balancer
    network_mode: host
    user: "0:0"
    volumes:
      - ./haproxy-data/haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro
      - ./haproxy-data/conf.d:/usr/local/etc/haproxy/conf.d:ro
      - ./haproxy-data/certs:/etc/haproxy/certs:ro
      - ./haproxy-data/maps:/etc/haproxy/maps:ro
      - ./haproxy-data/acl:/etc/haproxy/acl:ro
      - ./haproxy-data/errors:/etc/haproxy/errors:ro
      - ./haproxy-data/lua:/etc/haproxy/lua:ro
      - ./haproxy-data/spoe:/etc/haproxy/spoe:ro
    command:
      - haproxy
      - -W
      - -db
      - -f
      - /usr/local/etc/haproxy/haproxy.cfg
      - -f
      - /usr/local/etc/haproxy/conf.d/
    ulimits:
      nofile: { soft: 1048576, hard: 1048576 }
    restart: unless-stopped

volumes:
  db_data: {}

networks:
  frontend: {}
  internal: { internal: true }
```

> Для multi‑node инсталляций control‑plane (`api/web/db/redis`) стоит на отдельном хосте, а каждая нода — это **только** контейнер `haproxy` (без custom‑бинаря). Доставка файлов — по SSH/SFTP, reload — `ssh node 'systemctl reload haproxy'` или `docker kill -s USR2 haproxy-balancer`.

### 13.3 Простой запуск

```
git clone https://github.com/hapilot/hapilot
cd hapilot/deploy/docker
cp env.example .env && ./scripts/init-secrets.sh
docker compose up -d
# открыть https://<host>, дефолт-логин выводится в логах api при первом старте
```

---

## 14. Open‑source подготовка

### 14.1 Лицензия и юридическое

- **AGPL‑3.0** для основного репозитория (соответствует подходу BunkerWeb; защищает от закрытых SaaS‑форков; для commercial OEM отдельная лицензия — позже).
- `LICENSE`, `NOTICE`, `COPYRIGHT` файлы.
- **DCO** (Developer Certificate of Origin) — sign‑off в коммитах. CLA не вводим (распространённая практика для AGPL‑проектов).
- **Trademark policy** в `TRADEMARK.md` (если выберем брендовое имя).

### 14.2 Документы сообщества

- `README.md` — лаконично: что это, скриншоты/GIF, quickstart, сравнение с альтернативами.
- `CONTRIBUTING.md` — как поднять dev‑окружение, стиль кода, ветки, conventional commits.
- `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1.
- `SECURITY.md` — как сообщать об уязвимостях (security@…); SLA.
- `SUPPORT.md` — где задавать вопросы (Discussions, Discord/Matrix).
- `GOVERNANCE.md` — модель принятия решений (BDFL → SC → meritocracy по мере роста).
- `MAINTAINERS.md` — список ментейнеров и зон ответственности.
- `ADR` (`docs/adr/`) — архитектурные решения по шаблону Майкла Найгарда.
- Шаблоны issues/PR в `.github/`.

### 14.3 Релизный процесс

- **Conventional Commits** + **semantic‑release** → автоматический changelog, теги, GitHub Releases.
- **SemVer** строго.
- LTS‑ветки начиная с v1.
- Подписи Cosign для Docker‑образов; SLSA level 3 как цель.
- Демо‑инстанс (try.hapilot.dev) с reset раз в час.

### 14.4 Discoverability

- Topics на GitHub (`haproxy`, `waf`, `reverse-proxy`, `load-balancer`, `dashboard`).
- Awesome‑listings (`awesome-haproxy`, `awesome-selfhosted`).
- Каталог `linuxserver.io` / `selfh.st`.

---

## 15. CI/CD и качество

- **GitHub Actions**:
  - `pr.yml`: lint (eslint, biome), typecheck, unit‑тесты, build, e2e (Playwright + ephemeral compose), security‑scan (CodeQL, Trivy, Gitleaks).
  - `release.yml`: при теге — multi‑arch образы (linux/amd64, linux/arm64) в GHCR, SBOM, подпись Cosign, GitHub Release.
- **Pre‑commit** (Lefthook или Husky): biome, lint, gitleaks, conventional‑commit lint.
- **Тестовое покрытие**: бекенд ≥ 70%, агент ≥ 60%, фронт критические flows e2e.
- **Performance‑бюджеты** (Lighthouse CI) для веба.
- **Renovate** для автоматических апдейтов зависимостей.
- **OpenAPI diff** в PR: ломающие изменения помечаются.

---

## 16. Дорожная карта

### MVP (v0.1, ~3 мес от старта)

- Аутентификация (локальная) + одна организация + RBAC base.
- Одна нода: подключение через DPAPI, импорт существующего конфига.
- HTTP/HTTPS Proxy Hosts (NPM‑like wizard) + Stream Hosts (TCP).
- Сертификаты: ручная загрузка + ACME HTTP‑01 + **ACME DNS‑01 через Cloudflare с поддержкой wildcard (`*.example.com`)**, мастер с пошаговой инструкцией по получению API‑токена.
- Live tail логов, базовые метрики (HAProxy stats).
- Apply через DPAPI с транзакцией; git‑история конфигов.
- Docker compose dev + prod.
- Документы сообщества и AGPL.

### v0.5

- Multi‑node + Active/Active кластер, peer sync stick‑tables.
- ACME DNS‑01 расширение пула провайдеров (Route53, Hetzner, Yandex Cloud, RU‑центр), общая авторотация.
- Maps / ACL / Stick‑tables editor.
- Audit log + diff‑viewer + rollback.
- Notifications (email/TG/Slack) + webhooks.
- OIDC SSO.

### v1.0

- HA с Keepalived/VRRP wizard.
- WAF‑модуль (ModSecurity SPOA + CRS UI).
- Backups (S3) и restore.
- Полный Advanced‑режим всех HAProxy‑сущностей, log‑format builder, errorfile editor.
- Prometheus dashboards внутри панели.
- mTLS frontends, CRL/OCSP.
- CLI `hapilotctl`.

### v2.0

- Service discovery (Consul/Nomad/k8s).
- Helm chart, Operator (CRD `Cluster`/`Frontend`/`Backend`).
- Marketplace шаблонов (готовые конфиги для Postgres‑HA, RabbitMQ, MinIO и т.д.).
- Pro‑модуль (опционально, EE‑репозиторий): SSO Enterprise, multi‑tenant billing, SAML, advanced WAF rule packs.

---

## 17. Риски и открытые вопросы

| Риск / вопрос | Мера / комментарий |
|---|---|
| **DPAPI feature‑lag** для конкретных директив (не всё доступно через API) | Поддержка fallback‑режима: рендер `haproxy.cfg` + копирование на ноду + `haproxy -c -f` + reload через unix‑socket. |
| **Версии HAProxy ≥ 2.4** имеют разные DPAPI | Capability‑detection в агенте, в UI скрываем недоступные опции. |
| **AGPL может отпугивать корпоратов** | Готовим Commercial License FAQ; основной open‑core всё равно AGPL. |
| **Стоит ли поддерживать nginx/apache как Roxy‑WI** | Решение «нет в MVP», переоценить после v1 на основании запросов. |
| **NestJS vs Go для бекенда** | Выбран NestJS из‑за общего TS‑стека и быстрой разработки CRUD/OpenAPI. Heavy‑lift (агент, ACME воркеры) — Go, где это критично. |
| **Хранение приватных ключей сертификатов** | Всегда зашифровано приложенческим ключом + опция «store on agent only» (ключ не покидает ноду). |
| **Конфликт одновременных правок** | Optimistic locking уже есть в DPAPI; на уровне UI — версия конфига и блокировка commit при mismatch. |
| **Поддержка QUIC/HTTP3** | Зависит от сборки HAProxy с QUIC; в UI — фича‑флаг по `haproxy -vv`. |
| **Совместимость с уже существующими `haproxy.cfg`** | Парсер на стороне агента (Go, на базе `go-haproxy-config`/`config-parser` haproxytech) + best‑effort: нераспознанные директивы — сохраняем «as is» в raw‑блоке. |

---

## Приложения

### A. Источники и референсы

- HAProxy Data Plane API — <https://www.haproxy.com/documentation/haproxy-data-plane-api/>
- HAProxy DPAPI on GitHub — <https://github.com/haproxytech/dataplaneapi>
- HAProxy Management Guide — <https://docs.haproxy.org/2.9/management.html>
- HAProxy ACL guide — <https://www.haproxy.com/blog/introduction-to-haproxy-acls>
- HAProxy stick tables — <https://www.haproxy.com/blog/introduction-to-haproxy-stick-tables>
- Roxy‑WI — <https://roxy-wi.org/> · <https://github.com/roxy-wi/roxy-wi>
- BunkerWeb — <https://www.bunkerweb.io/> · <https://github.com/bunkerity/bunkerweb>
- Nginx Proxy Manager — <https://nginxproxymanager.com/> · <https://github.com/NginxProxyManager/nginx-proxy-manager>
- HeroUI — <https://www.heroui.com/>
- Vite — <https://vite.dev/>
- NestJS — <https://docs.nestjs.com/>

### B. Чек‑лист готовности к публикации репозитория

- [ ] LICENSE (AGPL‑3.0) и NOTICE
- [ ] README.md с quickstart и скринкастом
- [ ] CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, SUPPORT.md, GOVERNANCE.md
- [ ] .github/ISSUE_TEMPLATE/* и PULL_REQUEST_TEMPLATE.md
- [ ] CI: lint/test/build/security‑scan/release pipelines
- [ ] Multi‑arch образы в GHCR, подпись Cosign
- [ ] SBOM в релизе
- [ ] DCO bot включён
- [ ] Discussions включены, Discord/Matrix чат
- [ ] docs/ полная архитектура и ADR ≥ 5 шт
- [ ] try.hapilot.dev демо‑инстанс
- [ ] Renovate, Dependabot, CodeQL включены
