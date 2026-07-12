# Third-party notices

HAO Bridge uses these libraries specifically for local APK inspection:

- Android `apksig` 9.2.1, Copyright The Android Open Source Project, licensed under the Apache License 2.0. It verifies APK signing schemes and exposes verified signing certificates.
- `apk-parser` 2.6.10, Copyright Liu Dong, licensed under the BSD 2-Clause License. It decodes Android manifests and extracts declared permissions and package metadata.
- Aniyomi `extensions-lib` 14, Copyright the Aniyomi contributors, licensed under the Apache License 2.0. HAO uses its published AAR only as the exact binary API contract for v14 extension linkage; its runtime methods are stubs and are not executed.
- Suwayomi Server 2.3.2238 supplies the checksum-pinned Android compatibility and Dex translation components to the isolated local anime host. Its use does not make anime extensions supported by Suwayomi or its maintainers.

Their inclusion does not imply review, endorsement, compatibility, or safety of any third-party repository or APK. Distribution builds must include the complete corresponding license texts and all notices required by transitive dependencies. See each dependency's published POM and source repository for the authoritative terms.
