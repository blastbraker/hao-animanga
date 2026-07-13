# Deployment

Production Supabase project: `HAO AniManga Beta` (`jdtdtcprborbwwqjebgp`, East US/North Virginia).

## Managed services

- Web: Vercel using `vercel.json`.
- API and worker: separate Fly.io applications built from their Dockerfiles.
- Data/auth/storage: Supabase project with versioned migrations in `supabase/migrations`.
- Queue/rate limits: managed Redis using TLS.

## Initial setup

1. Create Supabase development, staging, and production projects.
2. Link the repository with `pnpm dlx supabase link --project-ref <project-ref>` and apply both migrations with `pnpm supabase:push`.
3. Confirm the migrations created the private EPUB bucket and owner-only object policies.
4. Configure the variables in `.env.example` as platform secrets.
5. Generate a 32-byte encryption key through the deployment secret manager; never commit it.
6. Deploy the API, confirm `/health`, then deploy the worker and PWA.
7. Set the PWA API URL and API `WEB_ORIGIN` to their final HTTPS origins.
8. Invite the first identity in Supabase, then set that profile's `role` to `admin` directly in the SQL editor. All later invitations can be issued from the HAO admin console.

## Staging setup checklist

1. Keep public sign-up disabled in Supabase Authentication. Add the final web origin and `/auth/callback` URL to the allowed redirect URLs.
2. Create `hao-api` and `hao-worker` Fly applications, then set their secrets from `.env.production.example`. Never expose the service-role, database, Redis, or encryption secrets to Vercel.
3. Create the Vercel project from this repository and configure `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for Production.
4. Set `WEB_ORIGIN` on Fly to the exact Vercel HTTPS origin. Multiple origins must be comma-separated HTTPS URLs.
5. Configure the GitHub `staging` environment with `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`, `FLY_API_TOKEN`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`.
6. Run the **Deploy staging** workflow manually. It applies migrations first, then deploys the API/worker, and finally deploys the web app.
7. Confirm `/health`, sign in through an invitation, verify that a member cannot open `/admin`, and test two accounts for library/progress isolation.

Production startup is intentionally fail-closed. The API refuses to start without PostgreSQL, Supabase administration, a 32-character encryption secret, and an HTTPS web origin. Vercel builds refuse missing public API/Supabase configuration. The development `x-user-id` identity is rejected whenever `NODE_ENV=production`.

## Release gates

- `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
- Bridge tests pass under JDK 21 on every desktop packaging target.
- Database migrations succeed against a clean database and a copy of staging.
- Browser tests cover desktop/mobile Chromium, Firefox, and WebKit.
- Provider outages do not erase canonical library or progress data.
- Production has no `x-user-id` authentication path and no public EPUB bucket.

## Bridge publishing

Build and sign installers independently for Windows, macOS, and Linux. Publish checksums and code-signing identities. The user supplies their own HTTPS/private-network endpoint. Do not operate a shared cloud extension runtime or relay third-party media through HAO Cloud.
