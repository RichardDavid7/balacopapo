# Balacopapo Desktop (100% Nativo Rust)

Cliente desktop nativo leve para o **Balacopapo** construído em **Rust + `Iced` + `wgpu`** — **zero WebView, zero Electron, zero Chromium, zero Node.js**.

Projetado para **não causar queda de FPS nem micro-stuttering em jogos** (zero Garbage Collector, 0% GPU quando parado, arquitetura 100% event-driven).

- **Guia para IA e mantenedores:** [AGENTS.md](./AGENTS.md)
- **Arquitetura e 8 Marcos:** [ARCHITECTURE.md](./ARCHITECTURE.md)

## Build Automático (GitHub Actions)
- **Push em `main` / PR (`clients/desktop/**`):** roda `check-desktop-parity.mjs`, `cargo clippy -- -D warnings`, `cargo test` e compila binários de release em **Windows** e **Linux** (`.github/workflows/desktop-native-ci.yml`).
- **Tag `v*`:** empacota e anexa os binários nativos Windows e Linux na Release unificada do Balacopapo (`.github/workflows/release.yml`).
