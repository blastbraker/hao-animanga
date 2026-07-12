# HAO Aniyomi v14 fixture extension

This Android APK is purpose-built for HAO's compatibility tests. It exposes one title, one episode, and MDN's CC0 flower MP4 through the Aniyomi extensions-lib v14 contract. It contains no third-party catalog integration, scraping, credentials, or dynamic code.

The release build intentionally uses Android's local debug signing identity. HAO allowlists the package `app.hao.fixture.anime` only for the pre-execution conformance stage; package name alone is not a production trust decision.

Build with JDK 21 and an Android SDK containing platform 34 and build-tools:

```powershell
gradle -p fixtures/aniyomi-v14-extension :app:assembleRelease
```

The APK is written below `app/build/outputs/apk/release/`. Install it through HAO's normal review/confirmation flow so signature, signer-change, permission, hash, and manifest checks are exercised.
