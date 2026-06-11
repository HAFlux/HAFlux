#!/usr/bin/env bash
# HAFlux installer.
#
#   curl -fsSL https://raw.githubusercontent.com/HAFlux/HAFlux/main/install.sh | sudo bash
#
# Что делает:
#   - Проверяет: Debian/Ubuntu, root.
#   - Ставит Docker engine + compose plugin (если отсутствует).
#   - Тюнит sysctl/nofile под HAProxy.
#   - Готовит /opt/haflux: compose.yml + .env + haproxy-data/.
#   - Генерирует секреты (jwt, encryption, db, root password) — идемпотентно.
#   - Тянет готовый образ ghcr.io/haflux/api:latest и поднимает стек.
#   - Печатает URL + email + password один раз в конце.
#
# Никакой сборки на клиенте: весь api образ уже опубликован релизом в GHCR.
# Если pull не сработал (например, пакет приватный) — install прерывается с
# подсказкой, как сделать пакет публичным.
#
# Переменные окружения для override (необязательно):
#   HAFLUX_INSTALL_DIR   default /opt/haflux
#   HAFLUX_WEB_PORT      default 8080            # порт панели (https, self-signed)
#   HAFLUX_API_PORT      default 3000
#   HAFLUX_API_TAG       default latest          # тег ghcr.io/haflux/api
#   HAFLUX_API_IMAGE     полный image override (для приватного registry)
#   HAFLUX_PUBLIC_HOST   default <первый IPv4>
#   HAFLUX_ROOT_EMAIL    default admin@haflux.local
#   HAFLUX_ROOT_PASSWORD задаёт корневой пароль явно (вместо сгенерированного)

set -euo pipefail

INSTALL_DIR="${HAFLUX_INSTALL_DIR:-/opt/haflux}"
WEB_PORT="${HAFLUX_WEB_PORT:-8080}"
API_PORT="${HAFLUX_API_PORT:-3000}"
API_TAG="${HAFLUX_API_TAG:-latest}"
API_IMAGE="${HAFLUX_API_IMAGE:-ghcr.io/haflux/api:${API_TAG}}"
ROOT_EMAIL="${HAFLUX_ROOT_EMAIL:-admin@haflux.local}"

log()  { echo "[haflux] $*"; }
warn() { echo "[haflux] [warn] $*" >&2; }
fail() { echo "[haflux] [error] $*" >&2; exit 1; }

# ─── pre-flight ──────────────────────────────────────────────────────
require_root() {
  [[ ${EUID:-$(id -u)} -eq 0 ]] || fail "Запуск нужен от root. Префиксни: sudo bash"
}

require_apt() {
  command -v apt-get >/dev/null 2>&1 \
    || fail "Скрипт работает только на Debian/Ubuntu (apt-based). Для других дистрибутивов поднимай руками — см. deploy/docker/README.md"
}

# На cloud-образах сразу после загрузки фоном крутится unattended-upgrades,
# держа /var/lib/dpkg/lock-frontend. Любой apt-get -y тогда падает с
# `Could not get lock`. Ждём освобождения до 10 минут.
wait_for_apt() {
  local waited=0 max=600
  while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 \
     || fuser /var/lib/dpkg/lock          >/dev/null 2>&1 \
     || fuser /var/lib/apt/lists/lock     >/dev/null 2>&1; do
    if (( waited == 0 )); then
      log "Ждём dpkg/apt lock (вероятно, unattended-upgrades после первого boot)..."
    fi
    sleep 5
    waited=$((waited + 5))
    if (( waited >= max )); then
      fail "dpkg lock не освободился за ${max}s. Проверь: ps -ef | grep -E 'apt|dpkg|unattended'"
    fi
  done
  if (( waited > 0 )); then
    log "dpkg lock освободился через ${waited}s, продолжаю."
  fi
}

ensure_basics() {
  wait_for_apt
  apt-get update -qq
  wait_for_apt
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    ca-certificates curl gnupg openssl
}

# ─── docker ──────────────────────────────────────────────────────────
install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "Docker + compose уже стоят, пропускаю установку."
    return
  fi
  log "Ставлю Docker (официальный репозиторий)..."
  install -m 0755 -d /etc/apt/keyrings
  local distro codename
  distro="$(. /etc/os-release && echo "${ID}")"
  codename="$(. /etc/os-release && echo "${VERSION_CODENAME}")"
  curl -fsSL "https://download.docker.com/linux/${distro}/gpg" \
    | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  cat > /etc/apt/sources.list.d/docker.list <<EOF
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${distro} ${codename} stable
EOF
  wait_for_apt
  apt-get update -qq
  wait_for_apt
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
}

