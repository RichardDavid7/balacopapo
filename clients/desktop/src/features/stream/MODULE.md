# Feature: `stream`

- **Responsabilidade:** Palco GPU de Vídeo & Compartilhamento de Tela (`iced::widget::canvas`) com **Zoom & Pan (1x–6x ancorado no cursor)**, **Clicar/Apontar na Stream (`stream_pointer`)**, toggle **Ocultar participantes sem vídeo**, **Áudio isolado da janela (WASAPI/PipeWire)** e **Orçamento Dinâmico de Upload** (sem queda para 320p).
- **Depende de:** `core/stream_pointer`, `media/screen_share`, `ui/aether_drift`.
- **Invariante Zero-Stutter:** 0 draw calls quando nenhum evento de mouse/zoom/pointer ocorre; `maintain-resolution` sempre ativo.
