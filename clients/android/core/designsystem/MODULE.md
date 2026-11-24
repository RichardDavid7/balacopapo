# Módulo `:core:designsystem`

- **Camada:** Core UI (Jetpack Compose + Material3)
- **Responsabilidade:** Tokens visuais oficiais do tema **Aether Drift** (espelhando `packages/web/src/styles/globals.css`) e componentes reutilizáveis (`AetherSurfaceCard`, `AetherStatusDot`, `AetherPurpleSlider`, `AetherPrimaryButton`).

## Regra
Nunca use cores hex soltas em `:feature:*`. Use sempre `AetherTheme.colors`.
