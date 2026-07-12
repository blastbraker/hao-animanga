# HAO Bridge Desktop

The bridge is a user-owned Kotlin/JVM service. It pairs with HAO, validates third-party repository indexes, tracks package signer fingerprints, and normalizes local extension runtime APIs.

Current implementation includes pairing, strict HTTPS/public-host validation, repository schema parsing, disclaimer enforcement, and Suwayomi/AnYomi runtime boundaries. The Aniyomi compatibility runtime remains disabled until its fixture APK conformance suite and process sandbox pass; HAO must never claim arbitrary APK compatibility before that gate.

Requires JDK 21 and Gradle 8. From the repository root, run:

```powershell
gradle -p apps/bridge run
```

The service binds to `127.0.0.1:4568` by default. Open the PWA's **Settings** page to pair the device and validate a repository. Put the Bridge behind user-controlled HTTPS/private networking for access from other devices.

Pairing codes are single-use and expire after ten minutes. Repository indexes must use HTTPS, cannot target private network addresses, and are downloaded and parsed by the Bridge rather than HAO's cloud.

Extension installation is a two-step local operation. **Review** downloads an APK into a ten-minute quarantine, caps it at 50 MiB, requires it to remain on the repository host, verifies the Android signing certificate, checks the manifest package identity, extracts declared permissions, and records SHA-256. **Install locally** requires permission acknowledgement and renewed signer acknowledgement when an installed package changes signing identity. The Bridge persists installation metadata under `%USERPROFILE%\.hao\bridge\extensions` by default and supports enable, disable, and removal operations.

Manga execution uses a separately installed Suwayomi Server. It defaults to `http://127.0.0.1:4567`; override it with `SUWAYOMI_URL`. Plain HTTP is accepted only on loopback, while remote endpoints must use HTTPS. Optional Basic authentication uses `SUWAYOMI_USERNAME` and `SUWAYOMI_PASSWORD`. The Bridge exposes normalized source, search, title, chapter, and page endpoints and proxies private images locally to the PWA. Aniyomi execution remains gated.
