# Feature: `chat`

- **Responsabilidade:** Histórico de mensagens por canal com paginação (`before=<id>`), envio em tempo real (`POST /api/channels/:id/messages`), exclusão de mensagens próprias, filtro rápido local e sincronização ao vivo via `WsEvent::MessageCreated` / `MessageUpdated` / `MessageDeleted`.
- **Depende de:** `core/models`, `ui/aether_drift`.
- **Invariante Zero-Stutter:** Renderização 100% sob demanda (zero animação em loop); mensagens armazenadas em `HashMap<channel_id, Vec<ChatMessage>>` com deduplicação por `id`.
