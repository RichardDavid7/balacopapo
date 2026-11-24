# Módulo `:app`

- **Camada:** Application Entrypoint
- **Responsabilidade:** `BackspaceApplication` (container DI leve `AppContainer`), `MainActivity` (permissões runtime Android 13/14+ e `NavHost` Compose), `AndroidManifest.xml` (com `VoiceForegroundService` `microphone|mediaPlayback`) e recursos i18n sincronizados nos 5 idiomas (`en`, `pt-rBR`, `de`, `ru`, `zh-rCN`).
