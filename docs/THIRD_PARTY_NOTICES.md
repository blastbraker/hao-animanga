# Third-party notices

HAO Bridge uses these libraries specifically for local APK inspection:

- Android `apksig` 9.2.1, Copyright The Android Open Source Project, licensed under the Apache License 2.0. It verifies APK signing schemes, exposes verified signing certificates, and provides the binary XML reader used for manifests without decoding application resources.
- Aniyomi `extensions-lib` 14, Copyright the Aniyomi contributors, licensed under the Apache License 2.0. HAO uses its published AAR only as the exact binary API contract for v14 extension linkage; its runtime methods are stubs and are not executed.
- HAO's v14 runtime model and interface implementations preserve the Apache-2.0 Aniyomi API shape needed by the isolated fixture adapter.
- Suwayomi Server 2.3.2238 supplies the checksum-pinned Android compatibility and Dex translation components to the isolated local anime host. Its use does not make anime extensions supported by Suwayomi or its maintainers.
- JNA/JNA Platform 5.17.0, licensed under LGPL 2.1 or Apache License 2.0, provides the Windows native bindings used to create and configure the anime host Job Object.

Their inclusion does not imply review, endorsement, compatibility, or safety of any third-party repository or APK. Distribution builds must include the complete corresponding license texts and all notices required by transitive dependencies. See each dependency's published POM and source repository for the authoritative terms.
