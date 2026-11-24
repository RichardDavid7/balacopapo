# Módulo `:core:voice`

- **Camada:** Core Media (Android Library — `livekit-android` + `AudioManager` + `ForegroundService`)
- **Responsabilidade:** Motor de voz nativo estilo Mumble/Mumla.
  - `BackspaceVoiceEngine`: gerencia conexão LiveKit, aplicação da política Opus (`AudioPolicyResolver`), deafen com DataChannel, participantes ativos/falando, suspensão em inatividade (paridade PR #494) e estado reativo `VoiceSessionState`.
  - `VoiceForegroundService`: mantém a chamada viva com tela desligada/em jogos com controles rápidos na notificação (*Mutar / Ensurdecer / Desconectar*).
  - `VoiceAudioRouter`: roteamento nativo de áudio (Bluetooth SCO/LE, Fone com fio, Viva-voz, Auricular) com suporte Android 12+ (`setCommunicationDevice`) e fallback Android 8–11.

## Invariantes
- Nunca depende de Jetpack Compose (100% desacoplado de UI).
- Sempre executa `wsClient.sendVoiceJoin(channelId)` → `POST /api/livekit/token` → `Room.connect(...)` → `wsClient.sendVoiceStatus(...)`.
- Ao desconectar, sempre limpa LiveKit Room, para `VoiceForegroundService`, restaura `AudioManager.MODE_NORMAL` e envia `voice_leave`.