# ─── kernel tuning ───────────────────────────────────────────────────
tune_sysctl() {
  log "Тюню sysctl/nofile под HAProxy..."
  cat > /etc/security/limits.d/99-haflux.conf <<'LIMITS'
* soft nofile 1048576
* hard nofile 1048576
root soft nofile 1048576
root hard nofile 1048576
LIMITS
  cat > /etc/sysctl.d/99-haflux.conf <<'SYSCTL'
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.core.netdev_max_backlog = 65535
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.ipv4.tcp_tw_reuse = 1
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_syncookies = 1
fs.file-max = 2097152
fs.nr_open = 1048576
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
SYSCTL
  sysctl --quiet --load /etc/sysctl.d/99-haflux.conf 2>/dev/null || true
}

# ─── filesystem layout ───────────────────────────────────────────────
ensure_dirs() {
  install -d -m 0755 "$INSTALL_DIR"
  install -d -m 0700 "$INSTALL_DIR/.secrets"
  install -d -m 0755 \
    "$INSTALL_DIR/haproxy-data" \
    "$INSTALL_DIR/haproxy-data/conf.d" \
    "$INSTALL_DIR/haproxy-data/certs" \
    "$INSTALL_DIR/haproxy-data/maps" \
    "$INSTALL_DIR/haproxy-data/acl" \
    "$INSTALL_DIR/haproxy-data/errors" \
    "$INSTALL_DIR/haproxy-data/lua" \
    "$INSTALL_DIR/haproxy-data/spoe"
}

# ─── secrets (idempotent) ────────────────────────────────────────────
# gen_secret <file> <bytes>  — создаёт b64url-секрет, если файла ещё нет.
gen_secret() {
  local file="$1" bytes="${2:-32}"
  if [[ -s "$file" ]]; then return; fi
  ( umask 077; openssl rand -base64 "$bytes" | tr -d '/+=\n' > "$file" )
}

write_secrets() {
  gen_secret "$INSTALL_DIR/.secrets/jwt_secret" 32
  gen_secret "$INSTALL_DIR/.secrets/encryption_key" 32
  gen_secret "$INSTALL_DIR/.secrets/db_password" 24
  if [[ -n "${HAFLUX_ROOT_PASSWORD:-}" ]]; then
    ( umask 077; printf '%s' "$HAFLUX_ROOT_PASSWORD" > "$INSTALL_DIR/.secrets/root_password" )
  else
    gen_secret "$INSTALL_DIR/.secrets/root_password" 18
  fi
}

# ─── haproxy bootstrap config ────────────────────────────────────────
# Генерируем self-signed cert один раз. Панель потом заменит на нормальные
# Let's Encrypt сертификаты при добавлении proxy host'ов с ACME.
write_self_signed_cert() {
  local cert_dir="$INSTALL_DIR/haproxy-data/certs"
  local cert="$cert_dir/_default.pem"
  [[ -f "$cert" ]] && return
  local pub_host
  pub_host="$(detect_public_host)"
  log "Генерирую self-signed cert для панели :${WEB_PORT} (CN=${pub_host})..."
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  ( umask 077
    openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
      -subj "/CN=${pub_host}" \
      -addext "subjectAltName=DNS:${pub_host},IP:${pub_host}" \
      -keyout "${tmp_dir}/key.pem" \
      -out "${tmp_dir}/cert.pem" \
      >/dev/null 2>&1 || \
    openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
      -subj "/CN=${pub_host}" \
      -keyout "${tmp_dir}/key.pem" \
      -out "${tmp_dir}/cert.pem" \
      >/dev/null 2>&1
    cat "${tmp_dir}/cert.pem" "${tmp_dir}/key.pem" > "$cert"
    chmod 0600 "$cert"
  )
  rm -rf "$tmp_dir"
}

