#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OidcPublicConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub password_login_disabled: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceInfo {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub oidc: OidcPublicConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OidcHandoffResponse {
    pub handoff_id: String,
    pub poll_token: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OidcPollResponse {
    pub status: String,
    #[serde(default)]
    pub ticket: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
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
    #[serde(default, alias = "avatar")]
    pub avatar_url: Option<String>,
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

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleSummary {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub position: i32,
    #[serde(default)]
    pub hoist: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupMember {
    pub user_id: String,
    #[serde(default)]
    pub nickname: Option<String>,
    pub user: AuthUser,
    #[serde(default)]
    pub roles: Vec<RoleSummary>,
}

impl GroupMember {
    pub fn display_name(&self) -> &str {
        self.nickname
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| self.user.label())
    }

    pub fn is_online(&self) -> bool {
        !matches!(
            self.user
                .status
                .as_deref()
                .unwrap_or("offline")
                .to_ascii_lowercase()
                .as_str(),
            "offline" | "invisible"
        )
    }

    pub fn color_hex(&self) -> Option<&str> {
        self.roles
            .iter()
            .filter(|r| r.color.as_deref().is_some_and(|c| !c.is_empty()))
            .max_by_key(|r| r.position)
            .and_then(|r| r.color.as_deref())
    }
}

/// Um "Grupo" no Balacopapo (campo `spaces` na API REST por compatibilidade).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupSummary {
    pub id: String,
    pub name: String,
    #[serde(default, alias = "icon")]
    pub icon_url: Option<String>,
    #[serde(default)]
    pub categories: Vec<ChannelCategory>,
    #[serde(default)]
    pub channels: Vec<ChannelSummary>,
    #[serde(default)]
    pub roles: Vec<RoleSummary>,
    #[serde(default)]
    pub members: Vec<GroupMember>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceUserMediaState {
    #[serde(default)]
    pub is_muted: bool,
    #[serde(default)]
    pub is_deafened: bool,
    #[serde(default)]
    pub is_camera_on: bool,
    #[serde(default)]
    pub is_screen_sharing: bool,
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

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageAttachment {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub filename: String,
    #[serde(default)]
    pub original_name: String,
    #[serde(default)]
    pub mimetype: String,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub thumbnail_filename: Option<String>,
}

impl MessageAttachment {
    pub fn is_image(&self) -> bool {
        self.mimetype.starts_with("image/")
    }

    pub fn preview_path(&self) -> String {
        let name = self
            .thumbnail_filename
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(&self.filename);
        if name.starts_with("http://") || name.starts_with("https://") || name.starts_with('/') {
            name.to_string()
        } else {
            format!("/api/uploads/{name}")
        }
    }

    pub fn full_path(&self) -> String {
        let name = &self.filename;
        if name.starts_with("http://") || name.starts_with("https://") || name.starts_with('/') {
            name.to_string()
        } else {
            format!("/api/uploads/{name}")
        }
    }

    pub fn size_label(&self) -> String {
        if self.size >= 1_048_576 {
            format!("{:.1} MB", self.size as f64 / 1_048_576.0)
        } else {
            format!("{} KB", (self.size / 1024).max(1))
        }
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageReaction {
    #[serde(default)]
    pub emoji: String,
    #[serde(default)]
    pub user_id: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageReplyRef {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub user: Option<AuthUser>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    #[serde(default, alias = "dmChannelId")]
    pub channel_id: String,
    #[serde(default)]
    pub user_id: Option<String>,
    #[allow(dead_code)]
    #[serde(default)]
    pub reply_to_id: Option<String>,
    #[serde(default)]
    pub reply_to: Option<Box<MessageReplyRef>>,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub created_at: serde_json::Value,
    #[serde(default)]
    pub edited_at: Option<serde_json::Value>,
    #[serde(default)]
    pub user: Option<AuthUser>,
    #[serde(default)]
    pub attachments: Vec<MessageAttachment>,
    #[serde(default)]
    pub reactions: Vec<MessageReaction>,
}

impl ChatMessage {
    pub fn author_label(&self) -> &str {
        self.user
            .as_ref()
            .map(AuthUser::label)
            .or(self.user_id.as_deref())
            .unwrap_or("Usuário")
    }

    pub fn body_text(&self) -> &str {
        self.content.as_deref().unwrap_or("")
    }

    pub fn is_edited(&self) -> bool {
        matches!(&self.edited_at, Some(v) if !v.is_null())
    }

    pub fn sort_key(&self) -> i64 {
        if let Some(ms) = self.created_at.as_i64() {
            return ms;
        }
        self.id.parse::<i64>().unwrap_or(0)
    }

    pub fn short_time(&self) -> String {
        if let Some(ms) = self.created_at.as_i64() {
            let secs = ms / 1000;
            let day_secs = secs.rem_euclid(86_400);
            let h = (day_secs / 3600) as u8;
            let m = ((day_secs % 3600) / 60) as u8;
            return format!("{h:02}:{m:02}");
        }
        if let Some(iso) = self.created_at.as_str() {
            if let Some((_, rest)) = iso.split_once('T') {
                if rest.len() >= 5 {
                    return rest[..5].to_string();
                }
            }
        }
        String::new()
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DmChannelSummary {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub owner_id: Option<String>,
    #[serde(default, alias = "participants")]
    pub members: Vec<AuthUser>,
}

impl DmChannelSummary {
    pub fn is_group_dm(&self) -> bool {
        self.owner_id.is_some() || self.members.len() > 2
    }

    pub fn display_label(&self, my_user_id: &str) -> String {
        if let Some(name) = self.name.as_deref().filter(|n| !n.trim().is_empty()) {
            return name.to_string();
        }
        let others: Vec<&str> = self
            .members
            .iter()
            .filter(|u| u.id != my_user_id)
            .map(AuthUser::label)
            .collect();
        if others.is_empty() {
            self.members
                .first()
                .map(|u| u.label().to_string())
                .unwrap_or_else(|| "Conversa Direta".to_string())
        } else {
            others.join(", ")
        }
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTrack {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub requested_by: Option<String>,
    #[serde(default)]
    pub duration_seconds: Option<u32>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicChannelState {
    #[serde(default)]
    pub channel_id: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub current_track: Option<MusicTrack>,
    #[serde(default)]
    pub queue: Vec<MusicTrack>,
    #[serde(default = "default_music_volume")]
    pub volume: u32,
    #[serde(default)]
    pub loop_mode: String,
    #[serde(default = "default_vote_skip", alias = "voteSkipThresholdPct")]
    pub vote_skip_percent: u32,
    #[serde(default)]
    pub listener_count: u32,
    #[serde(default)]
    pub skip_votes: Vec<String>,
    #[serde(default)]
    pub bot_connected: bool,
}

fn default_music_volume() -> u32 {
    80
}

fn default_vote_skip() -> u32 {
    50
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceApiKeySummary {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub key_prefix: String,
    #[serde(default)]
    pub scopes: Vec<String>,
}

#[derive(Debug, Clone)]
pub enum WsEvent {
    Connected,
    Disconnected(String),
    Ready {
        user: AuthUser,
        groups: Vec<GroupSummary>,
        dm_channels: Vec<DmChannelSummary>,
        unread_counts: HashMap<String, u32>,
        voice_states: HashMap<String, Vec<String>>,
        voice_user_states: HashMap<String, VoiceUserMediaState>,
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
    VoiceStateUpdate {
        channel_id: String,
        user_id: String,
        action: String,
    },
    SpaceVoiceState {
        voice_states: HashMap<String, Vec<String>>,
        voice_user_states: HashMap<String, VoiceUserMediaState>,
    },
    MusicStateUpdated(MusicChannelState),
    Typing {
        channel_id: String,
        user_id: String,
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
            let dm_channels: Vec<DmChannelSummary> = val
                .get("dmChannels")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();
            let unread_counts: HashMap<String, u32> = val
                .get("unreadCounts")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();
            let voice_states: HashMap<String, Vec<String>> = val
                .get("voiceStates")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();
            let voice_user_states: HashMap<String, VoiceUserMediaState> = val
                .get("voiceUserStates")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();
            Some(WsEvent::Ready {
                user,
                groups,
                dm_channels,
                unread_counts,
                voice_states,
                voice_user_states,
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
        "voice_state_update" => {
            let channel_id = val.get("channelId")?.as_str()?.to_string();
            let user_id = val.get("userId")?.as_str()?.to_string();
            let action = val.get("action")?.as_str()?.to_string();
            Some(WsEvent::VoiceStateUpdate {
                channel_id,
                user_id,
                action,
            })
        }
        "space_voice_state" => {
            let voice_states: HashMap<String, Vec<String>> = val
                .get("voiceStates")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();
            let voice_user_states: HashMap<String, VoiceUserMediaState> = val
                .get("voiceUserStates")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();
            Some(WsEvent::SpaceVoiceState {
                voice_states,
                voice_user_states,
            })
        }
        "music_state_updated" => {
            let state: MusicChannelState =
                serde_json::from_value(val.get("state")?.clone()).ok()?;
            Some(WsEvent::MusicStateUpdated(state))
        }
        "typing" | "typing_start" => {
            let channel_id = val
                .get("channelId")
                .or_else(|| val.get("dmChannelId"))?
                .as_str()?
                .to_string();
            let user_id = val.get("userId")?.as_str()?.to_string();
            Some(WsEvent::Typing {
                channel_id,
                user_id,
            })
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
                assert_eq!(msg.body_text(), "oi");
            }
            other => panic!("esperava MessageCreated, veio {other:?}"),
        }

        assert!(parse_ws_server_event(r#"{"type":"future_event","foo":1}"#).is_none());
    }
}
