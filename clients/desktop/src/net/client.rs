use reqwest::Client;
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;

use crate::core::models::{
    AuthUser, ChatMessage, DmChannelSummary, GroupSummary, InstanceInfo, LiveKitTokenResponse,
    LoginResponse, MusicChannelState, OidcHandoffResponse, OidcPollResponse, PresenceStatus,
    SoundboardSound, SpaceApiKeySummary,
};

#[derive(Clone)]
pub struct ApiClient {
    http: Client,
    base_url: String,
    token: Option<String>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum MessagesPayload {
    List(Vec<ChatMessage>),
    Wrapped { messages: Vec<ChatMessage> },
}

impl ApiClient {
    pub fn new(base_url: String, token: Option<String>) -> Result<Self, String> {
        let http = Client::builder()
            .user_agent(format!("Balacopapo-Desktop/{}", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(12))
            .build()
            .map_err(|e| format!("Falha ao inicializar cliente HTTP: {e}"))?;

        Ok(Self {
            http,
            base_url: base_url.trim_end_matches('/').to_string(),
            token,
        })
    }

    pub fn oidc_handoff_start_url(&self, handoff_id: &str) -> String {
        format!(
            "{}/api/auth/oidc/start?handoff={}&client=desktop",
            self.base_url, handoff_id
        )
    }

    pub async fn fetch_instance_info(&self) -> Result<InstanceInfo, String> {
        let url = format!("{}/api/instance/info", self.base_url);
        let resp = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Não foi possível alcançar a instância: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("Instância respondeu HTTP {}", resp.status().as_u16()));
        }

        let mut info = resp
            .json::<InstanceInfo>()
            .await
            .map_err(|e| format!("Resposta inválida de /api/instance/info: {e}"))?;
        if info.name.trim().is_empty() {
            info.name = self.base_url.clone();
        }
        Ok(info)
    }

    /// Fluxo OIDC completo no navegador do sistema usando o handoff nativo do Balacopapo:
    /// `POST /api/auth/oidc/handoff` → abre navegador → polling `GET .../handoff/:id` → `POST /api/auth/oidc/exchange`.
    pub async fn login_with_oidc_browser(&self) -> Result<LoginResponse, String> {
        let handoff_url = format!("{}/api/auth/oidc/handoff", self.base_url);
        let resp = self
            .http
            .post(&handoff_url)
            .send()
            .await
            .map_err(|e| format!("Falha ao iniciar OIDC: {e}"))?;

        if resp.status().as_u16() == 404 {
            return Err("OIDC (SSO) não está configurado nesta instância.".to_string());
        }
        if !resp.status().is_success() {
            return Err(format!(
                "Instância recusou início do OIDC (HTTP {})",
                resp.status().as_u16()
            ));
        }

        let handoff = resp
            .json::<OidcHandoffResponse>()
            .await
            .map_err(|e| format!("Resposta OIDC handoff inválida: {e}"))?;

        let start_url = self.oidc_handoff_start_url(&handoff.handoff_id);
        open::that(&start_url)
            .map_err(|e| format!("Não foi possível abrir o navegador para OIDC: {e}"))?;

        // Aguarda até 3 minutos pelo retorno do login no navegador (polling leve a cada 1.5s).
        let poll_url = format!(
            "{}/api/auth/oidc/handoff/{}?token={}",
            self.base_url, handoff.handoff_id, handoff.poll_token
        );

        for _ in 0..120 {
            tokio::time::sleep(Duration::from_millis(1500)).await;
            let Ok(poll_resp) = self.http.get(&poll_url).send().await else {
                continue;
            };
            if poll_resp.status().as_u16() == 404 {
                return Err("Sessão de login OIDC expirou. Tente novamente.".to_string());
            }
            let Ok(poll) = poll_resp.json::<OidcPollResponse>().await else {
                continue;
            };
            match poll.status.as_str() {
                "ready" => {
                    let ticket = poll
                        .ticket
                        .ok_or_else(|| "Ticket OIDC ausente na resposta.".to_string())?;
                    let exchange_url = format!("{}/api/auth/oidc/exchange", self.base_url);
                    let ex_resp = self
                        .http
                        .post(&exchange_url)
                        .json(&json!({ "ticket": ticket }))
                        .send()
                        .await
                        .map_err(|e| format!("Erro ao finalizar troca OIDC: {e}"))?;
                    if !ex_resp.status().is_success() {
                        return Err(format!(
                            "Falha na troca do ticket OIDC (HTTP {})",
                            ex_resp.status().as_u16()
                        ));
                    }
                    return ex_resp
                        .json::<LoginResponse>()
                        .await
                        .map_err(|e| format!("Resposta OIDC exchange inválida: {e}"));
                }
                "error" => {
                    return Err(format!(
                        "Login OIDC falhou: {}",
                        poll.error.unwrap_or_else(|| "erro desconhecido".to_string())
                    ));
                }
                _ => {}
            }
        }

        Err("Tempo esgotado aguardando login OIDC no navegador.".to_string())
    }

