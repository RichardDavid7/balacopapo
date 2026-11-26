# Feature: `music`

- **Responsabilidade:** Mini-player de Música limpo (faixa atual, Play/Pause, Vote-Skip, Parar e adicionar URL na fila) sincronizado com `/api/channels/:channelId/music`.
- **Regra de UX:** **NUNCA** colocar configuração de porcentagem de Vote-Skip no mini-player — ela vive exclusivamente em `features/settings` (Configurações do Grupo, campo livre `1–100%`).
