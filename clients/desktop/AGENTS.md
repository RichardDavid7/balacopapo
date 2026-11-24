# AGENTS.md — Guia Rápido para IA (`balacopapo/clients/Desktop`)

Este diretório contém o cliente desktop nativo (Tauri v2 + Rust) do **Balacopapo** para **Windows (`.exe`/`.msi`) e Linux (`.AppImage`/`.deb`)**, focado em eficiência nível **Mumble**, auto-update funcional e **zero burocracia** para manutenção.

> Roadmap geral do projeto: `../../ROADMAP.md`

---

## 1. Regra de Ouro (Onde mexer?)

- **Feature de UI, chat, Soundboard, Opus, temas, P2P WebRTC ou servidor:** NÃO mexa aqui. Implemente no servidor/web do Balacopapo — o app desktop carrega a UI diretamente da URL da instância e herda tudo automaticamente.
- **Feature nativa do desktop** (deep links `balacopapo://`, bandeja/Standby, atalhos globais, detecção de jogos, overlay in-game, WASAPI Application Loopback, motor de voz nativo, controle remoto): mexa aqui, mantendo **1 arquivo por responsabilidade** em `src-tauri/src/`.

---

## 2. Mapa de Arquivos (Leia só o que precisar)

| Preciso mexer em... | Arquivo |
| :--- | :--- |
| Entrada do app, plugins (`deep-link`, `updater`, `autostart`) e registro IPC | `src-tauri/src/lib.rs` |
| Persistência (URL da instância, modo standby, idioma, versão dispensada) | `src-tauri/src/config.rs` |
| Comandos IPC expostos à UI (`window.balacopapo` / `window.backspace`) | `src-tauri/src/commands.rs` |
| Bandeja (Tray), Modo Standby e encaminhamento de `balacopapo://` | `src-tauri/src/tray.rs` |
| Auto-updater Windows + Linux (`tauri-plugin-updater`) | `src-tauri/src/updater.rs` |
| Shim JS injetado na instância (`window.balacopapo` + `window.backspace`) | `bridge/init-bridge.js` |
| Tela inicial leve (escolher/trocar URL da instância) | `launcher/index.html`, `launcher/launcher.js`, `launcher/styles.css` |
| Configuração Tauri (janelas, bundle Win/Linux, `balacopapo://`, updater) | `src-tauri/tauri.conf.json` |
| Permissões Tauri v2 | `src-tauri/capabilities/default.json` |
| CI e Release automático Win/Linux + `latest.json` | `.github/workflows/ci.yml`, `.github/workflows/release.yml` |
| Arquitetura, paridade IPC e alinhamento com o Roadmap | `ARCHITECTURE.md` |

---

## 3. Receita: Adicionar 1 Novo Recurso Nativo em 2 Passos

1. **Rust (`src-tauri/src/commands.rs` ou módulo dedicado):**
   - Crie `#[tauri::command] pub fn meu_comando(...) -> Result<..., String>`.
   - Registre o comando no `tauri::generate_handler![...]` em `src-tauri/src/lib.rs`.
2. **Bridge JS (`bridge/init-bridge.js`):**
   - Exponha em 1 linha dentro de `backspaceBridge` ou `nativeExtensions`.
3. **Atualize `ARCHITECTURE.md`** apenas se mudar o contrato público ou adicionar um novo módulo.

---

## 4. Guardrails Técnicos

- **Compatibilidade dupla (`window.balacopapo` e `window.backspace`):** mantenha ambos apontando para o mesmo objeto congelado para funcionar tanto com instâncias Backspace atuais quanto com o Balacopapo rebrandado.
- **Terminologia Balacopapo (PT-BR):** use **Grupo / Grupos** (antigo *Espaço*) e **Grupo Direto** (antigo *DM em grupo*), conforme `../../ROADMAP.md` (Fase 0).
- **Launcher sem frameworks pesados:** `launcher/` usa apenas HTML/CSS/JS puro (<30 KB) para abrir instantaneamente e não exigir Node/bundler no build.
- **Validação local (quando Rust estiver instalado):**
  - `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
  - `cargo test --manifest-path src-tauri/Cargo.toml`
