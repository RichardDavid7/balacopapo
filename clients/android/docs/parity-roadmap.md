# Checklist Mestre de Paridade — Backspace Android (Web + Mumble/Mumla)

> **Regra de versionamento (SemVer a partir de `0.10.0`):**
> - **Patch (`0.14.1`, `0.14.2`...):** correções de bugs, ajustes visuais ou melhorias pontuais.
> - **Minor (`0.14.0`, `0.15.0`...):** novas fases de paridade completa.
> - **Major (`1.0.0`):** paridade completa com a versão web atingida e estável.

---

## Blocos Concluídos (`v0.10.0` – `v0.13.1`)
- [x] **Bloco A (`v0.10.0`):** Navegação (Mensagens home), badges de não lidas em DMs, badges de menções em Espaços/Canais, Figurinhas WebP.
- [x] **Bloco B (`v0.11.0`):** Áudio estilo Mumble/Mumla (VAD/PTT + botão Vol+/Vol-, VU Meter, volume mestre, audio ducking, frame size Opus, modo economia de dados, sons `.ogg` via `SoundPool`, persistência em `SharedPreferences`).
- [x] **Bloco C (`v0.12.0`–`v0.12.1`):** Markdown básico, autocomplete `@menções`, embeds e cartões de convite, upload/exclusão de stickers pessoais, upload de avatar, PTT zero-latency.
- [x] **Bloco D (`v0.13.0`–`v0.13.1`):** Chamada recebida com toque, Picture-in-Picture (PiP), qualidade de Screen Share, Soundboard Manager, chat dentro da call, pinch-to-zoom em imagens, fix de congelamento ao desconectar remotamente.

---

## Plano Completo de Paridade Web (`v0.14.0` → `v1.0.0`)

### Fase 1 (`v0.14.0`) — Nova Arquitetura de Configurações (Menu Vertical + 10 Sub-telas da Instância) & Correções Críticas
- [x] Menu vertical agrupado de **Configurações de Usuário** com subtelas dedicadas (Conta completa com banner/cores/alterar senha/excluir conta, Aparência com 5 idiomas e escala, Voz & Vídeo organizado, Privacidade `discoverable`/`showActivity`, Conexões, Notificações, Aplicativo & Atualizações SemVer).
- [x] Menu e **10 sub-telas da Instância (Admin)**: Geral (3 níveis de descoberta + GIFs + cartão apoio), Registro & Convites (CRUD + resgates), Federação (relay, resets, aprovações, peers), Transmissão (resoluções, FPS, limites de bitrate), Áudio Opus, Soundboard Global, Armazenamento & Limpeza (dry-run + executar), Usuários (filtros, admin, reset senha, excluir), Atualizações do Servidor, Telemetria (opt-in + prévia JSON).
- [x] Corrigir bug do índice da aba Instância (`selectedTab == 1`), barra compacta global de voz (`GlobalVoiceMiniBar`), scroll + olho de senha em `AuthScreen`, fix de auto-scroll no Chat, fix de subcategorias aninhadas e diálogos de confirmação em ações destrutivas.

### Fase 2 (`v0.15.0`) — Administração Completa de Espaços, Canais, Categorias & 22 Permissões
- [x] Expandir `PermissionBits` para todos os 23 bits oficiais + cálculo efetivo + `held-bits`.
- [x] Tela completa de **Configurações do Espaço** (Visão Geral com ícone/banner/transferir posse/excluir/sair, Descoberta + solicitações de entrada, Membros + apelido + cargos, Cargos + matriz 23 bits + reordenação, Áudio Opus, Soundboard do Espaço, Banimentos, Convites diretos por DM).
- [x] **Configurações de Canal & Categoria** (tópico, privacidade, Opus, overrides tri-estado por cargo/membro) + criação em categoria + reordenação de canais/categorias + fixes de `BackHandler`, alinhamento de insets e perfil clicável no Chat/DMs.

