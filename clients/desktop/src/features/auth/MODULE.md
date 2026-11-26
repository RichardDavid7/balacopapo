# Feature: `auth`

- **Responsabilidade:** Conectar à instância Balacopapo (validação da URL + `/api/instance`), autenticar com usuário/senha (`/api/auth/login`) ou iniciar SSO **OIDC** no navegador do sistema (`balacopapo://auth/callback`).
- **Depende de:** `core/models`, `os/updater`, `ui/aether_drift`.
- **Invariante Zero-Stutter:** Nenhuma animação em loop ou timer ativo; 0% de GPU quando ocioso.
