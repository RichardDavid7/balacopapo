# AGENTS.md — Balacopapo Desktop (100% Nativo Rust, Zero WebView)

Guia rápido para qualquer IA manter e evoluir `clients/desktop/` sem burocracia.

> Roadmap geral: `../../ROADMAP.md` · Roadmap nativo: `../../packages/desktop/ROADMAP.md`

---

## 1. Premissas Inegociáveis ("Zero-Stutter Budget")

1. **ZERO WebView / ZERO Chromium / ZERO Node.js / ZERO JVM:** processo único nativo em Rust (`Iced` + `wgpu` + `cosmic-text`).
2. **Baixa interrupção de CPU em jogos (alvo principal):**
   - **Zero Garbage Collector** (sem travadinhas de V8/JVM).
   - **0% de GPU quando ocioso:** nunca crie timers/animações em loop quando não há mudança real na tela; `Subscription::none()` é o padrão.
   - **Áudio Lock-Free (`rtrb` + MMCSS `Pro Audio`):** thread de áudio isolada sem *locks* nem alocações na heap (Marco 3).
   - **Overlay sob demanda:** redesenha apenas em eventos de fala/toast/pointer, nunca a 60fps constantes (Marco 6).
3. **Terminologia PT-BR:** use sempre **Grupo / Grupos** (antigo *Espaço*) e **Grupo Direto** (antigo *DM em grupo*).

---

## 2. Mapa de Arquivos (1 Arquivo = 1 Assunto)

| Preciso mexer em... | Arquivo |
| :--- | :--- |
| Entrada `Iced` + configuração de janela | `src/main.rs` |
| Máquina de estados Elm principal (`Message` + `update` + `view`) | `src/app.rs` |
| Config local JSON + validação de URL | `src/core/config.rs` |
| Parser `balacopapo://` (OIDC callback + convites) | `src/core/deep_link.rs` |
| 23 `PermissionBits` (espelho de `packages/shared/src/permissions.ts`) | `src/core/permissions.rs` |
| Política Opus 5 níveis (`Instância → Grupo → Categoria → Canal → Usuário`) | `src/core/audio_policy.rs` |
| DTOs REST/WS | `src/core/models.rs` |
| Cliente HTTP (`reqwest` + `rustls`, sem OpenSSL) | `src/net/client.rs` |
| Cliente WebSocket 100% event-driven (`tokio-tungstenite` + reconexão) | `src/net/ws.rs` |
| Verificador SemVer GitHub Releases | `src/os/updater.rs` |
| Design System **Aether Drift** (`Iced` styles + tokens) | `src/ui/aether_drift.rs` |
| Tela de login / instância / OIDC | `src/features/auth/mod.rs` (+ `MODULE.md`) |
| Chat ao vivo (histórico paginado, envio, exclusão, filtro) | `src/features/chat/mod.rs` (+ `MODULE.md`) |
| Painel de Voz nativo (dispositivos, RNNoise, loopback, Opus, Jitter) | `src/features/voice/mod.rs` (+ `MODULE.md`) |
| Soundboard & Editor WAV em Canvas GPU | `src/features/soundboard/mod.rs` (+ `MODULE.md`) |
| Motor de áudio lock-free (`cpal` + `rtrb` + `nnnoiseless`) e WAV DSP | `src/media/audio_engine.rs`, `src/media/wav_dsp.rs` |
| Workspace de Grupos, Categorias, Canais & Seletor de Status | `src/features/shell/mod.rs` (+ `MODULE.md`) |
| Guardião automático de paridade (`PermissionBits`) | `../../scripts/check-desktop-parity.mjs` |
| CI automático Windows + Linux | `../../.github/workflows/desktop-native-ci.yml` |

---

## 3. Receita: Adicionar 1 Nova Feature sem Novela

1. Crie `src/features/<nome>/mod.rs` (com `State`, `enum Message`, `view()`) + `MODULE.md` de ~20 linhas.
2. Registre `pub mod <nome>;` em `src/features/mod.rs` e conecte no `app.rs`.
3. Se mexer em permissões, valide a paridade com o servidor:
   ```bash
   node ../../scripts/check-desktop-parity.mjs
   ```
4. Valide o Rust (localmente ou via GitHub Actions):
   ```bash
   cargo clippy --all-targets -- -D warnings
   cargo test
   ```
