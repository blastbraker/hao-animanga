# Deployment

HAO's invite-only beta is designed to run without a credit card while usage stays inside the providers' free-tier limits.

Production Supabase project: `HAO AniManga Beta` (`jdtdtcprborbwwqjebgp`, East US/North Virginia).

## Zero-cost services

- PWA and JSON API: one Vercel Hobby project using `vercel.json`. The Fastify API is mounted at `/api/v1` through a Next.js serverless route.
- Data, invitation authentication, and private EPUB storage: Supabase Free with versioned migrations in `supabase/migrations`.
- Background work: EPUB validation is completed inside the upload request. Catalog reads are fetched on demand. Supabase Cron/Edge Functions can be added later if a real asynchronous job is introduced.
- Extension execution: each user's HAO Bridge. Third-party APKs and media never execute in or transit HAO's cloud.

Fly.io and managed Redis are not part of the free beta deployment. The legacy worker package remains an optional local development harness and stays idle when `REDIS_URL` is absent.

## Initial setup

1. Run `pnpm dlx supabase login`, then link the repository with `pnpm dlx supabase link --project-ref jdtdtcprborbwwqjebgp`.
2. Apply migrations with `pnpm supabase:push`. Confirm the private EPUB bucket, owner-only object policies, and `bridge_pairing_codes` table exist.
3. Import this repository into one Vercel Hobby project. Keep the repository root as the project root; `vercel.json` selects the web build.
4. Configure these Vercel variables for Production and Preview:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `DATABASE_URL` using Supabase's transaction-pooler connection string
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ENCRYPTION_KEY` with at least 32 random characters
   - Optional `WEB_ORIGIN` for the stable production URL; Vercel previews use same-origin API calls without CORS.
5. Keep public sign-up disabled in Supabase Authentication. Add the production Vercel URL and `/auth/callback` to the allowed redirect URLs.
6. Invite the first identity in Supabase, then set that profile's `role` to `admin` in the SQL editor. All later invitations can be sent from HAO's admin console.
7. Deploy and verify `/api/v1/health`, invitation sign-in, member denial at `/admin`, two-account library/progress isolation, Bridge pairing, repository installation, reading, and playback.

## Automated deployment

Vercel's Git integration builds every push to `main`. The optional **Deploy staging** GitHub workflow applies Supabase migrations first and then performs a Vercel production deployment. It requires:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_PROJECT_REF`
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

Do not expose `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, or `ENCRYPTION_KEY` as `NEXT_PUBLIC_*` variables or commit them to Git.

## Free-tier boundaries

- This setup is for a personal, non-commercial, small invite-only beta.
- Vercel and Supabase can pause or throttle the app when their free quotas are exceeded; there are no paid overages in this configuration.
- The serverless rate limiter is best-effort per warm function instance. Invitation-only authentication and database authorization remain the primary abuse boundary for this beta.
- The Vercel request-size limit applies to API uploads. Large EPUB uploads should use Supabase's owner-only direct upload flow before expanding the beta.
- There is no uptime SLA. Cold starts and provider sleep are expected.

## Release gates

- `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
- The production build refuses missing Supabase, database, or encryption configuration.
- Bridge tests pass under JDK 21 on every desktop packaging target.
- Database migrations succeed against a clean database and a copy of staging.
- Browser tests cover desktop/mobile Chromium, Firefox, and WebKit.
- Provider outages do not erase canonical library or progress data.
- Production has no `x-user-id` authentication path and no public EPUB bucket.

## Bridge publishing

Build and sign installers independently for Windows, macOS, and Linux. Publish checksums and code-signing identities. The user supplies their own HTTPS/private-network endpoint. Do not operate a shared cloud extension runtime or relay third-party media through HAO Cloud.
