#!/usr/bin/env bash
# Генерация секретов в deploy/docker/.env.
# Идемпотентен: уже выставленные значения не перезаписываются.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
EXAMPLE_FILE="${ROOT_DIR}/env.example"

if [[ ! -f "${ENV_FILE}" ]]; then
  cp "${EXAMPLE_FILE}" "${ENV_FILE}"
  echo "Created ${ENV_FILE} from env.example"
fi

gen_b64() {
  # 32 байта в base64url без переносов
  openssl rand -base64 32 | tr -d '\n'
}

set_if_default() {
  local key="$1"
  local value="$2"
  local current
  current="$(grep -E "^${key}=" "${ENV_FILE}" | tail -n1 | cut -d= -f2- || true)"
  if [[ -z "${current}" || "${current}" == change-me* ]]; then
    if grep -qE "^${key}=" "${ENV_FILE}"; then
      sed -i.bak "s|^${key}=.*|${key}=${value}|" "${ENV_FILE}"
    else
      echo "${key}=${value}" >> "${ENV_FILE}"
    fi
    echo "  set ${key}"
  else
    echo "  keep ${key} (already set)"
  fi
}

echo "Generating secrets in ${ENV_FILE}:"
set_if_default DB_PASSWORD     "$(gen_b64 | tr -d '/+=' | head -c 24)"
set_if_default JWT_SECRET      "$(gen_b64)"
set_if_default ENCRYPTION_KEY  "$(gen_b64)"

# чистим .env.bak от sed на macOS
rm -f "${ENV_FILE}.bak"

echo "Done. Review ${ENV_FILE} and run: docker compose -f deploy/docker/compose.yml --env-file ${ENV_FILE} up -d"
