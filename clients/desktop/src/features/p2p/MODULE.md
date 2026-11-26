# Feature: `p2p`

- **Responsabilidade:** Painel da **Malha P2P Híbrida (Fases 2A, 2B e 2C)** — toggle de 1 clique, **Mapa Visual da Malha em Canvas GPU (`iced::widget::canvas`)** com RTT direto e latência até a instância, indicador de **Modo Sobrevivência P2P** quando o servidor cai, e bandeja de **Transferência P2P de Arquivos** com consentimento obrigatório (Aceitar / Recusar).
- **Depende de:** `core/p2p_mesh`, `ui/aether_drift`.
- **Invariante Zero-Stutter:** Canvas GPU redesenha somente quando chega nova medição RTT ou muda consentimento (0% GPU quando parado).
