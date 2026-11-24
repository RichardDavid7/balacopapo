# Módulo `:core:updater`

- **Camada:** Core Utility (Android Library)
- **Responsabilidade:** Verifica a última Release no GitHub (`GET /repos/<slug>/releases/latest`), compara com a versão instalada (`versionName`) e retorna o link direto do `.apk` (ou da página da Release) para atualização rápida.
