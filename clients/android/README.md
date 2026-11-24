# Backspace Android

Native Android client (**Kotlin + Jetpack Compose + LiveKit native WebRTC**) for self-hosted [Backspace](https://github.com/TheZwiss/backspace) instances, focused on low-latency, battery-efficient voice communication.

## Features (v0.1)
- **Multi-instance support:** connect to any self-hosted Backspace instance over HTTPS/WSS.
- **Native low-latency voice:**
  - `livekit-android` (native C++ WebRTC + Opus)
  - Persistent `ForegroundService` with quick notification controls (*Mute / Deafen / Leave*)
  - Native Android audio routing (Bluetooth SCO/LE, Speaker, Wired Headset, Earpiece)
  - Configurable Opus settings (Voice vs. Music mode, Stereo, Auto/Manual bitrate, DTX & RED)
  - Live connection telemetry and idle audio suspension for battery savings
- **Aether Drift design system** + **5 languages** (`en`, `pt-BR`, `de`, `ru`, `zh-CN`).
- **Automated APK builds** via GitHub Actions (`.github/workflows/build-apk.yml`).

## Documentation
- [docs/architecture.md](./docs/architecture.md) — Multi-module architecture and roadmap.
- [docs/api-contract.md](./docs/api-contract.md) — REST, WebSocket, and LiveKit protocol reference.
- [AGENTS.md](./AGENTS.md) — Architecture rules and development guidelines.

## Building & Updating (Obtainium-ready)

### Obtainium
Releases publish a single predictable APK asset (`backspace-android-<tag>.apk`) + `SHA256SUMS.txt` with `versionName` matched to the tag and monotonically increasing `versionCode`.
1. Open **Obtainium** → **Add App** → paste this repository URL.
2. Enable **Include prereleases** if you want `-alpha` / `-beta` builds.

### GitHub Actions
- Push to `main` builds and uploads an APK artifact.
- Push a `v*` tag (e.g. `v0.2.0-alpha`) to publish an Obtainium-ready GitHub Release.
- Optional repository secrets for persistent release signing (required for seamless in-place updates across builds): `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

### Local Build
1. Install **JDK 21** and the **Android SDK** (API 35).
2. Configure `JAVA_HOME` and `ANDROID_HOME`.
3. Run:
   ```bash
   ./gradlew assembleDebug
   ```
   Output: `app/build/outputs/apk/debug/app-debug.apk`.
