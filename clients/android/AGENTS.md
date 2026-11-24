# AGENTS.md — Backspace Android

> **Guia técnico para IAs e mantenedores.** Leia este arquivo, `docs/architecture.md` e `docs/api-contract.md` antes de modificar código.

---

## 1. Missão do Projeto
Cliente Android **100% nativo** (Kotlin + Jetpack Compose + LiveKit WebRTC nativo) para instâncias self-hosted do **Backspace**, projetado para:
1. **Eficiência de voz nativa:** áudio nativo Android (`MODE_IN_COMMUNICATION`, Bluetooth SCO/LE Audio, AEC/NS/AGC por hardware), `ForegroundService` persistente com controles na notificação, baixo consumo de RAM/bateria em background e zero WebView.
2. **Suporte completo ao protocolo Backspace:** incluindo extensões opcionais de **Opus em hierarquia** (`Instância → Espaço → Categoria → Canal → Usuário`), telemetria WebRTC precisa (sem falso positivo RFC 7587), suspensão de áudio ocioso e preparação para Soundboard/Status/Vídeo.
3. **Modularidade e facilidade de atualização:** arquitetura multi-módulo Gradle (`:core:*` e `:feature:*`), contrato de API centralizado em `docs/api-contract.md` e CI automático gerando APK via GitHub Actions.

---

## 2. Mapa Rápido
- `docs/parity-roadmap.md` — **Checklist Mestre de Paridade** (Backspace Web + Mumble/Mumla) e blocos planejados.
- `docs/architecture.md` — Grafo de módulos Gradle, dependências permitidas e roadmap.
- `docs/api-contract.md` — Contrato REST + WebSocket + LiveKit + Opus + Permissões.
- `<modulo>/MODULE.md` — Cada módulo tem um `MODULE.md` curto descrevendo responsabilidade, API pública e invariantes.

### Regra de Versionamento (SemVer a partir de `0.10.0`)
- **Patch (`0.10.1`, `0.10.2`...):** correções pequenas, bugfixes e ajustes de UI.
- **Minor (`0.11.0`, `0.12.0`...):** novos blocos relevantes de recursos ou novos módulos.
- **Major (`1.0.0`):** paridade completa e estável.

---

## 3. Regras de Arquitetura (Invariantes Obrigatórias)
- `:app` → pode depender de `:core:*` e `:feature:*`.
- `:feature:*` → pode depender de `:core:*`, **NUNCA** diretamente de outro `:feature:*`.
- `:core:voice` → depende de `:core:model` e `:core:network`; **NUNCA** depende de Compose UI.
- `:core:network` → depende apenas de `:core:model`.
- `:core:designsystem` → depende apenas de Compose/Material3 (tokens **Aether Drift**).
- `:core:model` → Kotlin puro (JVM), espelho tipado da API + lógica pura (`AudioPolicyResolver`, `PermissionBits`, `OpusFmtpParser`).

### Convenções
- **Terminologia em Português (BR):** use sempre **Espaço / Espaços**.
- **i18n nos 5 idiomas:** `values` (`en`), `values-pt-rBR` (`pt`), `values-de` (`de`), `values-ru` (`ru`), `values-zh-rCN` (`zh`). Valide com `node scripts/check-i18n.mjs`.
- **Segurança:** JWT Bearer sempre em `EncryptedSharedPreferences` (Android Keystore), nunca em logcat.

---

## 4. Protocolo de Atualização
1. Leia `docs/api-contract.md` e o `MODULE.md` dos módulos afetados.
2. Atualize `docs/api-contract.md` → `:core:model` → `:core:network` → `:core:voice` / `:feature:*`.
3. Adicione/atualize testes unitários em `:core:model`.
4. Sincronize os 5 `strings.xml` e rode `node scripts/check-i18n.mjs`.
5. Atualize o `MODULE.md` do módulo modificado.
