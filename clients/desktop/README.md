# Balacopapo Desktop

Cliente desktop nativo ultraleve para o **Balacopapo** (Tauri v2 + Rust) para **Windows** e **Linux**, alinhado ao [ROADMAP.md](../../ROADMAP.md).

## Destaques
- **Sem Electron:** usa WebView2 (Windows) / WebKitGTK (Linux), gerando `.exe`/`.msi` e `.AppImage`/`.deb` a partir da mesma base de código.
- **Deep Links `balacopapo://`:** suporte nativo para convites ("Abrir com Balacopapo") e callback OIDC (`balacopapo://auth/callback`).
- **Modo Standby na bandeja:** descarrega a WebView ao fechar para a bandeja (~10–15 MB de RAM) e reabre instantaneamente com 1 clique.
- **Auto-Update Windows + Linux:** via `tauri-plugin-updater` e GitHub Releases.
- **Fácil de manter e atualizar:** 1 único projeto Rust com módulos diretos (veja [AGENTS.md](./AGENTS.md) e [ARCHITECTURE.md](./ARCHITECTURE.md)).

## Build Automático (GitHub Actions)
- **Push em `main`:** roda `clippy` e `cargo test` em Windows e Ubuntu (`.github/workflows/ci.yml`).
- **Tag `v*` ou execução manual (`workflow_dispatch`):** compila e publica os instaladores Windows e Linux em Draft Release (`.github/workflows/release.yml`).