write_bootstrap_cfg() {
  local cfg="$INSTALL_DIR/haproxy-data/haproxy.cfg"
  [[ -f "$cfg" ]] && return
  # Панель слушает ТОЛЬКО кастомный WEB_PORT (https, self-signed).
  # :80 и :443 не биндим: они остаются свободными под proxy host'ы, и
  # приземлённый на сервер домен не светит панель.
  cat > "$cfg" <<HAPROXY
# Bootstrap haproxy.cfg — будет перезаписан HAFlux панелью при первом
# Apply. До этого момента HAProxy слушает только :${WEB_PORT} (self-signed
# TLS) и проксирует и REST (/api/*), и SPA на api контейнер (он сам
# отдаёт статику). :80/:443 свободны под будущие proxy host'ы.
global
  maxconn 4000
  log stdout local0 info
  ssl-default-bind-options ssl-min-ver TLSv1.2 no-tls-tickets

defaults
  mode http
  log global
  option httplog
  option dontlognull
  timeout connect 5s
  timeout client  30s
  timeout server  60s

frontend fe_panel
  bind *:${WEB_PORT} ssl crt /etc/haproxy/certs/_default.pem alpn h2,http/1.1
  default_backend be_panel

backend be_panel
  option httpchk GET /health
  server api 127.0.0.1:${API_PORT} check
HAPROXY
}

# ─── compose layout ──────────────────────────────────────────────────
detect_public_host() {
  if [[ -n "${HAFLUX_PUBLIC_HOST:-}" ]]; then
    echo "$HAFLUX_PUBLIC_HOST"
    return
  fi
  # Если установка через SSH — используем тот IP, к которому подключились.
  if [[ -n "${SSH_CONNECTION:-}" ]]; then
    awk '{print $3}' <<<"$SSH_CONNECTION"
    return
  fi
  # На multi-interface VPS `hostname -I` часто отдаёт приватный адрес.
  # Cпрашиваем внешний IP через публичный echo-сервис.
  local ip
  ip="$(curl -fsS -m 3 https://api.ipify.org 2>/dev/null \
        || curl -fsS -m 3 https://ifconfig.me 2>/dev/null \
        || curl -fsS -m 3 https://icanhazip.com 2>/dev/null \
        || true)"
  if [[ -n "$ip" ]]; then
    echo "$ip"
    return
  fi
  # Fallback: первый IPv4 интерфейса.
  hostname -I 2>/dev/null | awk '{print $1}' | head -n1 || hostname
}

write_env() {
  local public_host
  public_host="$(detect_public_host)"
  ( umask 077; cat > "$INSTALL_DIR/.env" <<ENV
PUBLIC_HOST=${public_host}
WEB_PORT=${WEB_PORT}
API_PORT=${API_PORT}
ALLOWED_ORIGINS=https://${public_host}:${WEB_PORT}

POSTGRES_DB=haflux
POSTGRES_USER=haflux
DB_PASSWORD=$(cat "$INSTALL_DIR/.secrets/db_password")

JWT_SECRET=$(cat "$INSTALL_DIR/.secrets/jwt_secret")
ENCRYPTION_KEY=$(cat "$INSTALL_DIR/.secrets/encryption_key")

BOOTSTRAP_ROOT_EMAIL=${ROOT_EMAIL}
BOOTSTRAP_ROOT_PASSWORD=$(cat "$INSTALL_DIR/.secrets/root_password")

HAFLUX_API_TAG=${API_TAG}
ENV
  )
}

# Compose.yml — pull-only. Никакой build-секции: api тянется готовым
# из ghcr.io релизом. Если хочется собрать локально — это путь
# `git clone && docker compose -f deploy/docker/compose.yml ... up --build`,
# но не через install.sh.
write_compose() {
  cat > "$INSTALL_DIR/compose.yml" <<COMPOSE
# Сгенерировано install.sh. Pull-only: api тянется готовым из ghcr.io.

services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: \${POSTGRES_DB}
      POSTGRES_USER: \${POSTGRES_USER}
      POSTGRES_PASSWORD: \${DB_PASSWORD}
    volumes:
      - db_data:/var/lib/postgresql/data
    networks: [internal]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER} -d \${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--save", "60", "1", "--loglevel", "warning"]
    volumes:
      - redis_data:/data
    networks: [internal]

  api:
    image: \${HAFLUX_API_IMAGE:-ghcr.io/haflux/api:\${HAFLUX_API_TAG:-latest}}
    pull_policy: missing
    restart: unless-stopped
    environment:
      NODE_ENV: production
      PORT: ${API_PORT}
      WEB_PORT: \${WEB_PORT}
      DATABASE_URL: postgres://\${POSTGRES_USER}:\${DB_PASSWORD}@db:5432/\${POSTGRES_DB}
      REDIS_URL: redis://redis:6379
      JWT_SECRET: \${JWT_SECRET}
      ENCRYPTION_KEY: \${ENCRYPTION_KEY}
      ALLOWED_ORIGINS: \${ALLOWED_ORIGINS}
      BOOTSTRAP_ROOT_EMAIL: \${BOOTSTRAP_ROOT_EMAIL}
      BOOTSTRAP_ROOT_PASSWORD: \${BOOTSTRAP_ROOT_PASSWORD}
      HAPROXY_CONTAINER_NAME: haproxy-balancer
    depends_on:
      db: { condition: service_healthy }
      redis: { condition: service_started }
    networks: [internal, edge]
    ports:
      - "127.0.0.1:${API_PORT}:${API_PORT}"
    # api крутится в своей network namespace; host.docker.internal -> host-gateway,
    # чтобы health-probe мог достучаться до 127.0.0.1 хоста (где слушают upstream'ы
    # юзера и HAProxy). Без этого 127.0.0.1 в ProxyHost ведёт в пустоту контейнера.
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - ./haproxy-data:/haproxy-data
      - /var/run/docker.sock:/var/run/docker.sock:ro

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
      nofile:
        soft: 1048576
        hard: 1048576
    restart: unless-stopped

volumes:
  db_data: {}
  redis_data: {}

networks:
  edge: {}
  internal:
    internal: true
COMPOSE
}

