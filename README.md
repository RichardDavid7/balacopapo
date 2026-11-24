# Balacopapo

Plataforma **self-hosted** de voz em alta definição, vídeo, compartilhamento de tela e chat em tempo real — código aberto (AGPL-3.0), pensada para comunidades e grupos privados com controle total dos seus dados.

> **Origem:** Fork/evolução própria baseada no [Backspace](https://github.com/TheZwiss/backspace), mantendo compatibilidade para acompanhar correções de segurança do upstream.

---

## Downloads e Releases

Todas as plataformas são publicadas juntas em cada versão na página de [Releases](https://github.com/RichardDavid7/balacopapo/releases):

| Plataforma | Artefatos | Origem no repositório |
|---|---|---|
| **Servidor + Web (PWA)** | `ghcr.io/richarddavid7/balacopapo:latest` (`amd64` / `arm64`) | `packages/server`, `packages/web`, `packages/shared` |
| **Windows** | Instalador `.exe` (NSIS) e `.msi` | `clients/desktop` (Tauri v2 + Rust) |
| **Linux** | `.AppImage` e `.deb` | `clients/desktop` (Tauri v2 + Rust) |
| **Android** | `.apk` (compatível com Obtainium) | `clients/android` (Kotlin + Jetpack Compose) |

---

## Principais recursos já incluídos

- **Voz e Vídeo via LiveKit:** salas de voz de baixa latência, compartilhamento de tela em tela cheia sem sobreposição e opção de ocultar participantes sem vídeo.
- **Controle completo de áudio Opus:** política hierárquica *Instância → Espaço → Categoria → Canal → Usuário*, modo Voz vs. Música, estéreo, telemetria em tempo real e suspensão de áudio em inatividade.
- **Soundboard integrado:** pastas, busca, permissões dedicadas, limites por instância/espaço e editor WAV direto no navegador com recorte e normalização.
- **Seletor rápido de status:** Online, Ausente e Não Perturbe com timer de reversão automática.
- **Clientes nativos leves:** app desktop em Tauri v2 (modo standby de baixo consumo, tray, deep links `balacopapo://` e auto-update) e app Android nativo em Kotlin/Compose.

Veja o planejamento completo em [ROADMAP.md](./ROADMAP.md).

---

## Subindo o servidor com Docker

```bash
cp .env.example .env
# Edite o .env (JWT_SECRET, DOMAIN, credenciais LiveKit, etc.)
docker compose up -d
```

Ou puxe a imagem diretamente do GitHub Container Registry:

```bash
docker pull ghcr.io/richarddavid7/balacopapo:latest
```

Para versões de desenvolvimento da branch `main`, use a tag `edge` (ou `sha-<commit>`).

---

## Estrutura do Monorepo

```text
balacopapo/
├── packages/
│   ├── shared/          # Tipos, permissões e contratos compartilhados
│   ├── server/          # Servidor Node.js / Fastify + SQLite (Drizzle)
│   └── web/             # Cliente Web / PWA (React + Vite)
├── clients/
│   ├── desktop/         # Cliente Desktop nativo (Tauri v2 + Rust)
│   └── android/         # Cliente Android nativo (Kotlin + Compose)
├── .github/workflows/   # CI, imagem Docker (main) e Releases unificadas (v*)
├── Dockerfile
├── docker-compose.yml
└── ROADMAP.md
```

---

## Licença

Distribuído sob a licença **AGPL-3.0-only** — veja [LICENSE](./LICENSE) e [NOTICE](./NOTICE).
Baseado originalmente em [TheZwiss/backspace](https://github.com/TheZwiss/backspace).
