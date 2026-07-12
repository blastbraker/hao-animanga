# HAO Bridge Desktop

The bridge is a user-owned Kotlin/JVM service. It pairs with HAO, validates third-party repository indexes, tracks package signer fingerprints, and normalizes local extension runtime APIs.

Current implementation includes pairing, strict HTTPS/public-host validation, repository schema parsing, disclaimer enforcement, and Suwayomi/AnYomi runtime boundaries. The Aniyomi compatibility runtime remains disabled until its fixture APK conformance suite and process sandbox pass; HAO must never claim arbitrary APK compatibility before that gate.

Requires JDK 21 and Gradle 8. From the repository root, run:

```powershell
gradle -p apps/bridge run
```

The service binds to `127.0.0.1:4568` by default. Open the PWA's **Settings** page to pair the device and validate a repository. Pairing identity and the device private key persist under `%USERPROFILE%\.hao\bridge\state` with owner-only permissions where the platform supports POSIX permissions. Put the Bridge behind user-controlled HTTPS/private networking for access from other devices.

Pairing codes are single-use and expire after ten minutes. Repository indexes must use HTTPS, cannot target private network addresses, and are downloaded and parsed by the Bridge rather than HAO's cloud.

Extension installation is a two-step local operation. **Review** downloads an APK into a ten-minute quarantine, caps it at 50 MiB, requires it to remain on the repository host, verifies the Android signing certificate, checks the manifest package identity, extracts declared permissions, and records SHA-256. **Install locally** requires permission acknowledgement and renewed signer acknowledgement when an installed package changes signing identity. The Bridge persists installation metadata under `%USERPROFILE%\.hao\bridge\extensions` by default and supports enable, disable, and removal operations.

Manga execution uses Suwayomi Server. The Bridge automatically starts and monitors a loopback Suwayomi installation, then synchronizes enabled, reviewed manga APKs on startup, install, enable, disable, and removal. It recomputes each stored APK's SHA-256 before synchronization and refuses changed files. Settings exposes runtime health, manual start, and manual synchronization controls.

The default endpoint is `http://127.0.0.1:4567`, JAR is `%USERPROFILE%\.hao\suwayomi\Suwayomi-Server-v2.3.2238.jar`, and data directory is `%USERPROFILE%\.hao\suwayomi\data`. The bundled runtime manager pins that release's SHA-256 before launch. Override these with `SUWAYOMI_URL`, `HAO_SUWAYOMI_JAR`, `HAO_SUWAYOMI_SHA256`, and `HAO_SUWAYOMI_DATA`. `HAO_JAVA_HOME` selects the Java 21 runtime. Plain HTTP is accepted only on loopback; remote endpoints must use HTTPS and remain externally managed. Optional Basic authentication uses `SUWAYOMI_USERNAME` and `SUWAYOMI_PASSWORD`. The Bridge exposes normalized source, search, title, chapter, and page endpoints and proxies private images locally to the PWA. Aniyomi execution remains gated.

## Anime runtime

The Bridge exposes normalized anime catalog, episode, server, stream, subtitle, and media-delivery APIs. A built-in fixture runtime uses MDN's CC0 MP4 sample and proxies byte-range requests through the local Bridge, allowing deterministic playback and seeking tests without HAO cloud media proxying or third-party content sites. The PWA player consumes only this normalized contract and safely resets media when titles, episodes, servers, or qualities change.

The fixture provider executes in a separate JVM on private loopback port `4570`. The Bridge generates a new 256-bit bearer token on each launch, starts the host with a 256 MiB heap cap and exit-on-OOM, gives it a dedicated working/data directory, and passes a scrubbed environment containing no HAO API, database, Supabase, encryption, or provider credentials. The Bridge restarts the host after crashes. Outbound fixture media requests are recorded without query strings or credentials in `%USERPROFILE%\.hao\bridge\anime-host\network.log`. Override the port and data directory with `HAO_ANIME_HOST_PORT` and `HAO_ANIME_HOST_DATA`.

The Aniyomi APK compatibility runtime remains disabled for arbitrary third-party execution. Repository installation alone never authorizes anime APK execution. Inside the isolated host, enabled anime APKs undergo a second hash and Android-signature check, resource-table-independent binary manifest/source-class validation, checksum-pinned Dex-to-JVM translation, and linkage against the official Aniyomi v14 API. The local endpoint `GET /v1/anime/extensions/probe` reports those results. The installed AniWave 14.3 APK passes this admission/linkage stage but is never constructed.

HAO's purpose-built package `app.hao.fixture.anime` is the sole execution allowlist entry. Its signed APK exercises v14 source construction, catalog, episodes, server selection, normalized streams, and byte-range MP4 delivery through the PWA player. The development-only local admission endpoint is registered only when `HAO_DEV_FIXTURE_APK` explicitly points to the APK; it applies the same archive, signature, signer-continuity, permission, package, hash, and metadata checks and refuses all other package names. The Bridge derives the configured APK's verified signer certificate and passes only its fingerprint into the scrubbed host; execution requires both the exact package name and signer fingerprint.

Before third-party source constructors and network calls are enabled, the host still needs the broader concrete Aniyomi v14 HTTP runtime, OS-enforced filesystem/network sandboxing (Windows AppContainer or Job Object policy, macOS sandbox profile, and Linux namespaces/seccomp), plus permission-delta, malicious-fixture, crash, and outbound-policy tests.