# ─── deployment ──────────────────────────────────────────────────────
deploy() {
  log "Тяну ${API_IMAGE}..."
  if ! docker pull "$API_IMAGE" 2>&1 | tee /tmp/haflux-pull.log >/dev/null; then
    cat >&2 <<MSG

[haflux] [error] Не удалось скачать ${API_IMAGE}.

Возможные причины:
  1. Релиз ещё не собрался — посмотри https://github.com/HAFlux/HAFlux/actions
  2. Пакет в GHCR приватный по умолчанию. Сделай его публичным:
       https://github.com/users/HAFlux/packages/container/api/settings
       → Danger Zone → Change visibility → Public
  3. Сетевая проблема. Подробности в /tmp/haflux-pull.log:

$(tail -5 /tmp/haflux-pull.log 2>/dev/null | sed 's/^/    /')

Override через HAFLUX_API_IMAGE (например свой private registry):
  curl -fsSL https://raw.githubusercontent.com/HAFlux/HAFlux/main/install.sh \\
    | sudo HAFLUX_API_IMAGE=registry.example.com/haflux/api:1.0 bash
MSG
    exit 1
  fi
  log "Поднимаю стек..."
  docker compose -f "$INSTALL_DIR/compose.yml" --env-file "$INSTALL_DIR/.env" \
    up -d --remove-orphans
}

