# Security and provider policy

## Required controls before public registration

- Replace development memory stores with PostgreSQL repositories and verify Supabase JWT issuer/audience.
- Store provider secrets using envelope encryption backed by a managed KMS.
- Enforce account and IP quotas through Redis at the API edge.
- Virus-scan EPUB uploads, reject encrypted/recursive archives, cap expanded size and file count, and sanitize all XHTML before rendering.
- Issue short-lived object URLs and revoke them when an account, device, or asset is removed.
- Apply a restrictive CSP with provider-specific media/image allowlists.
- Re-resolve remote DNS immediately before connection and reject private, loopback, link-local, multicast, and reserved addresses.
- Keep bridge APIs on HTTPS, restrict CORS to the configured HAO origin, and rotate/revoke device keys.
- Run each extension runtime with separate OS identity, storage, network policy, CPU/memory limits, and crash supervision.
- Verify APK hashes and signing certificates; require renewed acknowledgement on signer or permission changes.
- Redact credentials, URLs containing tokens, book contents, and media URLs from logs.

## Disclaimer shown before enabling a repository

> Third-party repositories and extensions are not created, reviewed, hosted, endorsed, supported, or controlled by HAO. Their developers and content providers are unaffiliated with HAO. Availability, safety, and legality are not guaranteed. You are responsible for using only content you are authorized to access and for complying with applicable laws and provider terms.

HAO must not ship third-party repository URLs as defaults. Source-specific support belongs to the source or repository maintainer.

## Reporting

Do not include secrets, private EPUBs, provider tokens, or stream URLs in a report. Include the affected component, reproduction steps using fixtures, and the relevant request ID.
