# Feature: `voice`

- **Responsabilidade:** Painel nativo de Voz estilo Mumble — conexão a canais de voz (`POST /api/livekit/token`), seleção de dispositivos WASAPI/PipeWire (`cpal`), Mute/Deafen, RNNoise (`nnnoiseless`), **Teste de Microfone (loopback lock-free)**, ganho de mic, VAD Gate, Jitter Buffer (0–2000ms) e telemetria Opus 5 níveis.
- **Depende de:** `core/audio_policy`, `media/audio_engine`, `ui/aether_drift`.
- **Invariante Zero-Stutter:** Suspensão ociosa libera imediatamente os streams `cpal` ao parar o loopback/sair da call; zero locks na thread de áudio.
