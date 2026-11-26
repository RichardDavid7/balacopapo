# Feature: `overlay`

- **Responsabilidade:** Configuração e prévia GPU do **Overlay In-Game** em 3 camadas independentes (`#speakers`, `#toasts`, `#pointers`), gerenciamento de **Atalhos Globais em Jogos** (Mute, Deafen, PTT, Overlay, Soundboard) e **Presença de Jogos** (scanner leve via `sysinfo` + privacidade + override manual).
- **Depende de:** `os/activity`, `os/keybinds`, `ui/aether_drift`.
- **Invariante Zero-Stutter:** Overlay redesenha apenas em eventos de fala/toast/pointer (+2–4 MB RAM, 0 FPS constantes sobre o DWM/Wayland); scanner de jogos só roda sob demanda ou a cada 10s em baixa prioridade.
