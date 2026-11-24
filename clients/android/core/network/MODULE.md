# Módulo `:core:network`

- **Camada:** Core (Android Library — OkHttp + kotlinx.serialization + Security Crypto)
- **Responsabilidade:** Comunicação REST (`/api/*`), WebSocket nativo (`/ws` com `client: "mobile"`, heartbeat 15s e reconexão exponencial), estado reativo da sessão (`RealtimeSnapshot`) e persistência segura de credenciais (`SecureSessionStorage`).

## Invariantes
- Autenticação é 100% `Authorization: Bearer <token>` (sem cookies).
- Primeiro frame WS após `onOpen` é sempre `{"type":"auth","token":"...","client":"mobile"}`.
- Tokens JWT nunca são escritos no Logcat.