### Fase 3 (`v0.16.0`) — Pastas de Espaços, Notificações & Explorar Completo
- [ ] **Pastas de Espaços (`SpaceFolder`)** sincronizadas com o servidor (`space-layout`) + indicadores de não lidas em canais e categorias recolhidas.
- [ ] **Notificações por Espaço/Canal** (`inherit`/`all`/`mentions`/`nothing`, silenciar temporariamente, suprimir `@everyone`/cargos) + **Notificações Android em background** abrindo a conversa/call diretamente.
- [ ] **Explorar Completo**: Inner Space (home + federadas), Outer Space (diretório público), prévia de convite e solicitações de entrada.

### Fase 4 (`v0.17.0`) — Chat Completo, Busca Server-Side, Player de Vídeo/Áudio & Stickers
- [ ] Paginação em DMs, fix de auto-scroll ao carregar histórico, agrupamento de mensagens (5 min), divisores de data e não lidas (`UnreadDivider`), botão "Ir para o presente", salto clicável (`/messages/around`), marcar como não lida, tópico no cabeçalho, `MANAGE_MESSAGES`, `channel_poke`, mensagens de sistema de DM.
- [ ] **Busca Server-Side** com filtros (`from:`, `has:`, `before:`, `after:`).
- [ ] **Markdown completo** (blocos de código multilinha com copiar, citações, listas, títulos, `:shortcode:`, menções de cargo `<@&roleId>`).
- [ ] **Player inline de Vídeo e Áudio**, salvar mídia, coletar stickers de mensagens, `EmojiPicker` completo + stickers como reação, uploads `tus` resumíveis com progresso e rascunhos.

### Fase 5 (`v0.18.0`) — DMs, Grupos de DM, Amigos, Perfis Completos & Chamadas DM
- [ ] Amigos completo (Online, Todos, Pendentes recebidos/enviados com Cancelar, Adicionar Amigo com busca/descoberta/federado, Atividade).
- [ ] Grupos de DM completo (criar com nome, expandir DM 1:1, renomear, ícone, adicionar/expulsar membros, transferir posse, sair, fechar DM 1:1, busca e preview).
- [ ] **Perfis Completos** (3 abas: Sobre, Amigos em Comum, Espaços em Comum) clicável em qualquer tela.
- [ ] **Chamadas DM completas** (`dm_call_start`/`dm_call_end`, tela de chamada de saída, entrar em chamada de grupo ativa).

### Fase 6 (`v0.19.0`) — Voz WebRTC Real, Múltiplos Streams, Chat da Call & Soundboard
- [ ] **Mensagens / Chat do Canal de Voz** acessível logo abaixo/ao lado do nome do canal (sem precisar entrar na call) + sheet de entrada (`MobileVoiceJoinSheet`) com prévia de participantes e chat.
- [ ] Telemetria WebRTC real (RTT, jitter, perda de pacotes, ICE, TX/RX, `OpusFmtpParser`), gate VAD real, teste de microfone fora de call, reconfiguração ao vivo, chip `WIRED_HEADSET`.
- [ ] Múltiplos streams opt-in, volume/ducking por stream, pinch-to-zoom em stream, silenciar soundboard por usuário, parar de assistir câmera remota, moderação completa (toggle mute/deafen + `voice_move`).
- [ ] Soundboard com pastas recolhíveis, prévia local, mutar rápido e editor de recorte/normalização no upload.

### Fase 7 (`v0.20.0`) — Sincronização WebSocket 100%, Federação Completa & Hub do Projeto
- [ ] Tratar todos os eventos WebSocket faltantes (DM, grupos, canais, categorias, membros, amigos, embeds, notificações, pastas, voz, federação).
- [ ] **Conexões Federadas** completas (adicionar, filtros, reconectar, reautenticar, excluir identidade remota, peering).
- [ ] **Hub do Projeto (`/backspace`)**.

### Fase 8 (`v1.0.0`) — Polimento Final, i18n 100% (5 Idiomas) & Estabilização
- [ ] 100% das strings em `strings.xml` nos 5 idiomas (`check-i18n.mjs` com `0 findings`).
- [ ] `ModalBottomSheet` M3 e telas dedicadas substituindo diálogos apertados.
- [ ] Atualizador in-app com SemVer + testes unitários Kotlin e estabilização final.
