# HAO AniManga

HAO is a provider-independent anime, manga, manhwa, and light-novel archive. This repository contains the installable web app, API, background worker, shared domain/provider contracts, PostgreSQL schema, and the user-owned desktop bridge foundation.

## Run locally

Requirements: Node.js 22+, pnpm 10+, and optionally Docker. The bridge requires JDK 21 and Gradle 8.

```powershell
Copy-Item .env.example .env
pnpm install
pnpm dev
```

The PWA opens at `http://localhost:3000`; the API health check is `http://127.0.0.1:4000/health`. Without cloud credentials, HAO uses an in-memory development account and deterministic catalog fixtures while retaining live AniList search.

Useful commands:

```powershell
pnpm typecheck
pnpm test
pnpm build
gradle -p apps/bridge test
```

## Workspace map

- `apps/web`: Next.js responsive PWA, offline shell, player and reader experiences.
- `apps/api`: Fastify API, AniList adapter, invite/admin and canonical library endpoints.
- `apps/worker`: BullMQ job runner for imports, EPUB processing, health, and title matching.
- `apps/bridge`: Kotlin/JVM user-owned extension bridge and security boundary.
- `packages/domain`: normalized media schemas and matching/progress rules.
- `packages/providers`: stable provider interfaces.
- `packages/database`: PostgreSQL client and typed persistence repository.
- `supabase`: Supabase CLI configuration, authentication trigger, storage policies, and versioned migrations.

To run the complete local backend (Docker required), use `pnpm supabase:start`, copy the printed local keys into `.env`, and then run `pnpm dev`. Without Supabase variables, the app deliberately uses its isolated development identity and in-memory API stores.

Read [architecture](docs/ARCHITECTURE.md), [security](docs/SECURITY.md), and [deployment](docs/DEPLOYMENT.md) before connecting real providers.

## Extension boundary

HAO does not include, host, endorse, or operate third-party content repositories. Extension repository URLs must be supplied and acknowledged by the user. APK execution is restricted to a device the user controls. The Aniyomi compatibility executor is deliberately disabled until its fixture-APK conformance and process-sandbox tests pass.

The first repository milestone is available from **Settings**: start the Bridge on the same computer, pair it with HAO, paste an HTTPS Aniyomi/Mihon repository index, review the parsed packages, accept the disclaimer, and save it to the account. In local development the Bridge endpoint defaults to `http://127.0.0.1:4568`; non-loopback endpoints must use HTTPS. Repository discovery and storage are implemented, but installing or executing repository APKs is not yet enabled.

AllManga scraping is intentionally excluded.
