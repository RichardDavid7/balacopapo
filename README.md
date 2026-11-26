<div align="center">

# Balacopapo

**Plataforma self-hosted de voz em alta definição, vídeo, compartilhamento de tela, malha P2P híbrida e chat em tempo real.**  
Código aberto (**AGPL-3.0**), feita para grupos e comunidades privadas com controle total dos seus dados.

[![Última Release](https://img.shields.io/github/v/release/RichardDavid7/balacopapo?include_prereleases&label=Release&color=7c5cff&style=for-the-badge)](https://github.com/RichardDavid7/balacopapo/releases/latest)
[![Docker GHCR](https://img.shields.io/badge/Docker-GHCR-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://github.com/RichardDavid7/balacopapo/pkgs/container/balacopapo)
[![Licença AGPL-3.0](https://img.shields.io/badge/Licen%C3%A7a-AGPL--3.0-10b981?style=for-the-badge)](./LICENSE)

<br />

### Baixar Agora

[![Baixar para Windows](https://img.shields.io/badge/Windows-Instalador%20(.exe)-0078D6?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/RichardDavid7/balacopapo/releases/download/desktop-edge/Balacopapo-Setup-windows-x64.exe)
[![Baixar para Linux](https://img.shields.io/badge/Linux%20(Fedora%20%2F%20CachyOS)-Download%20Direto%20(.tar.gz)-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/RichardDavid7/balacopapo/releases/download/desktop-edge/Balacopapo-Desktop-linux-x64.tar.gz)
[![Baixar para Android](https://img.shields.io/badge/Android-Baixar%20APK-3DDC84?style=for-the-badge&logo=android&logoColor=black)](https://github.com/RichardDavid7/balacopapo/releases/latest)

<br />

**Balacopapo Utilidades** *(Bot de Música / Rádio + Ponte de Voz)*:  
[![Utilidades Windows](https://img.shields.io/badge/Utilidades%20Windows-Download%20Direto%20(.zip)-6366f1?style=flat-square&logo=windows&logoColor=white)](https://github.com/RichardDavid7/balacopapo/releases/download/utilities-edge/balacopapo-utilidades-windows-x64.zip)
[![Utilidades Linux](https://img.shields.io/badge/Utilidades%20Linux-Download%20Direto%20(.tar.gz)-6366f1?style=flat-square&logo=linux&logoColor=white)](https://github.com/RichardDavid7/balacopapo/releases/download/utilities-edge/balacopapo-utilidades-linux-x64.tar.gz)
[![Todas as Releases](https://img.shields.io/badge/Todas%20as%20Vers%C3%B5es-GitHub%20Releases-334155?style=flat-square&logo=github&logoColor=white)](https://github.com/RichardDavid7/balacopapo/releases)

</div>

> **Origem:** Evolução própria baseada no [Backspace](https://github.com/TheZwiss/backspace), mantendo compatibilidade para acompanhar correções de segurança do upstream.

---

## Downloads e Plataformas

Todas as versões oficiais são publicadas juntas na página de [Releases](https://github.com/RichardDavid7/balacopapo/releases):

| Plataforma | Atalho Rápido | Artefatos | Origem no repositório |
|---|---|---|---|
| **Windows (x64)** | [Instalador `.exe`](https://github.com/RichardDavid7/balacopapo/releases/download/desktop-edge/Balacopapo-Setup-windows-x64.exe) · [Portable `.zip`](https://github.com/RichardDavid7/balacopapo/releases/download/desktop-edge/Balacopapo-Desktop-windows-x64.zip) | Instalador nativo (Menu Iniciar, Área de Trabalho, `balacopapo://`, auto-update silencioso) | `clients/desktop` |
| **Linux (Fedora / CachyOS / x64)** | [Pacote `.tar.gz` (`install.sh`)](https://github.com/RichardDavid7/balacopapo/releases/download/desktop-edge/Balacopapo-Desktop-linux-x64.tar.gz) · [Binário `x64`](https://github.com/RichardDavid7/balacopapo/releases/download/desktop-edge/Balacopapo-Desktop-linux-x64) | Binário nativo Wayland/Vulkan + `.desktop` + `install.sh` (Zero WebKitGTK) | `clients/desktop` |
| **Android** | [Baixar último APK](https://github.com/RichardDavid7/balacopapo/releases/latest) | `.apk` (compatível com Obtainium) + `SHA256SUMS` | `clients/android` (Kotlin + Jetpack Compose) |
| **Balacopapo Utilidades (Win/Linux)** | [Windows `.zip`](https://github.com/RichardDavid7/balacopapo/releases/download/utilities-edge/balacopapo-utilidades-windows-x64.zip) · [Linux `.tar.gz`](https://github.com/RichardDavid7/balacopapo/releases/download/utilities-edge/balacopapo-utilidades-linux-x64.tar.gz) | App companheiro (Tauri v2 + Node embutido) | `packages/utilities` |
| **Servidor + Web (PWA)** | [Pacote GHCR](https://github.com/RichardDavid7/balacopapo/pkgs/container/balacopapo) | `ghcr.io/richarddavid7/balacopapo:latest` (`amd64` / `arm64`) | `packages/server`, `packages/web`, `packages/shared` |

---

## Principais Recursos

### Voz, Vídeo e Transmissão em Alta Definição
- **LiveKit com qualidade real:** telas em alta definição (`pixelDensity: 'screen'`), `maintain-resolution` sem quedas bruscas para 320p, tela cheia sem sobreposições, **Zoom & Pan (1x–6x)** e opção de ocultar participantes sem vídeo.
- **Buffer sincronizado de Áudio e Vídeo:** controle fino de buffer de voz (até `2000 ms`) e buffer A/V sincronizado da transmissão (`40 ms` padrão), bitrate de áudio configurável (`Auto` até `320 kbps`) e suporte a **Estéreo / Multicanal 5.1**.
- **Controle completo de áudio Opus:** política hierárquica *Instância → Grupo → Categoria → Canal → Usuário*, modo Voz vs. Música, teste de microfone (loopback local com RNNoise/AEC), recuperação pós-sleep e suspensão em inatividade.
- **Áudio isolado por janela & Atalhos Globais:** captura de áudio apenas da janela/aplicativo (Windows WASAPI / Linux PipeWire) e atalhos globais de teclado dentro de jogos para Mute, Deafen, Push-to-Talk e qualquer som do **Soundboard**.
- **Apontar na Stream & Sobreposição (Overlay):** `Shift+clique` no desktop ou mira arrastável no mobile para apontar ao vivo na tela transmitida, com sistema isolado de overlay transparente sobre o monitor compartilhado.

### Malha P2P Híbrida com Failover Duplo
- **Voz P2P inteligente:** mede a latência direta entre pares vs. o caminho completo `ida + volta` pelo servidor, priorizando P2P quando compensa (com média aparada e histerese anti-oscilação).
- **Modo Sobrevivência P2P:** se o servidor reiniciar ou cair durante a chamada, os participantes já conectados continuam conversando em malha direta sem interrupção e reconectam automaticamente quando o servidor volta.
- **Transferência P2P de arquivos na DM:** envio direto via WebRTC DataChannel com consentimento obrigatório do destinatário e **Mapa Visual da Malha P2P** mostrando RTT e tipo de rota (`LAN` / `NAT` / `Relay`).

### Administração, Segurança e Integrações
- **OIDC / SSO nativo:** integração com Authentik, Keycloak, Pocket ID, Authelia e outros via variáveis de ambiente Docker, com vínculo de contas, sincronização de avatar e grupos de administradores.
- **Ban por IP + Feed OPNsense / Nginx:** bloqueio com expiração automática, detecção de evasão e endpoint pronto para Firewall Alias do OPNsense e `deny` do Nginx.
- **Retenção de arquivos configurável:** controle granular por instância, grupo, canal e mensagem individual.
- **API por Grupo & Bot de Música:** cada Grupo cria e revoga suas próprias chaves em **Configurações do Grupo → API e Apps** para conectar o **Balacopapo Utilidades** ou apps próprios, com mini-player acoplado acima dos controles da call e **Vote-Skip configurável por %**.
- **Idiomas e Formato Regional:** 5 idiomas (`pt`, `en`, `de`, `ru`, `zh`), troca segura de `@username`, deep links `balacopapo://` e preferências regionais (relógio `12h/24h`, formato de data e separador numérico) independentes do idioma.

---

## Subindo o Servidor com Docker

```bash
cp .env.example .env
# Edite o .env (JWT_SECRET, DOMAIN, credenciais LiveKit, OIDC opcional, etc.)
docker compose up -d
```

Ou puxe a imagem diretamente do GitHub Container Registry:

```bash
docker pull ghcr.io/richarddavid7/balacopapo:latest
```

Para builds mais recentes da branch `main` (ideal para TrueNAS SCALE / testes): use a tag `edge` ou `sha-<hash7>`.

### Conectando o Balacopapo Utilidades (Bot de Música)
1. No Balacopapo, abra **Configurações do Grupo → API e Apps** e clique em **Gerar Chave de API** (`bp_...`).
2. Baixe o **Balacopapo Utilidades** ([Windows](https://github.com/RichardDavid7/balacopapo/releases/download/utilities-edge/balacopapo-utilidades-windows-x64.zip) ou [Linux](https://github.com/RichardDavid7/balacopapo/releases/download/utilities-edge/balacopapo-utilidades-linux-x64.tar.gz)), cole a URL da sua instância e a chave gerada — o app descobre o Grupo e os canais de voz automaticamente.

---

## Roadmap

Acompanhe os detalhes completos em [ROADMAP.md](./ROADMAP.md) e [packages/desktop/ROADMAP.md](./packages/desktop/ROADMAP.md):

| Fase | Status | Resumo |
|---|---|---|
| **Fase 0** | Concluída | Monorepo unificado, rebrand Balacopapo, Deep Links `balacopapo://`, terminologia (*Grupo* / *Grupo Direto*) e troca de `@username` |
| **Fase 1** | Concluída | Buffer anti-jitter/A-V sincronizado, orçamento dinâmico de banda, fim das quedas 320p, Zoom & Pan e teste de microfone |
| **Fase 2** | Concluída | Malha P2P para arquivos, Mapa de Latência e Voz P2P Híbrida com Modo Sobrevivência e failover duplo |
| **Fase 3** | Concluída | OIDC (SSO), Ban por IP + feed OPNsense/Nginx e retenção de arquivos por Grupo/Canal/Mensagem |
| **Fase 4** | Em andamento | Apontar na stream *(feito)* · Presença de jogos e Modo Leigo no Android *(pendentes)* |
| **Fase 5** | Em andamento | Áudio por janela, atalhos globais e base de Overlay isolada *(feitos)* · Indicador de fala e toasts no Overlay *(pendentes)* |
| **Fases 6 e 7** | Em andamento | API por Grupo + Mini-player + Vote-Skip % *(feitos)* · Ponte Discord e fontes de mídia no Balacopapo Utilidades *(em evolução)* |
| **Fase 8** | Em andamento | Preferências regionais independentes do idioma *(feito)* · Controle remoto seguro, temas e idioma Espanhol *(pendentes)* |

---

## Estrutura do Monorepo

```text
balacopapo/
├── packages/
│   ├── shared/          # Tipos, permissões e contratos compartilhados
│   ├── server/          # Servidor Node.js / Fastify + SQLite (Drizzle)
│   ├── web/             # Cliente Web / PWA (React + Vite)
│   ├── desktop/         # Cliente Desktop Electron (Overlay, atalhos globais, áudio por janela)
│   └── utilities/       # App companheiro Balacopapo Utilidades (Tauri v2 + worker de música)
├── clients/
│   ├── desktop/         # Cliente Desktop nativo (Rust + Iced — zero WebView)
│   └── android/         # Cliente Android nativo (Kotlin + Jetpack Compose)
├── .github/workflows/   # CI, imagem Docker (main), Utilities e Releases unificadas (v*)
├── Dockerfile
├── docker-compose.yml
└── ROADMAP.md
```

---

## Licença

Distribuído sob a licença **AGPL-3.0-only** — veja [LICENSE](./LICENSE) e [NOTICE](./NOTICE).  
Baseado originalmente em [TheZwiss/backspace](https://github.com/TheZwiss/backspace).
