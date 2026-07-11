# Deployment

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

## Release gates

- `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
- Bridge tests pass under JDK 21 on every desktop packaging target.
- Database migrations succeed against a clean database and a copy of staging.
- Browser tests cover desktop/mobile Chromium, Firefox, and WebKit.
- Provider outages do not erase canonical library or progress data.
- Production has no `x-user-id` authentication path and no public EPUB bucket.

## Bridge publishing

Build and sign installers independently for Windows, macOS, and Linux. Publish checksums and code-signing identities. The user supplies their own HTTPS/private-network endpoint. Do not operate a shared cloud extension runtime or relay third-party media through HAO Cloud.
