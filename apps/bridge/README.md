# HAO Bridge Desktop

The bridge is a user-owned Kotlin/JVM service. It pairs with HAO, validates third-party repository indexes, tracks package signer fingerprints, and normalizes local extension runtime APIs.

Current implementation includes pairing, strict HTTPS/public-host validation, repository schema parsing, disclaimer enforcement, and Suwayomi/AnYomi runtime boundaries. The Aniyomi compatibility runtime remains disabled until its fixture APK conformance suite and process sandbox pass; HAO must never claim arbitrary APK compatibility before that gate.

Requires JDK 21 and Gradle 8. From the repository root, run:

```powershell
gradle -p apps/bridge run
```

The service binds to `127.0.0.1:4568` by default. Open the PWA's **Settings** page to pair the device and validate a repository. Put the Bridge behind user-controlled HTTPS/private networking for access from other devices.

Pairing codes are single-use and expire after ten minutes. Repository indexes must use HTTPS, cannot target private network addresses, and are downloaded and parsed by the Bridge rather than HAO's cloud. The current milestone previews and records compatible package metadata; APK download, signer verification, installation, updates, and execution remain disabled.