wait_healthy() {
  local i
  for ((i = 0; i < 60; i++)); do
    if curl -fsSk -m 3 "https://127.0.0.1:${WEB_PORT}/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# Пишем CLI-помощник /usr/local/bin/haflux: показывает URL/email/password,
# статус контейнеров, поднимает/опускает стек.
install_cli() {
  cat > /usr/local/bin/haflux <<'CLI'
#!/usr/bin/env bash
# HAFlux CLI — установлен install.sh. Управление single-host инсталляцией.
set -euo pipefail

INSTALL_DIR="${HAFLUX_INSTALL_DIR:-__INSTALL_DIR__}"
COMPOSE="docker compose -f ${INSTALL_DIR}/compose.yml --env-file ${INSTALL_DIR}/.env"

usage() {
  cat <<'USAGE'
HAFlux CLI

Использование:
  sudo haflux info     — показать URL / email / password / статус контейнеров
  sudo haflux status   — статус контейнеров (docker compose ps)
  sudo haflux logs     — стримить логи (Ctrl+C — выход)
  sudo haflux up       — поднять стек (после reboot/down)
  sudo haflux down     — остановить и удалить контейнеры (volumes сохранятся)
  sudo haflux pull     — обновить api образ из ghcr.io и перезапустить
  sudo haflux restart  — рестартануть контейнеры
USAGE
}

bold() { tput bold 2>/dev/null || true; }
norm() { tput sgr0 2>/dev/null || true; }
detect_host() {
  if [[ -n "${HAFLUX_PUBLIC_HOST:-}" ]]; then echo "$HAFLUX_PUBLIC_HOST"; return; fi
  if [[ -n "${SSH_CONNECTION:-}" ]]; then awk '{print $3}' <<<"$SSH_CONNECTION"; return; fi
  curl -fsS -m 2 https://api.ipify.org 2>/dev/null \
    || curl -fsS -m 2 https://ifconfig.me 2>/dev/null \
    || hostname -I 2>/dev/null | awk '{print $1}' | head -n1 \
    || hostname
}

cmd_info() {
  local pub_host rootpw email port
  pub_host="$(detect_host)"
  if [[ -r "${INSTALL_DIR}/.secrets/root_password" ]]; then
    rootpw="$(cat "${INSTALL_DIR}/.secrets/root_password")"
  else
    rootpw="(файл ${INSTALL_DIR}/.secrets/root_password недоступен — запусти из-под root)"
  fi
  email="$(grep -E "^BOOTSTRAP_ROOT_EMAIL=" "${INSTALL_DIR}/.env" 2>/dev/null | cut -d= -f2- || echo "admin@haflux.local")"
  port="$(grep -E "^WEB_PORT=" "${INSTALL_DIR}/.env" 2>/dev/null | cut -d= -f2- || echo "8080")"

  echo
  echo "$(bold)──────────────────────────────────────────────────────────$(norm)"
  echo "$(bold)HAFlux access$(norm)"
  echo "$(bold)──────────────────────────────────────────────────────────$(norm)"
  echo
  echo "  URL:      $(bold)https://${pub_host}:${port}$(norm)  (self-signed)"
  echo "  Email:    $(bold)${email}$(norm)"
  echo "  Password: $(bold)${rootpw}$(norm)"
  echo
  echo "  Файл с паролем: ${INSTALL_DIR}/.secrets/root_password (0600)"
  echo
  echo "$(bold)Containers:$(norm)"
  $COMPOSE ps 2>/dev/null || echo "  стек не запущен — sudo haflux up"
  echo
}

case "${1:-info}" in
  info|"")    cmd_info ;;
  status|ps)  $COMPOSE ps ;;
  logs)       shift || true; $COMPOSE logs -f "$@" ;;
  up)         $COMPOSE up -d --remove-orphans ;;
  down)       $COMPOSE down ;;
  restart)    $COMPOSE restart "${@:2}" ;;
  pull)       $COMPOSE pull && $COMPOSE up -d --remove-orphans ;;
  -h|--help|help) usage ;;
  *)          usage; exit 1 ;;
esac
CLI
  sed -i "s|__INSTALL_DIR__|${INSTALL_DIR}|g" /usr/local/bin/haflux
  chmod +x /usr/local/bin/haflux
}

print_banner() {
  local pub_host rootpw bold='' norm='' url
  pub_host="$(detect_public_host)"
  rootpw="$(cat "$INSTALL_DIR/.secrets/root_password")"
  if [[ -t 1 ]]; then
    bold="$(tput bold 2>/dev/null || true)"
    norm="$(tput sgr0 2>/dev/null || true)"
  fi
  # Панель слушает только кастомный WEB_PORT — :80/:443 свободны под
  # proxy host'ы, и приземлённый домен не показывает панель.
  cat <<BANNER

${bold}══════════════════════════════════════════════════════════${norm}
${bold}                  HAFlux control-plane is up${norm}
${bold}══════════════════════════════════════════════════════════${norm}

  ${bold}URL${norm}:      ${bold}https://${pub_host}:${WEB_PORT}${norm}  (self-signed)
  ${bold}Email${norm}:    ${bold}${ROOT_EMAIL}${norm}
  ${bold}Password${norm}: ${bold}${rootpw}${norm}

  Сохранено: ${INSTALL_DIR}/.secrets/root_password (0600)

${bold}Чтобы посмотреть доступы ещё раз:${norm}
  sudo haflux info

${bold}Управление:${norm}
  sudo haflux status | logs | up | down | restart | pull

При повторном запуске install.sh секреты и пароль НЕ ротируются;
пароль из env используется только при ПЕРВОМ старте api.
${bold}══════════════════════════════════════════════════════════${norm}

BANNER
}

main() {
  require_root
  require_apt
  ensure_basics
  install_docker
  tune_sysctl
  ensure_dirs
  write_secrets
  write_self_signed_cert
  write_bootstrap_cfg
  write_env
  write_compose
  install_cli
  deploy
  if ! wait_healthy; then
    warn "Стек поднят, но /health не ответил за 2 минуты. Проверь:"
    warn "  docker compose -f ${INSTALL_DIR}/compose.yml --env-file ${INSTALL_DIR}/.env logs api"
  fi
  print_banner
}

main "$@"
