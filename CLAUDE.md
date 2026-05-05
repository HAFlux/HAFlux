## CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

pnpm workspace, three packages that must stay version-aligned:

- `apps/api` — NestJS 11 on Fastify, Prisma + PostgreSQL, Redis + BullMQ. Bundles the SPA at `/app/public` and serves it via `@fastify/static` with an SPA fallback in `apps/api/src/spa.filter.ts`. Global API prefix is `/api/v1` (`/health` is excluded).
- `apps/web` — Vite + React 19 + HeroUI + Tailwind v4 + TanStack Query + i18next. Build output is consumed by `apps/api/Dockerfile`.
- `packages/contracts` — Zod schemas / shared types between api ↔ web. **Build it first** after a fresh install or aliases break in api/web.

Repo is licensed AGPL-3.0-only.

## Common commands

From repo root (Node ≥ 20.18, pnpm ≥ 9.15):

```bash
pnpm install
pnpm --filter @haflux/contracts build   # required after fresh install
pnpm dev                                # api + web in watch mode (parallel)
pnpm lint                               # biome check .
pnpm format                             # biome format --write .
pnpm typecheck                          # tsc --noEmit, recursive
pnpm test                               # vitest run, recursive
pnpm build                              # production build of all packages
```

Per-package:

```bash
pnpm --filter @haflux/api dev           # nest start --watch
pnpm --filter @haflux/api test          # vitest run (api)
pnpm --filter @haflux/api exec vitest run path/to/file.spec.ts   # single test
pnpm --filter @haflux/api prisma:generate
pnpm --filter @haflux/api prisma:migrate:dev
pnpm --filter @haflux/web dev           # vite (default :5173)
pnpm --filter @haflux/web build         # tsc --noEmit && vite build
```

Docker stack (root scripts wrap `deploy/docker/compose.yml`):

```bash
pnpm compose:up      # build + up -d
pnpm compose:down
pnpm compose:logs
pnpm compose:dev     # adds compose.dev.yml: hot-reload api+web
```

Container build expects `deploy/docker/.env` — generate with `./deploy/docker/scripts/init-secrets.sh` before first start.

## Backend architecture

Module graph (`apps/api/src/app.module.ts`): `Prisma`, `Health`, `Auth`, `Clusters`, `Certificates`, `Haproxy`, `ProxyHosts`, `Backup`. Validation is global (`whitelist + forbidNonWhitelisted + transform`). CORS origins come from `ALLOWED_ORIGINS` (comma-separated).

The `haproxy` module is the heart of the system. Three layers, in this order:

1. **Renderer** (`haproxy/renderers/cfg.renderer.ts`): pulls a `Cluster` with all relations from Prisma and produces a `RenderedTree` — a `Map<path, string | Buffer>` of files: `haproxy.cfg`, `conf.d/10-resolvers.cfg`…`80-rings.cfg`, plus `maps/`, `acl/`, `errors/`, `lua/`, `spoe/`. **Output must be byte-for-byte deterministic** for the same DB state — config diffs are stored in `ConfigVersion.diffBlob` and used as a git-style history. Anything non-deterministic (Map iteration order, unsorted joins) breaks that contract.
2. **Transports** (`haproxy/transports/`): `LocalTransport` writes into a shared volume; `SshTransport` uses SFTP for files and `ssh exec` for `haproxy -c -f` validate + reload. `TransportFactory.forNode` picks one based on `Node.transport` (`LOCAL` | `SSH`). SSH key is the single `SshKey` row (one per installation).
3. **ApplyService** (`haproxy/apply.service.ts`): per-cluster orchestration — render once, then for each node sequentially: `deploy → validate → reload` (skipped on `dryRun`). On success, persists a `ConfigVersion` (the formatted file tree as `diffBlob`). Rollback on partial failure is currently best-effort (TODO in code).

`ReloadMode` per node decides how reload is performed: `CONTAINER` (docker kill -USR2), `SYSTEMD`, `SIGNAL` (kill -USR2 + pidfile), or `MASTER_CLI` (socat to admin socket). The runtime image installs `docker-cli`, `openssh-client`, and `socat` to support all four.

`ProxyHost` is the NPM-style abstraction (one domain → one upstream). The renderer collapses many ProxyHosts into a shared `:80/:443` frontend with `req.hdr(host)` ACLs → `use_backend` per host. `AccessGroup` adds IP allowlists / Basic Auth and is many-to-many with ProxyHost via `ProxyHostAccessGroup`.

## Data model anchors

Schema lives at `apps/api/prisma/schema.prisma`. A few invariants worth keeping in mind:

- Tenancy: `Organization → Membership → User` with `Role` (permissions JSON). All HAProxy resources hang off `Cluster`, which belongs to an Organization.
- One `HaproxyGlobal` per cluster (`@unique clusterId`); multiple named `HaproxyDefaults`.
- `Bind` is polymorphic over `Frontend | Listen` (only one of `frontendId`/`listenId` set). Same pattern for `ServerEntry` and rule tables (`AclRule`, `HttpRule`, `TcpRule`).
- Certificates store `encryptedPemBlob` (Bytes); SSH key stores `encryptedPrivKey` (Bytes). Decryption envelope uses `ENCRYPTION_KEY` — there's a TODO in `transport.factory.ts` (currently treats the blob as plaintext PEM). Don't ship features assuming decryption already works without checking.
- `ConfigVersion` is append-only history of applied configs (one row per successful apply).

`prisma db push --skip-generate --accept-data-loss` runs at container start (see `apps/api/Dockerfile` CMD) — schema changes go live immediately on deploy. Use proper migrations (`prisma migrate dev`) only for local dev workflows; production currently relies on `db push`.

## Frontend notes

- Auth state in `apps/web/src/lib/auth.ts`, API client in `lib/api.ts`. Pages in `pages/` map 1:1 to backend modules (clusters, certificates, proxy-hosts, access-groups, backup, error-pages).
- App version is injected at build time via `VITE_APP_VERSION` (set by `apps/api/Dockerfile` from the `APP_VERSION` build-arg, which `release.yml` sets to the git tag).
- Theme is monochrome light/dark only — don't introduce accent colors without checking with the maintainer.

## Conventions

- **Conventional Commits** are enforced (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`) — release notes are auto-generated from them. Commits should be `Signed-off-by` (DCO).
- Biome is the only linter/formatter (no ESLint/Prettier). Single quotes, trailing commas, semicolons, 100-col, 2-space indent. `useImportType` is **off** for `apps/api/**` (NestJS DI relies on runtime types in decorators).
- `.nvmrc` pins the Node version — keep changes in sync with `engines` in `package.json`.

## CI / Release

- `.github/workflows/ci.yml`: install → contracts build → biome → tsc → vitest → pnpm build → docker smoke build (with GHA cache). Runs on every PR and on push to `main`.
- `.github/workflows/release.yml`: triggered by `v*.*.*` tags. Builds multi-arch (`amd64`/`arm64`) `ghcr.io/haflux/api`, pushes all semver tags + `latest`, creates a GitHub Release with auto-changelog.
- `.github/workflows/codeql.yml`: TypeScript CodeQL on `main`, PRs to `main`, weekly cron.

Cutting a release is just `git tag vX.Y.Z && git push origin vX.Y.Z`. **GHCR packages default to private** — after the first release, set `ghcr.io/haflux/api` to public, otherwise `install.sh` (which only pulls, never builds locally) fails for end users.
