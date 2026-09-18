# Kokoro novel narration

HAO's extension-novel reader has a **Listen with Kokoro** button in its reader toolbar. It uses seven built-in American/British English voices, not voice cloning or browser speech synthesis. Generation runs on the user's Bridge PC. The web app receives ordinary mono PCM16 WAV audio; no model runs on an iPad and no paid TTS API is involved.

## Bridge owner setup

Node.js 22+ and the existing Java 21 Bridge are required. From the repository root:

```powershell
npm ci --prefix apps/bridge/narrator
gradle -p apps/bridge installDist --no-daemon
```

Restart the Bridge using its tray menu after the build. The tray already launches the Bridge from the repository root, so it discovers `apps/bridge/narrator/worker.mjs` automatically. No separate TTS service, firewall rule, token, or public port is needed.

For an extracted Bridge distribution, run `npm ci` inside its `narrator` directory. `HAO_KOKORO_SCRIPT` can specify an absolute path to `worker.mjs`; `HAO_NODE_PATH` can specify the Node executable. Windows defaults to `C:/Program Files/nodejs/node.exe` when present; otherwise Node must be on PATH.

The model downloads on first use. An internet connection is needed for that initial download; generated speech is local. The pinned 8-bit Kokoro model and voice files are cached in `%USERPROFILE%\.hao\bridge\narration\models` by default. `HAO_NARRATION_DATA` overrides the data directory. The Bridge's `narrator.log` in that directory contains setup failures, without logging chapter text.

To verify installation, check `/v1/narration/status` on a paired Bridge. `available` means the worker package is installed, not that model generation has already been warmed up. The first passage may take longer while downloading/loading the model.

## Reader controls

- Play/pause, 15-second seek within the current passage, previous/next passage, and passage selection.
- Seven built-in voices and 0.5×–2× playback speed. Speed changes do not regenerate audio.
- Listening position stored separately from visual reading progress, locally first and through the existing account reading-state sync.
- Passage timestamps resume only when both the chapter and content fingerprint match. Source edits start a fresh position.
- Sleep timer and opt-in next-chapter continuation. These survive chapter changes within the open reader.
- Media Session play/pause/seek controls where supported.

If Safari blocks the initial asynchronous play request, the player displays **Tap Play**. Once accepted, the same audio element is used for subsequent passages. Background/lock-screen passage transitions on a physical iPad still need device testing; desktop viewport emulation cannot verify iOS suspension or AirPods behavior. Closing Listen or leaving the reader pauses narration and saves position. There is no site-wide persistent mini-player yet.

## Privacy and resource limits

The Bridge accepts only an existing extension chapter ID, fetches that chapter itself, and strips non-reading markup. It does **not** expose an arbitrary text/URL synthesis endpoint, accept uploaded voices, or send chapter text to a model service. Private EPUB narration is not included in this first version.

The worker communicates over private stdin/stdout pipes. It inherits a small system-environment allowlist, not HAO cloud or admin credentials. On Windows it is put in a kill-on-close Job Object with a 1.5 GiB memory limit. ONNX uses two inference threads; only one generation runs at a time. The model is unloaded after five minutes idle. Other readers receive bounded retries when busy.

Source-chapter manifests are unguessable capabilities, expire after two hours, and are limited to 32 retained chapters and 30 manifest requests/minute. The audio API requires a manifest ID, a valid passage index, and an allowlisted voice. Chapters are capped at 200,000 text characters/1,500 passages; individual inference inputs are bounded and further split if phoneme tokens exceed the model limit, never silently truncated. Generated audio is capped at 120 seconds/passage and a 256 MiB least-recently-used Bridge cache. Browsers retain only a small passage window.

These limits supplement the existing Bridge access model. They do **not** turn a paired Bridge into per-user authenticated public hosting: the existing shared Bridge catalog endpoints rely on endpoint access and pairing state. Keep it within the intended trusted beta/private-network boundary. Public Internet hosting needs account-bound Bridge authorization and quotas before expanding usage. Do not reuse this source-only cache for private EPUBs without account-scoped isolation.

## Tests

```powershell
node --test apps/bridge/narrator/protocol.test.mjs
node apps/bridge/narrator/smoke.mjs
pnpm --filter @hao/web typecheck
pnpm --filter @hao/web test
gradle -p apps/bridge test --tests app.hao.bridge.NarrationTest --no-daemon
```

The smoke script downloads the pinned model to the ignored `.run/kokoro` directory and writes a synthetic-story sample to `.tmp/kokoro-smoke.wav`. No third-party novel text is used. Set `HAO_TEST_KOKORO=1` for the optional Windows integration test, which also verifies process containment and repeat-request cache reuse. The regular tests do not download models.

## Licenses and provenance

- [Kokoro / kokoro-js](https://github.com/hexgrad/kokoro/tree/main/kokoro.js): Apache-2.0; built-in voice definitions provided by that project.
- [Kokoro-82M-v1.0 ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX): model revision `1939ad2a8e416c0acfeecc08a694d14ef25f2231`, quantized `q8`; Apache-2.0 model card.
- [Transformers.js](https://github.com/huggingface/transformers.js): Apache-2.0.
- Its unused-for-TTS `sharp` dependency is overridden to patched version `0.35.4`, because Transformers.js 3.x's default range excludes the security-fixed minor release. Re-run `npm audit --prefix apps/bridge/narrator` when updating dependencies.
- [phonemizer.js](https://github.com/xenova/phonemizer.js) declares Apache-2.0 for its wrapper and uses eSpeak NG. [eSpeak NG's own license](https://github.com/espeak-ng/espeak-ng/blob/master/COPYING) is GPL-3.0. Review the embedded engine's notices and corresponding-source requirements before distributing desktop binaries containing it; do not assume the wrapper/model license covers every dependency. The current setup installs dependencies separately with npm.

Narrate only text users are authorized to access. Narration does not change a book's copyright or create redistribution rights.
