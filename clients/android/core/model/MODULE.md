# Módulo `:core:model`

- **Camada:** Core (Kotlin JVM puro — zero dependência de Android)
- **Responsabilidade:** Modelos de domínio sincronizados com `@backspace/shared`, bitmask de permissões (`PermissionBits`), resolução hierárquica Opus (`AudioPolicyResolver`) e parser anti-RFC 7587 (`OpusFmtpParser`).

## API Pública
- `Models.kt`: `User`, `Space`, `ChannelCategory`, `Channel`, `MemberWithUser`, `InstanceStreamingLimits`, `VoiceUserState`, `SpaceVoiceState`, `VoiceTelemetry`, `AudioMode`, `UserAudioPreferences`, `EffectiveAudioConfig`.
- `PermissionBits.kt`: verificação de permissões BigInt (`hasPermission`, `canConnectVoice`, `canSpeakVoice`, `canUseSoundboard`).
- `AudioPolicyResolver.kt`: precedência `Instância → Espaço → Categoria → Canal → Usuário` (paridade 1:1 com `packages/web/src/utils/audioPolicy.ts`).
- `OpusFmtpParser.kt`: detecta Mono vs Estéreo real via `sprop-stereo=1` sem cair no falso positivo RFC 7587 (`channels=2`).

## Testes
- `AudioPolicyResolverTest.kt` — valida clamping de bitrate, interseção estrita de permissões, overrides por canal e detecção RFC 7587.
