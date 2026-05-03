# Contributing to HAFlux

Спасибо за интерес. Любая помощь приветствуется — багрепорты, PR, документация, переводы.

## Перед стартом

- Прочитайте [README](README.md) — там общая архитектура и quickstart.
- Откройте issue на обсуждение крупных изменений до начала работы.

## Окружение

```bash
node --version   # >= 20.18
pnpm --version   # >= 9.15
go version       # >= 1.22
docker --version
```

```bash
git clone https://github.com/haflux/haflux.git
cd haflux
pnpm install
cp deploy/docker/env.example deploy/docker/.env
./deploy/docker/scripts/init-secrets.sh
docker compose -f deploy/docker/compose.yml -f deploy/docker/compose.dev.yml --env-file deploy/docker/.env up
```

В dev‑compose монтируются исходники с hot‑reload для `api` и `web`.

## Правила

- **Conventional Commits** — `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`. Это используется для автоматических changelog/релизов.
- **DCO** — каждый коммит подписан `Signed-off-by:` (`git commit -s`).
- **Линт перед коммитом** — `pnpm lint && pnpm typecheck`.
- Тесты к новой логике обязательны (юнит для бизнес‑правил, e2e для роутов).
- Один PR — одна тема. Не смешивайте рефакторинги с фичами.
- Ломающие API‑изменения помечаются в описании PR явно.

## Процесс ревью

- CI должен быть зелёным.
- Минимум одно approve от ментейнера.
- После апрува — `Squash and merge`. Заголовок merge‑коммита соответствует Conventional Commits.

## Issue templates

При создании issue выберите подходящий шаблон в `.github/ISSUE_TEMPLATE`. Прикладывайте версии (HAProxy, HAFlux, OS) и шаги воспроизведения.

## Безопасность

Сообщения об уязвимостях — приватно через канал в [`SECURITY.md`](SECURITY.md), а не публичный issue.
