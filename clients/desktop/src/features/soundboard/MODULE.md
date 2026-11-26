# Feature: `soundboard`

- **Responsabilidade:** Lista de clipes do Soundboard (`GET /api/soundboard?spaceId=...`), filtro por pasta/busca, controle de volume com **curva quadrática**, prévia nativa via `cpal` e **Editor WAV GPU (`iced::widget::canvas`)** com recorte + normalização **Active-RMS** + **Soft Limiter**.
- **Depende de:** `core/models`, `media/wav_dsp`, `ui/aether_drift`.
- **Invariante Zero-Stutter:** Canvas GPU redesenha apenas quando o clipe ou os sliders de recorte mudam (0% GPU quando parado).
