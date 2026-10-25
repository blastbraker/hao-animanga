# Public browsing and invite-code accounts

Guests can browse Home, Discover, manga/novel metadata, and AniList title pages.
Playback, chapter text/images, personal library, uploads, settings, and admin APIs
require an account. Guest pages never read local resume history or connect to a
Bridge. Sign-in/signup preserve a safe same-site destination.

Set `HAO_BETA_INVITE_CODE_HASH` in the API's **server-only** production environment
to the SHA-256 hex digest of the chosen code. Do not use a `NEXT_PUBLIC_` variable.
Remove it to stop new code-based registrations. Changing it invalidates the old
code for new registrations, without affecting existing accounts.

Apply both `20261025000100_beta_signup_throttle.sql` and
`20261025000200_defer_invite_check.sql` first. The invitation check runs at
transaction commit because Supabase Admin writes app metadata after inserting
the auth row. Keep Supabase public signup
disabled. `/v1/auth/signup` validates the code, consumes shared PostgreSQL limits
(5 attempts/IP/hour, 3/email/hour, 100 total/hour), and uses Supabase Admin to
create a **member**. A database trigger rejects direct client signup even if the
dashboard toggle is accidentally changed. Existing accounts and passwords are
never overwritten. Passwords, invite codes, raw IPs, and emails are not logged
by this flow. Throttle identifiers are hashed and old entries are pruned.

Like the existing admin-created beta accounts, these accounts can sign in
immediately without an email confirmation link. The invite code authorizes beta
membership; **it does not prove ownership of the email address**. Before a wider
public launch, add verified email/OTP and anti-bot protection. A shared code can
be forwarded; it is not a per-person invitation or identity check.

## Bridge deployment

Build/restart the Bridge **after** deploying the API and web client. A Bridge
configured with an HTTPS `HAO_WEB_ORIGIN` requires signed `bridge:read` passes
from that origin's API. `/health` reports `viewerProtected: true`. Public
thumbnails and health remain readable; source catalogs, playback, subtitles,
manga pages, novel content, and narration require a pass. Management still
requires the separate local administrator token; viewer passes cannot manage
extensions or pair devices. Local-only development without an HTTPS origin
keeps the existing development behavior; do not publicly expose that mode.

The API checks authenticated membership and Bridge access before issuing a
device-bound Ed25519 pass. Only public verification keys leave the API. Neither
Supabase bearer tokens nor cloud secrets are sent to the Bridge/extension hosts.
Native media URLs carry a pass in their query, including nested HLS playlists;
never log complete media URLs. Access passes last six hours to avoid interrupting
long movies/read-aloud sessions. Revoking an account prevents new passes; an
already-issued pass can remain usable until it expires. Signing-key rotation
invalidates all passes after the Bridge's public-key cache refresh (30 minutes),
or immediately after restarting the Bridge. Passes are not DRM: an authorized
viewer can copy content/URLs during their validity window.

## Checks

- Guest Home/search/title load; guest playback and library show sign-in prompts.
- Deep-link sign-in returns to the same episode/title; invalid external `next`
  URLs return home.
- Wrong/missing invite, weak password, injected role, duplicate account, and
  throttled requests do not create accounts.
- Anonymous private APIs and Bridge media return 401; altered, expired, wrong
  device, and wrong-scope passes fail. HLS child requests preserve the pass.
- Existing members/admins retain their roles and current playback during token
  refresh. Check native Safari HLS after a Bridge restart.
