# Feature: `settings`

- **Responsabilidade:** Menu vertical de Configurações organizado em 3 escopos (**Usuário**, **Grupo** e **Instância**):
  - **Grupo:** **Vote-Skip (%) em campo livre numérico (`1–100`, sem presets fixos)**, Chaves de API do Grupo (`bp_...`) e Retenção de Arquivos.
  - **Instância (Admin):** OIDC (SSO), Ban IP (feeds OPNsense / Nginx) e Orçamento de Upload.
- **Depende de:** `core/models`, `ui/aether_drift`.
