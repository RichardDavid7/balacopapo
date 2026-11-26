#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceInfo {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub oidc_enabled: bool,
    #[serde(default)]
    pub oidc_provider_name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PresenceStatus {
    Online,
    Idle,
    Dnd,
    Invisible,
}

impl PresenceStatus {
    pub fn as_api_str(self) -> &'static str {
        match self {
            Self::Online => "online",
            Self::Idle => "idle",
            Self::Dnd => "dnd",
            Self::Invisible => "invisible",
        }
    }

    pub fn from_api_str(raw: Option<&str>) -> Self {
        match raw.unwrap_or("online").to_ascii_lowercase().as_str() {
            "idle" | "away" => Self::Idle,
            "dnd" => Self::Dnd,
            "invisible" | "offline" => Self::Invisible,
            _ => Self::Online,
        }
    }

    pub fn label_pt(self) -> &'static str {
        match self {
            Self::Online => "Online",
            Self::Idle => "Ausente",
            Self::Dnd => "Não Perturbe",
            Self::Invisible => "Invisível",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthUser {
    pub id: String,
    pub username: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
}

impl AuthUser {
    pub fn label(&self) -> &str {
        self.display_name
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(&self.username)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginResponse {
    pub token: String,
    pub user: AuthUser,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelCategory {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub position: i32,
}

/// Um "Grupo" no Balacopapo (campo `spaces` na API REST por compatibilidade).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupSummary {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub categories: Vec<ChannelCategory>,
    #[serde(default)]
    pub channels: Vec<ChannelSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelSummary {
    pub id: String,
    pub name: String,
    #[serde(rename = "type", default)]
    pub kind: String,
    #[serde(default)]
    pub category_id: Option<String>,
    #[serde(default)]
    pub topic: Option<String>,
    #[serde(default)]
    pub position: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub channel_id: String,
    #[serde(default)]
    pub user_id: Option<String>,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub user: Option<AuthUser>,
}

impl ChatMessage {
    pub fn author_label(&self) -> &str {
        self.user
            .as_ref()
            .map(AuthUser::label)
            .or(self.user_id.as_deref())
            .unwrap_or("Usuário")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveKitTokenResponse {
    pub token: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundboardSound {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub emoji: Option<String>,
    #[serde(default)]
    pub folder: Option<String>,
    #[serde(default)]
    pub file_url: String,
    #[serde(default)]
    pub duration_ms: Option<u32>,
}

#[derive(Debug, Clone)]
pub enum WsEvent {
    Connected,
    Disconnected(String),
    Ready {
        user: AuthUser,
        groups: Vec<GroupSummary>,
        unread_counts: HashMap<String, u32>,
    },
    MessageCreated(ChatMessage),
    MessageUpdated(ChatMessage),
    MessageDeleted {
        channel_id: String,
        message_id: String,
    },
    PresenceUpdate {
        user_id: String,
        status: String,
    },
}

/// Decodifica um frame JSON do servidor sem nunca falhar em eventos desconhecidos.
pub fn parse_ws_server_event(raw: &str) -> Option<WsEvent> {
    let val: serde_json::Value = serde_json::from_str(raw).ok()?;
    let event_type = val.get("type")?.as_str()?;

    match event_type {
        "ready" => {
            let user: AuthUser = serde_json::from_value(val.get("user")?.clone()).ok()?;
            let groups: Vec<GroupSummary> = val
                .get("spaces")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();
            let unread_counts: HashMap<String, u32> = val
                .get("unreadCounts")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();
            Some(WsEvent::Ready {
                user,
                groups,
                unread_counts,
            })
        }
        "message_created" => {
            let msg: ChatMessage = serde_json::from_value(val.get("message")?.clone()).ok()?;
            Some(WsEvent::MessageCreated(msg))
        }
        "message_updated" => {
            let msg: ChatMessage = serde_json::from_value(val.get("message")?.clone()).ok()?;
            Some(WsEvent::MessageUpdated(msg))
        }
        "message_deleted" => {
            let message_id = val.get("messageId")?.as_str()?.to_string();
            let channel_id = val.get("channelId")?.as_str()?.to_string();
            Some(WsEvent::MessageDeleted {
                channel_id,
                message_id,
            })
        }
        "presence_update" => {
            let user_id = val.get("userId")?.as_str()?.to_string();
            let status = val.get("status")?.as_str()?.to_string();
            Some(WsEvent::PresenceUpdate { user_id, status })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_message_created_and_ignores_unknown_events() {
        let json = r#"{"type":"message_created","message":{"id":"m1","channelId":"c1","userId":"u1","content":"oi","createdAt":"2026-11-26T00:00:00Z"}}"#;
        match parse_ws_server_event(json) {
            Some(WsEvent::MessageCreated(msg)) => {
                assert_eq!(msg.id, "m1");
                assert_eq!(msg.channel_id, "c1");
                assert_eq!(msg.content, "oi");
            }
            other => panic!("esperava MessageCreated, veio {other:?}"),
        }

        assert!(parse_ws_server_event(r#"{"type":"future_event","foo":1}"#).is_none());
    }
}
