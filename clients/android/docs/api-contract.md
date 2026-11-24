# Contrato da API Backspace

> **Fonte da verdade:** espelha os tipos, permissões e rotas REST/WebSocket de um servidor Backspace (incluindo extensões opcionais de áudio Opus hierárquico).
> **Regra:** sempre que o servidor mudar qualquer rota, payload ou evento WS, atualize este arquivo primeiro e depois `:core:model` / `:core:network`.

---

## 1. Transporte & Autenticação
- **REST Base:** `https://<instancia>/api` (porta padrão `3000` em HTTP local).
- **Auth:** `Authorization: Bearer <jwt>` em todas as rotas autenticadas (sem cookies).
- **Health:** `GET /api/health` → `{ "status": "ok", "timestamp": 1700000000000 }`
- **Erro padrão:** `{ "error": "mensagem", "code": "error_code", "statusCode": 400, "retryAfter": 60 }`

---

## 2. Endpoints REST (v0.1 + Referência v0.2)

### Instância & Limites Opus/Soundboard
- `GET /api/instance/info` *(pública)* → `{ name, version, registrationOpen, instanceId, commit }`
- `GET /api/settings/streaming` *(Bearer)* →
  ```json
  {
    "defaultAudioBitrateKbps": 64,
    "maxAudioBitrateKbps": 512,
    "allowMusicMode": true,
    "allowStereoAudio": true,
    "soundboardEnabled": true,
    "maxSoundboardSoundsPerScope": 50,
    "maxConcurrentSoundboardSounds": 3
  }
  ```

### Auth & Perfil
- `POST /api/auth/login` *(pública)* → body `{ "username": "...", "password": "..." }` → `{ "token": "<jwt>", "user": User }`
- `GET /api/users/@me` *(Bearer)* → `User`
- `PATCH /api/users/@me` *(Bearer)* → `{ displayName?, customStatus?, status?: "online"|"idle"|"dnd" }` → `User`

### Espaços & Canais
- `GET /api/spaces` *(Bearer)* → `Space[]`
- `GET /api/spaces/:id` *(Bearer)* → `SpaceWithChannelsAndMembers` (`channels`, `categories`, `members`, `roles`, `myPermissions`)
- `GET /api/spaces/:id/channels` *(Bearer)* → `Channel[]`

### LiveKit (Voz)
- `POST /api/livekit/token` *(Bearer)*
  - Body: `{ "channelId": "<id>" }` (ou `{ "dmChannelId": "<id>" }`)
  - Response `200`: `{ "token": "<livekit-jwt>", "url": "wss://..." }`
  - Room name: `channelId`
  - Identity: `"${userId}:${username}"`
  - Attributes assinados: `{ "sb": "1" | "0" }` (permissão `USE_SOUNDBOARD`)

---

## 3. WebSocket Nativo (`wss://<instancia>/ws`)

### Handshake (obrigatório em até 10s após `onOpen`)
Client → Server:
```json
{ "type": "auth", "token": "<jwt>", "client": "mobile" }
```
Server → Client (`ready`):
```json
{
  "type": "ready",
  "user": { "id": "...", "username": "...", "displayName": "...", "status": "online" },
  "spaces": [ /* SpaceWithChannelsAndMembers[] */ ],
  "voiceStates": { "<channelId>": ["<userId>"] },
  "voiceChannelElapsedSeconds": { "<channelId>": 120 },
  "voiceUserStates": { "<userId>": { "isMuted": false, "isDeafened": false, "isCameraOn": false, "isScreenSharing": false } },
  "spaceVoiceStates": { "<spaceId>:<userId>": { "spaceMuted": false, "spaceDeafened": false, "permissionMuted": false } }
}
```

### Heartbeat
- Client envia `{ "type": "ping" }` a cada **15s** → Server responde `{ "type": "pong" }`.
- Grace period de voz no servidor: **60s** (`VOICE_RECONNECT_GRACE_MS`).

### Eventos de Voz (Client → Server)
- `{ "type": "voice_join", "channelId": "<id>" }`
- `{ "type": "voice_leave" }`
- `{ "type": "voice_status", "isMuted": false, "isDeafened": false, "isCameraOn": false, "isScreenSharing": false }`
- `{ "type": "presence_update", "status": "online" | "idle" | "dnd" }`

### Eventos Recebidos (Server → Client)
- `ready`, `pong`, `error`
- `presence_update`: `{ userId, status }`
- `voice_state_update`: `{ channelId, userId, action: "join" | "leave", channelElapsedSeconds? }`
- `voice_status_update`: `{ userId, channelId, isMuted, isDeafened, isCameraOn, isScreenSharing }`
- `space_voice_state`: `{ spaceId, voiceStates, voiceChannelElapsedSeconds, voiceUserStates, spaceVoiceStates }`
- `voice_space_muted`, `voice_space_deafened`, `voice_permission_muted`, `voice_moved`, `voice_disconnected`
- `space_updated`, `category_updated`, `channel_updated`, `channel_created`, `channel_deleted`, `user_updated`

---

## 4. Política Opus em Hierarquia (Extensão Opcional)
Cadeia: `Instância → Espaço → Categoria → Canal → Usuário`.
- **Teto (`maxBitrateKbps`):** mínimo restritivo ao longo da cadeia, clamp `[8, 512]`.
- **Default (`defaultBitrateKbps`):** nível mais específico não-nulo (`Canal > Categoria > Espaço > Instância`), clamped ao `maxBitrateKbps` efetivo.
- **Permissões (`allowMusicMode`, `allowStereoAudio`):** interseção estrita (`AND` lógico).
- **Aplicação no LiveKit:**
  - `maxBitrate = effectiveBitrateKbps * 1000`
  - `dtx = (effectiveMode == VOICE)`
  - `red = (effectiveMode == VOICE) && !effectiveStereo`
  - `forceStereo = effectiveStereo`

---

## 5. LiveKit DataChannel (UTF-8 JSON, `reliable = true`)
- **Deafen:** `{ "type": "deafen", "deafened": true }`
- **Soundboard (v0.2):** `{ "type": "soundboard_play", "soundId": "...", "fileUrl": "/api/soundboard/files/<uuid>.<ext>", "name": "...", "emoji": "🔊", "senderUserId": "...", "durationMs": 1500, "volumeScale": 1.0 }`

---

## 6. Permissões (`BigInt` decimal string em `myPermissions`)
| Permissão | Bit |
|---|---|
| `ADMINISTRATOR` | `1 << 0` |
| `VIEW_CHANNEL` | `1 << 1` |
| `CONNECT` | `1 << 20` |
| `SPEAK` | `1 << 21` |
| `MUTE_MEMBERS` | `1 << 22` |
| `DEAFEN_MEMBERS` | `1 << 23` |
| `MOVE_MEMBERS` | `1 << 24` |
| `DISCONNECT_MEMBERS` | `1 << 26` |
| `USE_SOUNDBOARD` | `1 << 27` |
| `MANAGE_SOUNDBOARD` | `1 << 28` |
