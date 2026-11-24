# Roadmap — Balacopapo

> **Origem:** Fork/evolução própria em cima do Backspace (`TheZwiss/backspace` v1.11.0 / `2885a7d3`), mantendo compatibilidade para puxar correções de segurança do upstream quando houver.
> **Atualizado em:** 24/11/2026

---

## 1. Já Feito (Base pronta em `custom/all-fixes` e branches individuais)

Todas estas entregas já estão implementadas e validadas na base atual (`4441bfe`):

- [x] **Suspensão de áudio em inatividade** (`fix/audio-idle-suspend` · PR #494 / Issue #473) — libera o DAC/driver de áudio quando ocioso e trata estado `interrupted` no iOS.
- [x] **Layout de voz em tela cheia** (`fix/voice-fullscreen-layout` · PR #496) — vídeo edge-to-edge fundo preto, auto-hide sincronizado de overlays, faixa de membros sem sobreposição, blur automático e remoção de tooltip nativo.
- [x] **Ocultar participantes sem vídeo** (`feat/hide-non-video-participants` · PR #497 / Discussion #488) — toggle desktop e mobile com i18n completo.
- [x] **Áudio Opus configurável em hierarquia completa** (`feat/opus-audio-settings` · Issue #495) — política determinística *Instância → Espaço → Categoria → Canal → Usuário*, modo Voz vs. Música, Estéreo, telemetria ao vivo (`ConnectionInfoPopover`) e sincronização no `ready` payload.
- [x] **Soundboard completo** (`feat/soundboard` · Design Proposal) — pastas, busca, permissão `USE_SOUNDBOARD`, limites por instância/espaço, editor WAV no navegador com recorte + normalização Active-RMS + soft limiter, barramento de ganho ao vivo com curva quadrática e botão no rodapé mobile.
- [x] **Seletor rápido de status + fix da caixa de perfil** (`feat/status-picker` · Feature Request) — popover acessível a 1 clique no rodapé com opções Online/Ausente/Não Perturbe e timer de reversão automática.

---

## 2. Já Mapeado / Pendente (Backlog imediato)

Itens já identificados durante os testes e uso real:

- [ ] **Recuperação de áudio pós-suspensão do PC (sleep/wake)** (`fix/audio-wake-recovery`) — detectar retorno de suspensão, retomar `AudioContext` suspenso/congelado e re-aplicar `setSinkId` para qualquer dispositivo de saída (atualmente aguardando merge do PR #494 no upstream para evitar conflito em `AudioManager.ts`, mas pode entrar direto no Balacopapo).
- [ ] **Zoom & Pan na stream focada + atalho fullscreen na barra de foco** — scroll 1x–6x no ponteiro + arrastar para ler texto pequeno em compartilhamento de tela (inspirado na `#481`).
- [ ] **Acompanhar upstream (`TheZwiss/backspace`)** — acompanhar PRs #494, #496, #497, Issue #495 e novas Issues/Proposals para reduzir manutenção no fork.

---

## 3. Roadmap do Balacopapo (O que falta fazer)

### Fase 0 — Identidade, Terminologia e Personalização
- [x] **Repositório e imagem Docker próprios (`balacopapo`)** — monorepo unificado (`packages/` + `clients/desktop` + `clients/android`), imagem `ghcr.io/richarddavid7/balacopapo`, releases multiplataforma (`release.yml`) e `TheZwiss/backspace` como `remote upstream` para puxar correções de segurança.
- [x] **Rebrand para Balacopapo** (nome, títulos, metadados PWA/Desktop/Android, locales nos 5 idiomas e README do monorepo; ícones personalizados podem ser substituídos depois).
- [x] **Suporte a Deep Links / "Abrir com Balacopapo"** — esquema customizado `balacopapo://` (Tauri `deep-link`, PWA `protocol_handlers` `web+balacopapo`, Android `AndroidManifest.xml` intent-filter + parser compartilhado `deepLink.ts`):
  - Botão **"Abrir com Balacopapo"** na página de convite (`/join/:inviteCode`) nos 5 idiomas.
  - Rota de callback segura `/auth/callback` pronta para o **OIDC** (`balacopapo://auth/callback`).
- [x] **Ajuste de terminologia:** trocar *Espaço* → **Grupo** e *Grupo* (DM em grupo) → **Grupo Direto** (aplicado nos locales `pt` do Web e `values-pt-rBR` do Android).
- [ ] **Trocar nome de usuário** (fluxo seguro com validação de unicidade e atualização em tempo real).
- [ ] **Temas de interface** (sistema de temas sobre os tokens CSS do Aether Drift + seletor nas configurações).

### Fase 1 — Estabilidade de Voz, Vídeo e Rede (Prioridade Alta)
- [ ] **Buffer contra perda de pacote / jitter** — controle de `jitterBufferTarget` / `playoutDelayHint` nos `RTCRtpReceiver` + Opus in-band FEC (`useinbandfec=1`) e opção de ajuste de DTX para eliminar micro-cortes de voz.
- [ ] **Bitrate dinâmico inteligente (orçamento de banda) & fim das quedas para 320p:**
  - Configurar um **orçamento total de banda da instância** (ex.: upload total disponível) que se divide dinamicamente conforme o número de participantes/espectadores ativos na sala (ex.: 2 pessoas na call → bitrate liberado no máximo; conforme entram mais pessoas ou streams simultâneas, o teto se ajusta suavemente via `RTCRtpSender.setParameters()` sem derrubar a stream, e volta a subir quando saem).
  - Revisar `degradationPreference`, piso mínimo de resolução/bitrate e recuperação rápida no `screenShare.ts` para evitar quedas bruscas para 320p.
- [ ] **Melhorar consistência geral** — resiliência de reconexão WebSocket/LiveKit, sincronização de estado de voz e eliminação de engasgos entre desktop/mobile.
- [ ] **Teste de microfone (loopback local)** — botão nas configurações de voz para ouvir a própria voz já passando por RNNoise, ganho e AEC.

### Fase 2 — Malha P2P Híbrida (com Failover na Instância)
- [ ] **2A · P2P para arquivos + Indicador P2P** — transferência direta via WebRTC DataChannel entre peers conectados (sem sobrecarregar a banda do servidor), com badge indicando conexão P2P ativa.
- [ ] **2B · Mapa da malha P2P com latência** — grafo visual mostrando o ping (RTT) direto entre cada participante e a latência até a instância.
- [ ] **2C · P2P híbrido para chamadas (voz/vídeo):**
  1. Conecta normalmente via instância (sinalização + SFU).
  2. Tenta upgrade automático para P2P (`RTCPeerConnection` direto) entre participantes com P2P ativado.
  3. Prioriza o tráfego P2P quando saudável (menor latência, zero banda no servidor).
  4. **Sobrevivência:** se a instância cair, as conexões P2P já abertas continuam funcionando entre os participantes.
  5. **Failover:** se a rota P2P degradar (perda de pacote/ping alto/queda), volta automaticamente para o LiveKit da instância.

### Fase 3 — Administração, Retenção de Arquivos e Segurança
- [ ] **OIDC (SSO)** — login integrado com provedores OpenID Connect (Authentik, Keycloak, Google, etc.), usando o navegador do sistema + retorno via deep link `balacopapo://auth/callback` (Fase 0).
- [ ] **Ban por IP + proteção contra força bruta** — bloqueio de IPs no servidor + rate-limit progressivo em login/rotas sensíveis (e integração fácil com proxy/fail2ban).
- [ ] **Retenção de arquivos no chat (controlada pela instância):**
  - A **instância define quais grupos têm permissão para ativar a retenção de arquivos**.
  - Apenas nos grupos autorizados pela instância, o chat/grupo pode ativar a função de manter arquivos (protegendo-os contra expiração/limpeza automática).

### Fase 4 — Interação em Call, Presença e Acessibilidade
- [ ] **Clicar e apontar na stream** — marcação visual temporária (coordenadas normalizadas X/Y via LiveKit DataChannel) no desktop e **arrastar alvo no mobile**.
- [ ] **Indicar qual jogo está jogando** — permitir escolher/indicar manualmente (ou detectar no desktop) qual jogo aparece no seu perfil/presença.
- [ ] **Modo leigo / acessível no Android (mobile)** — layout simplificado com botões grandes, alto contraste e fluxo direto pensado para idosos e usuários iniciantes.

### Fase 5 — Desktop Nativo: Sobreposição (Overlay) e Áudio da Janela
- [ ] **Sobreposição (Overlay in-game):**
  - **Ícone quando alguém fala** (indicador flutuante sobre o jogo mostrando quem está falando no momento).
  - **Aviso quando alguém entra** (notificação discreta no overlay quando alguém entra/sai da call).
- [ ] **Áudio apenas da janela** — captura isolada de áudio apenas da janela/aplicativo selecionado ao compartilhar tela (Windows WASAPI Application Loopback no app desktop nativo).
- [ ] **Atalhos globais de teclado no Desktop** — *Mute*, *Deafen*, *Push-to-Talk* e atalhos rápidos do Soundboard funcionando dentro de jogos sem precisar dar Alt+Tab.

### Fase 6 — Balacopapo Utilidades: Ponte de Voz com Discord (Ponto A ↔ Ponto B)
- [ ] **App / serviço companheiro "Balacopapo Utilidades"** (base compartilhada que conecta como participante de áudio nas salas LiveKit, podendo rodar no Windows ou como container Docker).
- [ ] **Ponte de áudio Balacopapo ↔ Discord** — conecta um canal de voz do Balacopapo (Ponto A) a um canal de voz do Discord (Ponto B) em tempo real, escolhendo os dois canais direto no Balacopapo Utilidades.

### Fase 7 — Balacopapo Utilidades: Bot de Música / Rádio
- [ ] **Módulo de Música & Rádio integrado ao Balacopapo Utilidades:**
  - **Fila / modo rádio** com controles de tocar, pausar, pular, repetir e volume.
  - **Links do YouTube com `yt-dlp` + cache local** (baixa e guarda os áudios em cache para tocar sem engasgos e reaproveitar).
  - **Integração com Navidrome** (API Subsonic/OpenSubsonic para puxar sua biblioteca e playlists direto do servidor).
  - **Suporte a DLNA / UPnP** (descobrir e tocar faixas de servidores de mídia na rede local).
  - **Mini-player "Tocando agora" dentro do Balacopapo** — exibe a faixa atual + controles de volume/pular direto na barra de voz (via DataChannel), sem precisar abrir outro app.

### Fase 8 — Controle Remoto de Outro PC *(último)*
- [ ] **Controlar outro PC** — acesso remoto seguro (mouse e teclado) via app desktop nativo, com permissão explícita do dono da tela e revogação instantânea a qualquer momento.

---

## Ordem de Execução

```mermaid
flowchart LR
    F0["Fase 0: Rebrand + Deep Links + Temas"] --> F1["Fase 1: Buffer + Bitrate Dinâmico + 320p"]
    F1 --> F2["Fase 2: P2P Arquivos → Mapa → P2P Call"]
    F2 --> F3["Fase 3: OIDC + Ban IP + Retenção"]
    F3 --> F4["Fase 4: Apontar + Jogos + Modo Leigo"]
    F4 --> F5["Fase 5: Overlay + Áudio da Janela"]
    F5 --> F6["Fase 6: Utilidades — Ponte Discord"]
    F6 --> F7["Fase 7: Utilidades — Música/Rádio"]
    F7 --> F8["Fase 8: Controlar Outro PC"]
```
