# AGENTS.md — Balacopapo Desktop (**Tauri v2 Híbrido: UI `packages/web` + Motor Nativo Rust**)

Guia rápido para qualquer IA manter e evoluir `clients/desktop/` sem burocracia.

> Arquitetura completa: `./ARCHITECTURE.md` · Roadmap geral: `../../ROADMAP.md` · Roadmap nativo: `../../packages/desktop/ROADMAP.md`

---

## 1. Premissas Inegociáveis

1. **Arquitetura Tauri v2 Híbrido (1 único executável):**
   - **UI:** sempre o próprio `packages/web` (React + Tailwind) dentro da WebView do SO (WebView2 no Windows / WebKitGTK no Linux — **zero Electron / zero Chromium embutido**). **Não** reescreva telas de chat/perfil/configurações em toolkits Rust (`Iced`, `egui`, etc.).
   - **Backend / Mídia / SO:** 100% **Rust nativo** dentro do mesmo binário (sem Garbage Collector, baixa interrupção de CPU).
2. **Orçamento para PC fraco ("calculadora de 1 real"):**
   - **RAM < 400 MB** mesmo em call + stream; fora de call, destruir a janela de Overlay (`0 MB`).
   - **~0% CPU/GPU no WebView em jogo:** pausar timers/animações quando minimizado ou sem foco.
   - **Zero injeção de DLL em jogos:** Overlay funciona em *Borderless Fullscreen* / *Janela* via janela nativa *click-through* para nunca conflitar com Anti-Cheat.
3. **Overlay & Áudio Isolado:**
   - No Windows, a janela de Overlay **sempre** usa `WDA_EXCLUDEFROMCAPTURE` + `WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOPMOST` e mapeia coordenadas `(0..1)` com escala DPI real.
   - Áudio isolado por janela usa **WASAPI Process Loopback** (`INCLUDE_TARGET_PROCESS_TREE` / `EXCLUDE_TARGET_PROCESS_TREE` para excluir o PID do próprio Balacopapo) no Windows e **PipeWire por aplicativo** no Linux.
4. **Terminologia PT-BR & Guardrails:**
   - Use sempre **Grupo / Grupos** (antigo *Espaço*) e **Grupo Direto** (antigo *DM em grupo*).
   - **Vote-Skip %** do bot de música é campo livre (`1` a `100`) nas Configurações do Grupo (nunca no mini-player).
   - **Jitter Buffer** sempre **Automático** por padrão (override manual apenas no Solucionador).

---

## 2. Módulos Rust Reaproveitados no Backend

| Assunto | Módulo |
| :--- | :--- |
| Permissões (espelho de `packages/shared/src/permissions.ts`) | `core/permissions.rs` (validar com `node ../../scripts/check-desktop-parity.mjs`) |
| Deep links `balacopapo://` (OIDC + convites) | `core/deep_link.rs`, `os/protocol.rs` |
| Auto-updater silencioso (`desktop-edge`) & Autostart | `os/updater.rs`, `os/autostart.rs` |
| Notificações nativas, Atalhos globais, Presença de jogos, Controle remoto | `os/notifications.rs`, `os/keybinds.rs`, `os/activity.rs`, `os/remote_control.rs` |
| Áudio lock-free (`cpal` + `rtrb` + RNNoise), LiveKit Rust & DSP WAV | `media/audio_engine.rs`, `media/livekit_session.rs`, `media/wav_dsp.rs` |
| Protocolo `stream_pointer`, política Opus & orçamento dinâmico | `core/stream_pointer.rs`, `core/audio_policy.rs`, `media/screen_share.rs` |

---

## 3. Validação Obrigatória

```bash
node ../../scripts/check-desktop-parity.mjs
cargo clippy --all-targets -- -D warnings
cargo test
```
