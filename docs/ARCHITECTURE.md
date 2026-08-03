# Architecture

## Data ownership

`Work` is HAO’s canonical identity. `Edition` represents a season or publication, `ReleaseItem` represents an episode/chapter, and `SourceRecord` preserves provider provenance. A library entry points to `Work`, never directly to an external provider, so progress survives provider changes.

AniList identifiers are strong import references but are not primary keys. Title matching uses normalized titles, media kind, year, and release counts. A high score creates a suggestion; it never silently merges ambiguous works.

## Request flow

1. The PWA authenticates through Supabase and sends its bearer token to the API.
2. Fastify verifies identity, applies quotas, and reads/writes account-scoped PostgreSQL records.
3. Catalog adapters return normalized HAO types and typed failure states.
4. Durable work is queued in Redis and processed by the worker.
5. Private EPUB objects remain in Supabase Storage and are exposed through short-lived signed URLs.
6. Canonical progress and detailed `reading_states` are account-scoped in PostgreSQL. Reader clients keep a local outbox and resolve concurrent device updates by `client_updated_at` (last write wins).
7. Offline EPUB files and explicitly downloaded manga chapters use the browser Cache API. They remain on that device, can be cleared from Settings, and are never copied into HAO's shared cloud media storage.

## Account portability and maturity

The versioned `hao-account-backup-v1` export contains profile preferences, maturity controls, library entries, ratings, notes, canonical progress, custom-list metadata, and detailed reading state. Private EPUB binaries and cached extension pages are deliberately excluded; users retain their original book files and may download chapters again on each trusted device.
6. The PWA communicates directly with a paired, user-owned bridge over user-controlled HTTPS. HAO Cloud does not relay extension media.

## Development mode

When Supabase/PostgreSQL is not configured, the API exposes deterministic seed works and in-memory account data. The `x-user-id` header is accepted only outside production. Production refuses that shortcut and requires a verified Supabase JWT.

## Provider contracts

- `CatalogProvider`: search and work details.
- `AnimeProvider`: episodes and normalized stream variants.
- `MangaProvider`: chapters and ordered page URLs.
- `NovelProvider`: sanitized publication manifest and chapters.

Every operation returns either data or a typed `UNAVAILABLE`, `UNAUTHORIZED`, `RATE_LIMITED`, or `INVALID` failure with retryability.

## Bridge boundary

The bridge pairs using a short-lived code and device key, validates repository indexes, and keeps source credentials and extension packages local. The manga runtime delegates to Suwayomi. The anime runtime is a separate compatibility boundary so Aniyomi packages never share process state or credentials with manga packages.