    pub async fn login(&self, identifier: &str, password: &str) -> Result<LoginResponse, String> {
        let url = format!("{}/api/auth/login", self.base_url);
        let payload = json!({
            "username": identifier.trim(),
            "password": password,
        });

        let resp = self
            .http
            .post(&url)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Erro de rede ao autenticar: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("Falha no login (HTTP {status}): {text}"));
        }

        resp.json::<LoginResponse>()
            .await
            .map_err(|e| format!("Resposta inesperada do servidor: {e}"))
    }

    pub async fn fetch_me(&self) -> Result<AuthUser, String> {
        let token = self.require_token()?;
        let url = format!("{}/api/users/@me", self.base_url);
        let resp = self
            .http
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("Erro ao validar sessão: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("Sessão expirada (HTTP {})", resp.status().as_u16()));
        }

        resp.json::<AuthUser>()
            .await
            .map_err(|e| format!("Erro ao ler perfil: {e}"))
    }

    pub async fn fetch_groups(&self) -> Result<Vec<GroupSummary>, String> {
        let token = self.require_token()?;
        let url = format!("{}/api/spaces", self.base_url);
        let resp = self
            .http
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("Erro ao listar grupos: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!(
                "Falha ao carregar grupos (HTTP {})",
                resp.status().as_u16()
            ));
        }

        resp.json::<Vec<GroupSummary>>()
            .await
            .map_err(|e| format!("Erro ao interpretar lista de grupos: {e}"))
    }

    /// Busca detalhes completos de um Grupo (com `channels` e `categories`) via `GET /api/spaces/:id`.
    pub async fn fetch_group_detail(&self, space_id: &str) -> Result<GroupSummary, String> {
        let token = self.require_token()?;
        let url = format!("{}/api/spaces/{space_id}", self.base_url);
        let resp = self
            .http
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("Erro ao carregar canais do grupo: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!(
                "Falha ao carregar grupo (HTTP {})",
                resp.status().as_u16()
            ));
        }

        resp.json::<GroupSummary>()
            .await
            .map_err(|e| format!("Erro ao interpretar canais do grupo: {e}"))
    }

    pub async fn open_or_create_dm(&self, target_user_id: &str) -> Result<DmChannelSummary, String> {
        let token = self.require_token()?;
        let url = format!("{}/api/dm", self.base_url);
        let resp = self
            .http
            .post(&url)
            .bearer_auth(token)
            .json(&json!({ "userId": target_user_id }))
            .send()
            .await
            .map_err(|e| format!("Erro ao abrir DM: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!(
                "Falha ao abrir DM (HTTP {})",
                resp.status().as_u16()
            ));
        }

        resp.json::<DmChannelSummary>()
            .await
            .map_err(|e| format!("Erro ao ler DM criada: {e}"))
    }

    pub async fn fetch_dm_messages(
        &self,
        dm_id: &str,
        before: Option<&str>,
    ) -> Result<Vec<ChatMessage>, String> {
        let token = self.require_token()?;
        let mut url = format!("{}/api/dm/{dm_id}/messages?limit=50", self.base_url);
        if let Some(cursor) = before {
            url.push_str(&format!("&before={cursor}"));
        }
        let resp = self
            .http
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("Erro ao buscar mensagens da DM: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!(
                "Falha ao buscar mensagens da DM (HTTP {})",
                resp.status().as_u16()
            ));
        }

        let payload = resp
            .json::<MessagesPayload>()
            .await
            .map_err(|e| format!("Erro ao interpretar mensagens da DM: {e}"))?;

        let mut list = match payload {
            MessagesPayload::List(v) => v,
            MessagesPayload::Wrapped { messages } => messages,
        };
        list.sort_by(|a, b| a.sort_key().cmp(&b.sort_key()).then(a.id.cmp(&b.id)));
        Ok(list)
    }

    pub async fn send_dm_message(
        &self,
        dm_id: &str,
        content: &str,
        reply_to_id: Option<&str>,
        attachments: &[String],
    ) -> Result<ChatMessage, String> {
        let token = self.require_token()?;
        let url = format!("{}/api/dm/{dm_id}/messages", self.base_url);
        let mut map = serde_json::Map::new();
        map.insert("content".to_string(), json!(content));
        if let Some(rid) = reply_to_id {
            map.insert("replyToId".to_string(), json!(rid));
        }
        if !attachments.is_empty() {
            map.insert("attachments".to_string(), json!(attachments));
        }
        let body = serde_json::Value::Object(map);
        let resp = self
            .http
            .post(&url)
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Erro ao enviar DM: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!(
                "Falha ao enviar DM (HTTP {})",
                resp.status().as_u16()
            ));
        }

        resp.json::<ChatMessage>()
            .await
            .map_err(|e| format!("Erro ao ler DM enviada: {e}"))
    }

    pub async fn fetch_messages(
        &self,
        channel_id: &str,
        before: Option<&str>,
    ) -> Result<Vec<ChatMessage>, String> {
        let token = self.require_token()?;
        let mut url = format!("{}/api/channels/{channel_id}/messages?limit=50", self.base_url);
        if let Some(cursor) = before {
            url.push_str(&format!("&before={cursor}"));
        }

        let resp = self
            .http
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("Erro ao buscar mensagens: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!(
                "Falha ao buscar mensagens (HTTP {})",
                resp.status().as_u16()
            ));
        }

        let payload = resp
            .json::<MessagesPayload>()
            .await
            .map_err(|e| format!("Erro ao interpretar mensagens: {e}"))?;

        let mut list = match payload {
            MessagesPayload::List(v) => v,
            MessagesPayload::Wrapped { messages } => messages,
        };
        // Garante ordem cronológica (mais antigas em cima, mais novas embaixo).
        list.sort_by(|a, b| a.sort_key().cmp(&b.sort_key()).then(a.id.cmp(&b.id)));
        Ok(list)
    }

    pub async fn send_message(
        &self,
        channel_id: &str,
        content: &str,
        reply_to_id: Option<&str>,
        attachments: &[String],
    ) -> Result<ChatMessage, String> {
        let token = self.require_token()?;
        let url = format!("{}/api/channels/{channel_id}/messages", self.base_url);
        let mut map = serde_json::Map::new();
        map.insert("content".to_string(), json!(content));
        if let Some(rid) = reply_to_id {
            map.insert("replyToId".to_string(), json!(rid));
        }
        if !attachments.is_empty() {
            map.insert("attachments".to_string(), json!(attachments));
        }
        let body = serde_json::Value::Object(map);
        let resp = self
            .http
            .post(&url)
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Erro ao enviar mensagem: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!(
                "Falha ao enviar mensagem (HTTP {})",
                resp.status().as_u16()
            ));
        }

        resp.json::<ChatMessage>()
            .await
            .map_err(|e| format!("Erro ao ler mensagem enviada: {e}"))
    }

    pub async fn edit_message(
        &self,
        message_id: &str,
        content: &str,
        is_dm: bool,
    ) -> Result<ChatMessage, String> {
        let token = self.require_token()?;
        let url = if is_dm {
            format!("{}/api/dm/messages/{message_id}", self.base_url)
        } else {
            format!("{}/api/messages/{message_id}", self.base_url)
        };
        let resp = self
            .http
            .patch(&url)
            .bearer_auth(token)
            .json(&json!({ "content": content }))
            .send()
            .await
            .map_err(|e| format!("Erro ao editar mensagem: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!(
                "Falha ao editar mensagem (HTTP {})",
                resp.status().as_u16()
            ));
        }

        resp.json::<ChatMessage>()
            .await
            .map_err(|e| format!("Erro ao ler mensagem editada: {e}"))
    }

    pub async fn delete_message(&self, message_id: &str, is_dm: bool) -> Result<(), String> {
        let token = self.require_token()?;
        let url = if is_dm {
            format!("{}/api/dm/messages/{message_id}", self.base_url)
        } else {
            format!("{}/api/messages/{message_id}", self.base_url)
        };
        let resp = self
            .http
            .delete(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("Erro ao excluir mensagem: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!(
                "Falha ao excluir mensagem (HTTP {})",
                resp.status().as_u16()
            ));
        }
        Ok(())
    }

    pub async fn update_status(&self, status: PresenceStatus) -> Result<(), String> {
        let token = self.require_token()?;
        let url = format!("{}/api/users/@me", self.base_url);
        let resp = self
            .http
            .patch(&url)
            .bearer_auth(token)
            .json(&json!({ "status": status.as_api_str() }))
            .send()
            .await
            .map_err(|e| format!("Erro ao atualizar status: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!(
                "Falha ao atualizar status (HTTP {})",
                resp.status().as_u16()
            ));
        }
        Ok(())
    }

    pub async fn request_livekit_token(
        &self,
        channel_id: &str,
    ) -> Result<LiveKitTokenResponse, String> {
        let token = self.require_token()?;
        let url = format!("{}/api/livekit/token", self.base_url);
        let resp = self
            .http
            .post(&url)
            .bearer_auth(token)
            .json(&json!({ "channelId": channel_id }))
            .send()
            .await
            .map_err(|e| format!("Erro ao solicitar token de voz: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!(
                "Servidor negou acesso de voz (HTTP {})",
                resp.status().as_u16()
            ));
        }

        resp.json::<LiveKitTokenResponse>()
            .await
            .map_err(|e| format!("Erro ao interpretar token LiveKit: {e}"))
    }

    pub async fn fetch_soundboard(
        &self,
        space_id: Option<&str>,
    ) -> Result<Vec<SoundboardSound>, String> {
        let token = self.require_token()?;
        let mut url = format!("{}/api/soundboard", self.base_url);
        if let Some(sid) = space_id {
            url.push_str(&format!("?spaceId={sid}"));
        }
        let resp = self
            .http
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("Erro ao carregar Soundboard: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!(
                "Falha ao listar Soundboard (HTTP {})",
                resp.status().as_u16()
            ));
        }

        let val: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Erro ao ler Soundboard: {e}"))?;

        if let Some(arr) = val.get("sounds") {
            serde_json::from_value(arr.clone())
                .map_err(|e| format!("Erro ao interpretar sons: {e}"))
        } else {
            serde_json::from_value(val).map_err(|e| format!("Erro ao interpretar sons: {e}"))
        }
    }

    pub async fn fetch_audio_bytes(&self, relative_or_abs_url: &str) -> Result<Vec<u8>, String> {
        let token = self.require_token()?;
        let url = if relative_or_abs_url.starts_with("http://")
            || relative_or_abs_url.starts_with("https://")
        {
            relative_or_abs_url.to_string()
        } else {
            format!(
                "{}/{}",
                self.base_url,
                relative_or_abs_url.trim_start_matches('/')
            )
        };

        let resp = self
            .http
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("Erro ao baixar áudio: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("Falha ao baixar áudio (HTTP {})", resp.status().as_u16()));
        }

        resp.bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|e| format!("Erro ao ler bytes de áudio: {e}"))
    }

    pub async fn fetch_dms(&self) -> Result<Vec<DmChannelSummary>, String> {
        let token = self.require_token()?;
        let url = format!("{}/api/dm", self.base_url);
        let resp = self
            .http
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("Erro ao carregar DMs: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("Falha ao listar DMs (HTTP {})", resp.status().as_u16()));
        }

        resp.json::<Vec<DmChannelSummary>>()
            .await
            .map_err(|e| format!("Erro ao interpretar DMs: {e}"))
    }

    pub async fn fetch_music_state(&self, channel_id: &str) -> Result<MusicChannelState, String> {
        let token = self.require_token()?;
        let url = format!("{}/api/channels/{channel_id}/music", self.base_url);
        let resp = self
            .http
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("Erro ao carregar estado da música: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("Falha ao consultar música (HTTP {})", resp.status().as_u16()));
        }

        resp.json::<MusicChannelState>()
            .await
            .map_err(|e| format!("Erro ao interpretar estado da música: {e}"))
    }

    pub async fn add_music_track(&self, channel_id: &str, track_url: &str) -> Result<(), String> {
        let token = self.require_token()?;
        let url = format!("{}/api/channels/{channel_id}/music/queue", self.base_url);
        let resp = self
            .http
            .post(&url)
            .bearer_auth(token)
            .json(&json!({ "url": track_url }))
            .send()
            .await
            .map_err(|e| format!("Erro ao adicionar faixa: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("Falha ao enfileirar faixa (HTTP {})", resp.status().as_u16()));
        }
        Ok(())
    }

    pub async fn vote_skip_music(&self, channel_id: &str) -> Result<(), String> {
        let token = self.require_token()?;
        let url = format!("{}/api/channels/{channel_id}/music/vote-skip", self.base_url);
        let resp = self
            .http
            .post(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("Erro ao votar para pular: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("Falha no Vote-Skip (HTTP {})", resp.status().as_u16()));
        }
        Ok(())
    }

    pub async fn control_music(
        &self,
        channel_id: &str,
        action: &str,
        value: Option<serde_json::Value>,
    ) -> Result<(), String> {
        let token = self.require_token()?;
        let url = format!("{}/api/channels/{channel_id}/music/control", self.base_url);
        let body = match value {
            Some(v) => json!({ "action": action, "value": v }),
            None => json!({ "action": action }),
        };
        let resp = self
            .http
            .post(&url)
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Erro no controle de música: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("Falha no controle de música (HTTP {})", resp.status().as_u16()));
        }
        Ok(())
    }

    pub async fn update_music_vote_skip(
        &self,
        channel_id: &str,
        vote_skip_percent: u32,
    ) -> Result<(), String> {
        let token = self.require_token()?;
        let url = format!("{}/api/channels/{channel_id}/music/settings", self.base_url);
        let pct = vote_skip_percent.clamp(1, 100);
        let resp = self
            .http
            .patch(&url)
            .bearer_auth(token)
            .json(&json!({ "voteSkipThresholdPct": pct, "voteSkipPercent": pct }))
            .send()
            .await
            .map_err(|e| format!("Erro ao salvar Vote-Skip: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("Falha ao salvar Vote-Skip (HTTP {})", resp.status().as_u16()));
        }
        Ok(())
    }

    pub async fn update_profile(
        &self,
        display_name: &str,
        bio: &str,
    ) -> Result<AuthUser, String> {
        let token = self.require_token()?;
        let url = format!("{}/api/users/@me", self.base_url);
        let resp = self
            .http
            .patch(&url)
            .bearer_auth(token)
            .json(&json!({
                "displayName": display_name,
                "bio": bio,
            }))
            .send()
            .await
            .map_err(|e| format!("Erro ao atualizar perfil: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!(
                "Falha ao atualizar perfil (HTTP {})",
                resp.status().as_u16()
            ));
        }

        resp.json::<AuthUser>()
            .await
            .map_err(|e| format!("Erro ao ler perfil atualizado: {e}"))
    }

    pub async fn create_group(&self, name: &str) -> Result<GroupSummary, String> {
        let token = self.require_token()?;
        let url = format!("{}/api/spaces", self.base_url);
        let resp = self
            .http
            .post(&url)
            .bearer_auth(token)
            .json(&json!({ "name": name }))
            .send()
            .await
            .map_err(|e| format!("Erro ao criar grupo: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!(
                "Falha ao criar grupo (HTTP {})",
                resp.status().as_u16()
            ));
        }

        resp.json::<GroupSummary>()
            .await
            .map_err(|e| format!("Erro ao ler grupo criado: {e}"))
    }

    pub async fn create_channel(
        &self,
        space_id: &str,
        name: &str,
        kind: &str,
    ) -> Result<(), String> {
        let token = self.require_token()?;
        let url = format!("{}/api/spaces/{space_id}/channels", self.base_url);
        let resp = self
            .http
            .post(&url)
            .bearer_auth(token)
            .json(&json!({ "name": name, "type": kind }))
            .send()
            .await
            .map_err(|e| format!("Erro ao criar canal: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!(
                "Falha ao criar canal (HTTP {})",
                resp.status().as_u16()
            ));
        }
        Ok(())
    }

    pub async fn create_space_api_key(
        &self,
        space_id: &str,
        name: &str,
    ) -> Result<(SpaceApiKeySummary, String), String> {
        let token = self.require_token()?;
        let url = format!("{}/api/spaces/{space_id}/api-keys", self.base_url);
        let resp = self
            .http
            .post(&url)
            .bearer_auth(token)
            .json(&json!({ "name": name }))
            .send()
            .await
            .map_err(|e| format!("Erro ao criar chave de API: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!(
                "Falha ao criar chave de API (HTTP {})",
                resp.status().as_u16()
            ));
        }

        let val: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Erro ao ler resposta da chave: {e}"))?;
        let key_val = val
            .get("apiKey")
            .ok_or_else(|| "Resposta sem campo apiKey".to_string())?;
        let summary: SpaceApiKeySummary = serde_json::from_value(key_val.clone())
            .map_err(|e| format!("Erro ao interpretar chave criada: {e}"))?;
        let secret = val
            .get("secret")
            .and_then(|s| s.as_str())
            .unwrap_or_default()
            .to_string();
        Ok((summary, secret))
    }

    pub async fn revoke_space_api_key(&self, space_id: &str, key_id: &str) -> Result<(), String> {
        let token = self.require_token()?;
        let url = format!("{}/api/spaces/{space_id}/api-keys/{key_id}", self.base_url);
        let resp = self
            .http
            .delete(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("Erro ao revogar chave: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!(
                "Falha ao revogar chave (HTTP {})",
                resp.status().as_u16()
            ));
        }
        Ok(())
    }

    pub async fn fetch_space_api_keys(
        &self,
        space_id: &str,
    ) -> Result<Vec<SpaceApiKeySummary>, String> {
        let token = self.require_token()?;
        let url = format!("{}/api/spaces/{space_id}/api-keys", self.base_url);
        let resp = self
            .http
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("Erro ao listar chaves de API: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("Falha ao listar chaves (HTTP {})", resp.status().as_u16()));
        }

        let val: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Erro ao ler chaves de API: {e}"))?;
        if let Some(arr) = val.get("apiKeys").or_else(|| val.get("keys")) {
            serde_json::from_value(arr.clone())
                .map_err(|e| format!("Erro ao interpretar chaves: {e}"))
        } else {
            serde_json::from_value(val).map_err(|e| format!("Erro ao interpretar chaves: {e}"))
        }
    }

    /// Baixa bytes de uma imagem (ícone de Grupo ou avatar de usuário), suportando caminhos relativos.
    pub async fn fetch_image_bytes(&self, url_or_path: &str) -> Result<Vec<u8>, String> {
        let trimmed = url_or_path.trim();
        if trimmed.is_empty() {
            return Err("URL de imagem vazia".to_string());
        }
        let full_url = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
            trimmed.to_string()
        } else if trimmed.starts_with('/') {
            format!("{}{trimmed}", self.base_url)
        } else {
            format!("{}/api/uploads/{trimmed}", self.base_url)
        };
        let mut req = self.http.get(&full_url);
        if full_url.starts_with(&self.base_url) {
            if let Some(tok) = self.token.as_deref().filter(|t| !t.is_empty()) {
                req = req.bearer_auth(tok);
            }
        }
        let resp = req
            .send()
            .await
            .map_err(|e| format!("Erro ao baixar imagem: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("Imagem indisponível (HTTP {})", resp.status().as_u16()));
        }
        resp.bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|e| format!("Erro ao ler bytes da imagem: {e}"))
    }

    /// Faz upload resumível via protocolo TUS (`POST /api/files` + `PATCH <Location>`) e retorna o `attachmentId`.
    pub async fn upload_file_tus(
        &self,
        filename: &str,
        mimetype: &str,
        bytes: Vec<u8>,
    ) -> Result<String, String> {
        let token = self.require_token()?;
        let meta = format!(
            "filename {},filetype {}",
            base64_encode(filename.as_bytes()),
            base64_encode(mimetype.as_bytes()),
        );
        let create_url = format!("{}/api/files", self.base_url);
        let create_resp = self
            .http
            .post(&create_url)
            .bearer_auth(token)
            .header("Tus-Resumable", "1.0.0")
            .header("Upload-Length", bytes.len().to_string())
            .header("Upload-Metadata", meta)
            .send()
            .await
            .map_err(|e| format!("Erro ao iniciar upload: {e}"))?;

        if !create_resp.status().is_success() {
            return Err(format!(
                "Falha ao iniciar upload (HTTP {})",
                create_resp.status().as_u16()
            ));
        }

        let loc = create_resp
            .headers()
            .get("location")
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| "Servidor não retornou cabeçalho Location no upload.".to_string())?
            .to_string();

        let patch_url = if loc.starts_with("http://") || loc.starts_with("https://") {
            loc
        } else {
            format!("{}/{}", self.base_url, loc.trim_start_matches('/'))
        };

        let patch_resp = self
            .http
            .patch(&patch_url)
            .bearer_auth(token)
            .header("Tus-Resumable", "1.0.0")
            .header("Upload-Offset", "0")
            .header("Content-Type", "application/offset+octet-stream")
            .body(bytes)
            .send()
            .await
            .map_err(|e| format!("Erro ao enviar arquivo: {e}"))?;

        if !patch_resp.status().is_success() {
            return Err(format!(
                "Falha ao concluir upload (HTTP {})",
                patch_resp.status().as_u16()
            ));
        }

        let val: serde_json::Value = patch_resp
            .json()
            .await
            .map_err(|e| format!("Erro ao ler resposta do upload: {e}"))?;
        val.get("id")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .ok_or_else(|| "Upload concluído sem ID de anexo.".to_string())
    }

    fn require_token(&self) -> Result<&str, String> {
        self.token
            .as_deref()
            .filter(|t| !t.is_empty())
            .ok_or_else(|| "Sessão não autenticada.".to_string())
    }
}

fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((n >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(n & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}
