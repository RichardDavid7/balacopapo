# Módulo `:feature:chat`

- **Camada:** Feature UI (Jetpack Compose)
- **Responsabilidade:** Tela de canal de texto com carregamento de histórico (`GET /api/channels/:id/messages`), recebimento em tempo real via WebSocket (`message_create`/`edit`/`delete`) e envio de mensagens (`POST /api/channels/:id/messages`).
