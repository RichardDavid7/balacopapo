# Feature: `shell`

- **Responsabilidade:** Workspace autenticado inicial do Balacopapo Desktop — barra lateral de **Grupos** e **Canais**, cabeçalho com estado de conexão e indicador de modo baixa interrupção, além do painel principal pronto para receber `features/chat` (Marco 2) e `features/voice` (Marco 3).
- **Depende de:** `core/models`, `os/updater`, `ui/aether_drift`.
- **Invariante Zero-Stutter:** Renderização 100% sob demanda; 0 draw calls quando a janela está atrás de jogos.
