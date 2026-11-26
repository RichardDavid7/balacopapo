use reqwest::Client;
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;

use crate::core::models::{
    AuthUser, ChatMessage, GroupSummary, InstanceInfo, LoginResponse, PresenceStatus,
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

    pub fn oidc_start_url(&self) -> String {
        format!(
            "{}/api/auth/oidc/start?redirect=balacopapo://auth/callback",
            self.base_url
        )
    }

    pub async fn fetch_instance_info(&self) -> Result<InstanceInfo, String> {
        let url = format!("{}/api/instance", self.base_url);
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
            .unwrap_or_else(|_| InstanceInfo {
                name: self.base_url.clone(),
                ..Default::default()
            });
        if info.name.trim().is_empty() {
            info.name = self.base_url.clone();
        }
        Ok(info)
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
        list.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));
        Ok(list)
    }

    pub async fn send_message(
        &self,
        channel_id: &str,
        content: &str,
    ) -> Result<ChatMessage, String> {
        let token = self.require_token()?;
        let url = format!("{}/api/channels/{channel_id}/messages", self.base_url);
        let resp = self
            .http
            .post(&url)
            .bearer_auth(token)
            .json(&json!({ "content": content }))
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

    pub async fn delete_message(&self, message_id: &str) -> Result<(), String> {
        let token = self.require_token()?;
        let url = format!("{}/api/messages/{message_id}", self.base_url);
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

    fn require_token(&self) -> Result<&str, String> {
        self.token
            .as_deref()
            .filter(|t| !t.is_empty())
            .ok_or_else(|| "Sessão não autenticada.".to_string())
    }
}
