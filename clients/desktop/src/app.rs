use iced::{Element, Subscription, Task, Theme};
use std::sync::atomic::Ordering;

use crate::core::config::{normalize_instance_url, AppConfig};
use crate::core::deep_link::{parse_deep_link, DeepLinkTarget};
use crate::core::i18n::{AppLanguage, ClockFormat};
use crate::core::models::{
    AuthUser, ChatMessage, DmChannelSummary, GroupSummary, InstanceInfo, LiveKitTokenResponse,
    LoginResponse, MusicChannelState, PresenceStatus, SoundboardSound, SpaceApiKeySummary, WsEvent,
};
use crate::core::p2p_mesh::FileTransferStatus;
use crate::features::auth::{self, AuthMessage, AuthState};
use crate::features::chat::ChatMessageAction;
use crate::features::dm::DmAction;
use crate::features::music::MusicAction;
use crate::features::overlay::OverlayAction;
use crate::features::p2p::P2PAction;
use crate::features::settings::{parse_vote_skip_percent, SettingsAction};
use crate::features::shell::{self, ActivePanel, ShellMessage, ShellState};
use crate::features::soundboard::SoundboardAction;
use crate::features::stream::{ActivePointerPing, StreamAction};
use crate::features::voice::VoiceAction;
use crate::media::audio_engine::{self, ActiveLoopback, AudioParams};
use crate::media::wav_dsp::{quadratic_gain, WavClip};
use crate::net::client::ApiClient;
use crate::net::ws;
use crate::os::autostart;
use crate::os::notifications;
use crate::os::updater::{self, UpdateCheckState};
use crate::ui::aether_drift::{self, AppThemeId};

pub enum Screen {
    Auth(AuthState),
    Shell(Box<ShellState>),
}

pub struct BalacopapoApp {
    config: AppConfig,
    screen: Screen,
    update_state: UpdateCheckState,
    audio_params: AudioParams,
    active_loopback: Option<ActiveLoopback>,
    ws_tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
}

#[derive(Debug, Clone)]
pub enum Message {
    Auth(AuthMessage),
    Shell(ShellMessage),
    WsEvent(WsEvent),
    InstanceProbed(Result<(String, InstanceInfo), String>),
    LoginCompleted(Result<(String, LoginResponse), String>),
    SessionRestored(Result<(String, AuthUser), String>),
    GroupsLoaded(Result<Vec<GroupSummary>, String>),
    GroupDetailLoaded(Result<GroupSummary, String>),
    MessagesLoaded {
        channel_id: String,
        prepend: bool,
        result: Result<Vec<ChatMessage>, String>,
    },
    ChatSent(Result<ChatMessage, String>),
    ChatEdited(Result<ChatMessage, String>),
    AttachmentUploaded(Result<Option<(String, String)>, String>),
    ChatDeleted {
        channel_id: String,
        message_id: String,
        result: Result<(), String>,
    },
    StatusUpdated(Result<PresenceStatus, String>),
    VoiceTokenReceived {
        channel_id: String,
        channel_name: String,
        result: Result<LiveKitTokenResponse, String>,
    },
    SoundboardLoaded(Result<Vec<SoundboardSound>, String>),
    SoundboardClipFetched {
        name: String,
        result: Result<Vec<u8>, String>,
    },
    DmsLoaded(Result<Vec<DmChannelSummary>, String>),
    MusicStateLoaded(Result<MusicChannelState, String>),
    MusicCommandDone(Result<(), String>),
    VoteSkipSaved(Result<u32, String>),
    ApiKeysLoaded(Result<Vec<SpaceApiKeySummary>, String>),
    ProfileSaved(Result<AuthUser, String>),
    GroupCreated(Result<GroupSummary, String>),
    ChannelCreated {
        space_id: String,
        result: Result<(), String>,
    },
    ApiKeyCreated(Result<(SpaceApiKeySummary, String), String>),
    ApiKeyRevoked {
        key_id: String,
        result: Result<(), String>,
    },
    ImageLoaded {
        key: String,
        bytes: Option<Vec<u8>>,
        circular: bool,
    },
    UpdateChecked(UpdateCheckState),
}

impl BalacopapoApp {
    pub fn new() -> (Self, Task<Message>) {
        let mut config = AppConfig::load();
        let raw_args: Vec<String> = std::env::args().collect();

        let mut initial_note: Option<String> = None;
        for arg in &raw_args {
            if let Some(target) = parse_deep_link(arg) {
                match target {
                    DeepLinkTarget::OidcCallback { token, instance } => {
                        if let Some(url) = instance.and_then(|u| normalize_instance_url(&u).ok()) {
                            config.instance_url = Some(url);
                        }
                        config.auth_token = Some(token);
                        let _ = config.save();
                    }
                    DeepLinkTarget::Invite { code, instance } => {
                        if let Some(url) = instance.and_then(|u| normalize_instance_url(&u).ok()) {
                            config.instance_url = Some(url);
                        }
                        initial_note = Some(format!("Convite detectado: {code}"));
                    }
                    DeepLinkTarget::InternalRoute { path } => {
                        initial_note = Some(format!("Rota solicitada: {path}"));
                    }
                }
            }
        }

        let mut auth_state = AuthState::new(config.instance_url.clone());
        auth_state.status_note = initial_note;

        let mut tasks = vec![Task::perform(
            updater::check_and_stage_update(),
            Message::UpdateChecked,
        )];

        if let (Some(url), Some(token)) = (config.instance_url.clone(), config.auth_token.clone()) {
            auth_state.busy = true;
            auth_state.status_note = Some("Restaurando sessão salva...".to_string());
            tasks.push(Task::perform(
                async move {
                    let client = ApiClient::new(url.clone(), Some(token))?;
                    let user = client.fetch_me().await?;
                    Ok((url, user))
                },
                Message::SessionRestored,
            ));
        }

        let app = Self {
            config,
            screen: Screen::Auth(auth_state),
            update_state: UpdateCheckState::Checking,
            audio_params: AudioParams::default(),
            active_loopback: None,
            ws_tx: None,
        };

        (app, Task::batch(tasks))
    }

    pub fn title(&self) -> String {
        match &self.screen {
            Screen::Auth(_) => "Balacopapo".to_string(),
            Screen::Shell(shell) => format!("Balacopapo — {}", shell.user.label()),
        }
    }

    pub fn theme(&self) -> Theme {
        aether_drift::theme_for(AppThemeId::from_code(&self.config.theme))
    }

    pub fn subscription(&self) -> Subscription<Message> {
        let updater_sub = updater::periodic_check_subscription().map(Message::UpdateChecked);
        match &self.screen {
            Screen::Auth(_) => updater_sub,
            Screen::Shell(shell) => match self.config.auth_token.clone() {
                Some(token) if !token.is_empty() => Subscription::batch([
                    ws::connect_subscription(shell.instance_url.clone(), token)
                        .map(Message::WsEvent),
                    updater_sub,
                ]),
                _ => updater_sub,
            },
        }
    }

    pub fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::Auth(msg) => self.handle_auth(msg),
            Message::Shell(msg) => self.handle_shell(msg),
            Message::WsEvent(ev) => self.handle_ws_event(ev),
            Message::InstanceProbed(result) => {
                if let Screen::Auth(state) = &mut self.screen {
                    state.busy = false;
                    match result {
                        Ok((url, info)) => {
                            state.instance_url_input = url.clone();
                            state.instance_info = Some(info);
                            state.error = None;
                            self.config.instance_url = Some(url);
                            let _ = self.config.save();
                        }
                        Err(err) => {
                            state.error = Some(err);
                        }
                    }
                }
                Task::none()
            }
            Message::LoginCompleted(result) => match result {
                Ok((url, resp)) => {
                    self.config.instance_url = Some(url.clone());
                    self.config.auth_token = Some(resp.token.clone());
                    let _ = self.config.save();
                    let mut shell_state = ShellState::new(url.clone(), resp.user);
                    shell_state.settings.theme = AppThemeId::from_code(&self.config.theme);
                    shell_state.settings.language = AppLanguage::from_code(&self.config.language);
                    shell_state.settings.low_interrupt_mode = self.config.low_interrupt_mode;
                    shell_state.settings.desktop_notifications = self.config.desktop_notifications;
                    shell_state.settings.autostart_enabled = autostart::is_enabled();
                    shell_state.dm.loading = true;
                    self.screen = Screen::Shell(Box::new(shell_state));
                    Task::batch([
                        Self::load_groups_task(url.clone(), resp.token.clone()),
                        Self::load_dms_task(url, resp.token),
                    ])
                }
                Err(err) => {
                    if let Screen::Auth(state) = &mut self.screen {
                        state.busy = false;
                        state.error = Some(err);
                    }
                    Task::none()
                }
            },
            Message::SessionRestored(result) => match result {
                Ok((url, user)) => {
                    let token = self.config.auth_token.clone().unwrap_or_default();
                    let mut shell_state = ShellState::new(url.clone(), user);
                    shell_state.settings.theme = AppThemeId::from_code(&self.config.theme);
                    shell_state.settings.language = AppLanguage::from_code(&self.config.language);
                    shell_state.settings.low_interrupt_mode = self.config.low_interrupt_mode;
                    shell_state.settings.desktop_notifications = self.config.desktop_notifications;
                    shell_state.settings.autostart_enabled = autostart::is_enabled();
                    shell_state.dm.loading = true;
                    self.screen = Screen::Shell(Box::new(shell_state));
                    Task::batch([
                        Self::load_groups_task(url.clone(), token.clone()),
                        Self::load_dms_task(url, token),
                    ])
                }
                Err(_) => {
                    self.config.auth_token = None;
                    let _ = self.config.save();
                    if let Screen::Auth(state) = &mut self.screen {
                        state.busy = false;
                        state.status_note =
                            Some("Sessão expirada. Faça login novamente.".to_string());
                    }
                    Task::none()
                }
            },
            Message::GroupsLoaded(result) => {
                let mut auto_fetch_msgs: Option<(String, String, String)> = None;
                let mut auto_fetch_detail: Option<(String, String, String)> = None;
                if let Screen::Shell(shell) = &mut self.screen {
                    shell.loading_groups = false;
                    match result {
                        Ok(groups) => {
                            shell.error = None;
                            if shell.selected_group_id.is_none() {
                                shell.selected_group_id = groups.first().map(|g| g.id.clone());
                            }
                            if let Some(sel_id) = shell.selected_group_id.clone() {
                                if let Some(sel_group) = groups.iter().find(|g| g.id == sel_id) {
                                    if sel_group.channels.is_empty() {
                                        auto_fetch_detail = Some((
                                            shell.instance_url.clone(),
                                            self.config.auth_token.clone().unwrap_or_default(),
                                            sel_id,
                                        ));
                                    } else if shell.selected_channel_id.is_none() {
                                        if let Some(first_ch) = sel_group
                                            .channels
                                            .iter()
                                            .find(|c| c.kind != "voice")
                                            .or_else(|| sel_group.channels.first())
                                        {
                                            shell.selected_channel_id = Some(first_ch.id.clone());
                                            if first_ch.kind != "voice" {
                                                shell.chat.loading_history = true;
                                                auto_fetch_msgs = Some((
                                                    shell.instance_url.clone(),
                                                    self.config.auth_token.clone().unwrap_or_default(),
                                                    first_ch.id.clone(),
                                                ));
                                            }
                                        }
                                    }
                                }
                            }
                            shell.groups = groups;
                        }
                        Err(err) => {
                            shell.error = Some(err);
                        }
                    }
                }
                let img_task = self.enqueue_images_for_shell();
                if let Some((url, token, space_id)) = auto_fetch_detail {
                    Task::batch([Self::load_group_detail_task(url, token, space_id), img_task])
                } else if let Some((url, token, channel_id)) = auto_fetch_msgs {
                    Task::batch([
                        Self::load_messages_task(url, token, channel_id, None, false),
                        img_task,
                    ])
                } else {
                    img_task
                }
            }
            Message::GroupDetailLoaded(result) => {
                let mut auto_fetch_msgs: Option<(String, String, String)> = None;
                if let Screen::Shell(shell) = &mut self.screen {
                    match result {
                        Ok(detail) => {
                            let detail_id = detail.id.clone();
                            let first_text = detail
                                .channels
                                .iter()
                                .find(|c| c.kind != "voice")
                                .or_else(|| detail.channels.first())
                                .cloned();
                            if let Some(existing) =
                                shell.groups.iter_mut().find(|g| g.id == detail_id)
                            {
                                *existing = detail;
                            } else {
                                shell.groups.push(detail);
                            }
                            if shell.selected_group_id.as_deref() == Some(detail_id.as_str())
                                && shell.selected_channel_id.is_none()
                            {
                                if let Some(first_ch) = first_text {
                                    shell.selected_channel_id = Some(first_ch.id.clone());
                                    if first_ch.kind != "voice" {
                                        shell.chat.loading_history = true;
                                        auto_fetch_msgs = Some((
                                            shell.instance_url.clone(),
                                            self.config.auth_token.clone().unwrap_or_default(),
                                            first_ch.id,
                                        ));
                                    }
                                }
                            }
                        }
                        Err(err) => {
                            shell.error = Some(err);
                        }
                    }
                }
                let img_task = self.enqueue_images_for_shell();
                if let Some((url, token, channel_id)) = auto_fetch_msgs {
                    Task::batch([
                        Self::load_messages_task(url, token, channel_id, None, false),
                        img_task,
                    ])
                } else {
                    img_task
                }
            }
            Message::MessagesLoaded {
                channel_id,
                prepend,
                result,
            } => {
                if let Screen::Shell(shell) = &mut self.screen {
                    shell.chat.loading_history = false;
                    match result {
                        Ok(list) => {
                            shell.chat.error = None;
                            if prepend {
                                shell.chat.prepend_history(&channel_id, list);
                            } else {
                                shell.chat.messages_by_channel.insert(channel_id, list);
                            }
                        }
                        Err(err) => {
                            shell.chat.error = Some(err);
                        }
                    }
                }
                self.enqueue_images_for_shell()
            }
            Message::ChatSent(result) => {
                if let Screen::Shell(shell) = &mut self.screen {
                    shell.chat.sending = false;
                    match result {
                        Ok(msg) => {
                            shell.chat.error = None;
                            shell.chat.draft.clear();
                            shell.chat.replying_to = None;
                            shell.chat.pending_attachments.clear();
                            shell.chat.upsert_message(msg);
                        }
                        Err(err) => {
                            shell.chat.error = Some(err);
                        }
                    }
                }
                Task::none()
            }
            Message::AttachmentUploaded(result) => {
                if let Screen::Shell(shell) = &mut self.screen {
                    shell.chat.uploading = false;
                    match result {
                        Ok(Some((att_id, name))) => {
                            shell.chat.error = None;
                            shell.chat.pending_attachments.push((att_id, name));
                        }
                        Ok(None) => {}
                        Err(err) => {
                            shell.chat.error = Some(err);
                        }
                    }
                }
                Task::none()
            }
            Message::ChatEdited(result) => {
                if let Screen::Shell(shell) = &mut self.screen {
                    match result {
                        Ok(msg) => {
                            shell.chat.error = None;
                            shell.chat.editing_message_id = None;
                            shell.chat.edit_draft.clear();
                            shell.chat.upsert_message(msg);
                        }
                        Err(err) => {
                            shell.chat.error = Some(err);
                        }
                    }
                }
                Task::none()
            }
            Message::ChatDeleted {
                channel_id,
                message_id,
                result,
            } => {
                if let Screen::Shell(shell) = &mut self.screen {
                    match result {
                        Ok(()) => {
                            shell.chat.remove_message(&channel_id, &message_id);
                        }
                        Err(err) => {
                            shell.chat.error = Some(err);
                        }
                    }
                }
                Task::none()
            }
            Message::StatusUpdated(result) => {
                if let Screen::Shell(shell) = &mut self.screen {
                    match result {
                        Ok(status) => {
                            shell.presence = status;
                            shell.error = None;
                        }
                        Err(err) => {
                            shell.error = Some(err);
                        }
                    }
                }
                Task::none()
            }
            Message::VoiceTokenReceived {
                channel_id,
                channel_name,
                result,
            } => {
                let mut fetch_music: Option<(String, String, String)> = None;
                let mut joined_ch: Option<String> = None;
                if let Screen::Shell(shell) = &mut self.screen {
                    shell.voice.connecting = false;
                    match result {
                        Ok(resp) => {
                            shell.voice.error = None;
                            shell.voice.connected_channel_id = Some(channel_id.clone());
                            shell.voice.connected_channel_name = Some(channel_name);
                            shell.voice.livekit_url = Some(resp.url);
                            // Garante presença imediata na lista local da call
                            let my_id = shell.user.id.clone();
                            for users in shell.voice_states.values_mut() {
                                users.retain(|u| u != &my_id);
                            }
                            shell
                                .voice_states
                                .entry(channel_id.clone())
                                .or_default()
                                .push(my_id);
                            joined_ch = Some(channel_id.clone());
                            fetch_music = Some((
                                shell.instance_url.clone(),
                                self.config.auth_token.clone().unwrap_or_default(),
                                channel_id,
                            ));
                        }
                        Err(err) => {
                            shell.voice.error = Some(err);
                        }
                    }
                }
                if let Some(ch_id) = joined_ch {
                    self.send_ws_json(serde_json::json!({
                        "type": "voice_join",
                        "channelId": ch_id,
                    }));
                    self.sync_voice_status_ws();
                }
                if let Some((url, token, ch_id)) = fetch_music {
                    Self::load_music_task(url, token, ch_id)
                } else {
                    Task::none()
                }
            }
            Message::SoundboardLoaded(result) => {
                if let Screen::Shell(shell) = &mut self.screen {
                    shell.soundboard.loading = false;
                    match result {
                        Ok(sounds) => {
                            shell.soundboard.error = None;
                            shell.soundboard.sounds = sounds;
                        }
                        Err(err) => {
                            shell.soundboard.error = Some(err);
                        }
                    }
                }
                Task::none()
            }
            Message::SoundboardClipFetched { name, result } => {
                if let Screen::Shell(shell) = &mut self.screen {
                    match result {
                        Ok(bytes) => match WavClip::from_wav_bytes(&bytes) {
                            Ok(clip) => {
                                let gain = quadratic_gain(shell.soundboard.volume_pct);
                                let out = shell.voice.selected_output.clone();
                                audio_engine::play_clip_once(clip.samples.clone(), gain, out);
                                shell.soundboard.load_clip_into_editor(clip, name);
                                shell.soundboard.error = None;
                            }
                            Err(err) => {
                                shell.soundboard.error = Some(format!(
                                    "Som '{name}' baixado, mas formato não-WAV ({err})."
                                ));
                            }
                        },
                        Err(err) => {
                            shell.soundboard.error = Some(err);
                        }
                    }
                }
                Task::none()
            }
            Message::DmsLoaded(result) => {
                if let Screen::Shell(shell) = &mut self.screen {
                    shell.dm.loading = false;
                    match result {
                        Ok(list) => {
                            shell.dm.error = None;
                            shell.dm.channels = list;
                        }
                        Err(err) => shell.dm.error = Some(err),
                    }
                }
                self.enqueue_images_for_shell()
            }
            Message::MusicStateLoaded(result) => {
                if let Screen::Shell(shell) = &mut self.screen {
                    shell.music.busy = false;
                    match result {
                        Ok(st) => {
                            shell.music.error = None;
                            shell.settings.vote_skip_input = st.vote_skip_percent.to_string();
                            shell.music.state = st;
                        }
                        Err(err) => shell.music.error = Some(err),
                    }
                }
                Task::none()
            }
            Message::MusicCommandDone(result) => {
                if let Screen::Shell(shell) = &mut self.screen {
                    shell.music.busy = false;
                    match result {
                        Ok(()) => {
                            shell.music.error = None;
                            if let Some(ch_id) = shell.voice.connected_channel_id.clone() {
                                let url = shell.instance_url.clone();
                                let token = self.config.auth_token.clone().unwrap_or_default();
                                return Self::load_music_task(url, token, ch_id);
                            }
                        }
                        Err(err) => shell.music.error = Some(err),
                    }
                }
                Task::none()
            }
            Message::VoteSkipSaved(result) => {
                if let Screen::Shell(shell) = &mut self.screen {
                    match result {
                        Ok(pct) => {
                            shell.settings.vote_skip_error = None;
                            shell.settings.vote_skip_saved_note =
                                Some(format!("Vote-Skip do grupo salvo em {pct}%."));
                            shell.music.state.vote_skip_percent = pct;
                        }
                        Err(err) => {
                            shell.settings.vote_skip_saved_note = None;
                            shell.settings.vote_skip_error = Some(err);
                        }
                    }
                }
                Task::none()
            }
            Message::ApiKeysLoaded(result) => {
                if let Screen::Shell(shell) = &mut self.screen {
                    shell.settings.loading_keys = false;
                    match result {
                        Ok(keys) => {
                            shell.settings.api_keys_error = None;
                            shell.settings.api_keys = keys;
                        }
                        Err(err) => {
                            shell.settings.api_keys_error = Some(err);
                        }
                    }
                }
                Task::none()
            }
            Message::ProfileSaved(result) => {
                if let Screen::Shell(shell) = &mut self.screen {
                    shell.settings.profile_saving = false;
                    match result {
                        Ok(user) => {
                            shell.settings.profile_display_name =
                                user.display_name.clone().unwrap_or_default();
                            shell.settings.profile_bio = user.bio.clone().unwrap_or_default();
                            shell.user = user;
                            shell.settings.profile_error = None;
                            shell.settings.profile_note =
                                Some("Perfil atualizado com sucesso.".to_string());
                        }
                        Err(err) => {
                            shell.settings.profile_note = None;
                            shell.settings.profile_error = Some(err);
                        }
                    }
                }
                Task::none()
            }
            Message::GroupCreated(result) => {
                let mut fetch_detail: Option<(String, String, String)> = None;
                if let Screen::Shell(shell) = &mut self.screen {
                    match result {
                        Ok(group) => {
                            let id = group.id.clone();
                            let name = group.name.clone();
                            shell.groups.push(group);
                            shell.selected_group_id = Some(id.clone());
                            shell.selected_channel_id = None;
                            shell.settings.new_group_name.clear();
                            shell.settings.group_create_note =
                                Some(format!("Grupo '{name}' criado!"));
                            fetch_detail = Some((
                                shell.instance_url.clone(),
                                self.config.auth_token.clone().unwrap_or_default(),
                                id,
                            ));
                        }
                        Err(err) => {
                            shell.settings.profile_error = Some(err);
                        }
                    }
                }
                if let Some((url, token, space_id)) = fetch_detail {
                    Self::load_group_detail_task(url, token, space_id)
                } else {
                    Task::none()
                }
            }
            Message::ChannelCreated { space_id, result } => {
                let mut reload: Option<(String, String, String)> = None;
                if let Screen::Shell(shell) = &mut self.screen {
                    match result {
                        Ok(()) => {
                            shell.settings.new_channel_name.clear();
                            shell.settings.channel_create_note =
                                Some("Canal criado com sucesso.".to_string());
                            reload = Some((
                                shell.instance_url.clone(),
                                self.config.auth_token.clone().unwrap_or_default(),
                                space_id,
                            ));
                        }
                        Err(err) => {
                            shell.settings.api_keys_error = Some(err);
                        }
                    }
                }
                if let Some((url, token, sid)) = reload {
                    Self::load_group_detail_task(url, token, sid)
                } else {
                    Task::none()
                }
            }
            Message::ApiKeyCreated(result) => {
                if let Screen::Shell(shell) = &mut self.screen {
                    match result {
                        Ok((summary, secret)) => {
                            shell.settings.api_keys_error = None;
                            shell.settings.new_api_key_name.clear();
                            shell.settings.created_api_key_secret = Some(secret);
                            shell.settings.api_keys.insert(0, summary);
                        }
                        Err(err) => {
                            shell.settings.api_keys_error = Some(err);
                        }
                    }
                }
                Task::none()
            }
            Message::ApiKeyRevoked { key_id, result } => {
                if let Screen::Shell(shell) = &mut self.screen {
                    match result {
                        Ok(()) => {
                            shell.settings.api_keys_error = None;
                            shell.settings.api_keys.retain(|k| k.id != key_id);
                        }
                        Err(err) => {
                            shell.settings.api_keys_error = Some(err);
                        }
                    }
                }
                Task::none()
            }
            Message::ImageLoaded {
                key,
                bytes,
                circular,
            } => {
                if let Screen::Shell(shell) = &mut self.screen {
                    if let Some(raw) = bytes {
                        let handle = if circular {
                            decode_circular_avatar(&raw, 128)
                                .unwrap_or_else(|| iced::widget::image::Handle::from_bytes(raw))
                        } else {
                            iced::widget::image::Handle::from_bytes(raw)
                        };
                        shell.image_cache.insert(key, handle);
                    }
                }
                Task::none()
            }
            Message::UpdateChecked(status) => {
                self.update_state = status;
                Task::none()
            }
        }
    }

    pub fn view(&self) -> Element<'_, Message> {
        match &self.screen {
            Screen::Auth(state) => auth::view(state, &self.update_state).map(Message::Auth),
            Screen::Shell(state) => shell::view(state, &self.update_state).map(Message::Shell),
        }
    }

    fn handle_ws_event(&mut self, event: WsEvent) -> Task<Message> {
        if let WsEvent::WsReadyToSend(tx) = event {
            self.ws_tx = Some(tx);
            return Task::none();
        }

        let Screen::Shell(shell) = &mut self.screen else {
            return Task::none();
        };

        match event {
            WsEvent::WsReadyToSend(_) => Task::none(),
            WsEvent::PingMeasured(rtt) => {
                if let Some(prev) = shell.voice.ping_ms {
                    shell.voice.jitter_ms = Some(rtt.abs_diff(prev));
                }
                shell.voice.ping_ms = Some(rtt);
                Task::none()
            }
            WsEvent::Connected => {
                shell.ws_connected = true;
                shell.ws_status_label = "Ao vivo · Zero WebView".to_string();
                shell.p2p.set_server_online(true);
                Task::none()
            }
            WsEvent::Disconnected(reason) => {
                shell.ws_connected = false;
                shell.p2p.set_server_online(false);
                shell.ws_status_label = if shell.p2p.survival_mode_active() {
                    "Sobrevivência P2P".to_string()
                } else {
                    reason
                };
                Task::none()
            }
            WsEvent::Ready {
                user,
                groups,
                dm_channels,
                unread_counts,
                voice_states,
                voice_user_states,
            } => {
                shell.presence = PresenceStatus::from_api_str(user.status.as_deref());
                shell.user = user;
                shell.unread_counts = unread_counts;
                shell.voice_states = voice_states;
                shell.voice_user_states = voice_user_states;
                shell.loading_groups = false;
                if !dm_channels.is_empty() {
                    shell.dm.channels = dm_channels;
                    shell.dm.loading = false;
                }
                let mut auto_fetch_msgs: Option<(String, String, String)> = None;
                if !groups.is_empty() {
                    if shell.selected_group_id.is_none() {
                        shell.selected_group_id = groups.first().map(|g| g.id.clone());
                    }
                    if shell.selected_channel_id.is_none() {
                        if let Some(first_ch) = groups
                            .iter()
                            .find(|g| shell.selected_group_id.as_deref() == Some(g.id.as_str()))
                            .and_then(|g| {
                                g.channels
                                    .iter()
                                    .find(|c| c.kind != "voice")
                                    .or_else(|| g.channels.first())
                            })
                        {
                            shell.selected_channel_id = Some(first_ch.id.clone());
                            if first_ch.kind != "voice" {
                                shell.chat.loading_history = true;
                                auto_fetch_msgs = Some((
                                    shell.instance_url.clone(),
                                    self.config.auth_token.clone().unwrap_or_default(),
                                    first_ch.id.clone(),
                                ));
                            }
                        }
                    }
                    shell.groups = groups;
                }
                let img_task = self.enqueue_images_for_shell();
                if let Some((url, token, channel_id)) = auto_fetch_msgs {
                    Task::batch([
                        Self::load_messages_task(url, token, channel_id, None, false),
                        img_task,
                    ])
                } else {
                    img_task
                }
            }
            WsEvent::MessageCreated(msg) => {
                let is_active =
                    shell.selected_channel_id.as_deref() == Some(msg.channel_id.as_str())
                        || shell.dm.selected_dm_id.as_deref() == Some(msg.channel_id.as_str());
                let from_other = msg.user_id.as_deref() != Some(shell.user.id.as_str());
                if !is_active {
                    *shell.unread_counts.entry(msg.channel_id.clone()).or_insert(0) += 1;
                }
                if from_other && shell.settings.desktop_notifications {
                    let mentioned = msg
                        .body_text()
                        .contains(&format!("@{}", shell.user.username))
                        || msg.body_text().contains("@everyone");
                    if !is_active || mentioned {
                        let title = format!("Balacopapo — {}", msg.author_label());
                        let body = if msg.body_text().is_empty() {
                            "Enviou um anexo".to_string()
                        } else {
                            msg.body_text().chars().take(160).collect()
                        };
                        notifications::send_desktop_notification(title, body);
                    }
                }
                shell.chat.typing_users.remove(&msg.channel_id);
                shell.chat.upsert_message(msg);
                self.enqueue_images_for_shell()
            }
            WsEvent::MessageUpdated(msg) => {
                shell.chat.upsert_message(msg);
                Task::none()
            }
            WsEvent::MessageDeleted {
                channel_id,
                message_id,
            } => {
                shell.chat.remove_message(&channel_id, &message_id);
                Task::none()
            }
            WsEvent::PresenceUpdate { user_id, status } => {
                if user_id == shell.user.id {
                    shell.presence = PresenceStatus::from_api_str(Some(&status));
                }
                for group in &mut shell.groups {
                    for m in &mut group.members {
                        if m.user_id == user_id {
                            m.user.status = Some(status.clone());
                        }
                    }
                }
                Task::none()
            }
            WsEvent::VoiceStateUpdate {
                channel_id,
                user_id,
                action,
            } => {
                for users in shell.voice_states.values_mut() {
                    users.retain(|u| u != &user_id);
                }
                if action == "join" {
                    let entry = shell.voice_states.entry(channel_id).or_default();
                    if !entry.contains(&user_id) {
                        entry.push(user_id);
                    }
                }
                Task::none()
            }
            WsEvent::VoiceStatusUpdate { user_id, state } => {
                shell.voice_user_states.insert(user_id, state);
                Task::none()
            }
            WsEvent::SpaceVoiceState {
                voice_states,
                voice_user_states,
            } => {
                for (ch_id, users) in voice_states {
                    shell.voice_states.insert(ch_id, users);
                }
                for (uid, st) in voice_user_states {
                    shell.voice_user_states.insert(uid, st);
                }
                Task::none()
            }
            WsEvent::MusicStateUpdated(st) => {
                let matches_connected = shell.voice.connected_channel_id.as_deref()
                    == Some(st.channel_id.as_str())
                    || shell.voice.connected_channel_id.is_none();
                if matches_connected {
                    shell.settings.vote_skip_input = st.vote_skip_percent.to_string();
                    shell.music.state = st;
                    shell.music.error = None;
                }
                Task::none()
            }
            WsEvent::Typing {
                channel_id,
                user_id,
            } => {
                if user_id != shell.user.id {
                    let name = shell
                        .groups
                        .iter()
                        .flat_map(|g| g.members.iter())
                        .find(|m| m.user_id == user_id)
                        .map(|m| m.display_name().to_string())
                        .unwrap_or_else(|| "Alguém".to_string());
                    shell.chat.typing_users.insert(channel_id, name);
                }
                Task::none()
            }
        }
    }

    fn handle_auth(&mut self, msg: AuthMessage) -> Task<Message> {
        let Screen::Auth(state) = &mut self.screen else {
            return Task::none();
        };

        match msg {
            AuthMessage::InstanceUrlChanged(v) => {
                state.instance_url_input = v;
                state.error = None;
                Task::none()
            }
            AuthMessage::UsernameChanged(v) => {
                state.username_input = v;
                state.error = None;
                Task::none()
            }
            AuthMessage::PasswordChanged(v) => {
                state.password_input = v;
                state.error = None;
                Task::none()
            }
            AuthMessage::ProbeInstance => match normalize_instance_url(&state.instance_url_input) {
                Ok(url) => {
                    state.busy = true;
                    state.error = None;
                    Task::perform(
                        async move {
                            let client = ApiClient::new(url.clone(), None)?;
                            let info = client.fetch_instance_info().await?;
                            Ok((url, info))
                        },
                        Message::InstanceProbed,
                    )
                }
                Err(err) => {
                    state.error = Some(err);
                    Task::none()
                }
            },
            AuthMessage::SubmitLogin => {
                let url = match normalize_instance_url(&state.instance_url_input) {
                    Ok(u) => u,
                    Err(err) => {
                        state.error = Some(err);
                        return Task::none();
                    }
                };
                if state.username_input.trim().is_empty() || state.password_input.is_empty() {
                    state.error = Some("Preencha usuário e senha.".to_string());
                    return Task::none();
                }
                let username = state.username_input.clone();
                let password = state.password_input.clone();
                state.busy = true;
                state.error = None;

                Task::perform(
                    async move {
                        let client = ApiClient::new(url.clone(), None)?;
                        let resp = client.login(&username, &password).await?;
                        Ok((url, resp))
                    },
                    Message::LoginCompleted,
                )
            }
            AuthMessage::StartOidc => match normalize_instance_url(&state.instance_url_input) {
                Ok(url) => {
                    state.busy = true;
                    state.error = None;
                    state.status_note = Some(
                        "Abrindo navegador para login OIDC... conclua o login no navegador para entrar automaticamente."
                            .to_string(),
                    );
                    self.config.instance_url = Some(url.clone());
                    let _ = self.config.save();
                    Task::perform(
                        async move {
                            let client = ApiClient::new(url.clone(), None)?;
                            let resp = client.login_with_oidc_browser().await?;
                            Ok((url, resp))
                        },
                        Message::LoginCompleted,
                    )
                }
                Err(err) => {
                    state.error = Some(err);
                    Task::none()
                }
            },
            AuthMessage::CheckUpdates => {
                self.update_state = UpdateCheckState::Checking;
                Task::perform(updater::check_and_stage_update(), Message::UpdateChecked)
            }
            AuthMessage::ApplyStagedUpdate(path) => {
                if let Err(err) = updater::install_and_restart(&path) {
                    self.update_state = UpdateCheckState::Failed(err);
                }
                Task::none()
            }
            AuthMessage::OpenReleasePage(url) => {
                let _ = open::that(url);
                Task::none()
            }
        }
    }

    fn handle_shell(&mut self, msg: ShellMessage) -> Task<Message> {
        let Screen::Shell(shell) = &mut self.screen else {
            return Task::none();
        };

        match msg {
            ShellMessage::SelectGroup(id) => {
                shell.selected_group_id = Some(id.clone());
                shell.selected_channel_id = None;
                shell.active_panel = ActivePanel::Channel;
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                let existing = shell.groups.iter().find(|g| g.id == id);
                let has_channels = existing.is_some_and(|g| !g.channels.is_empty());
                if !has_channels {
                    return Self::load_group_detail_task(url, token, id);
                }
                if let Some(first_ch) = existing.and_then(|g| {
                    g.channels
                        .iter()
                        .find(|c| c.kind != "voice")
                        .or_else(|| g.channels.first())
                        .cloned()
                }) {
                    shell.selected_channel_id = Some(first_ch.id.clone());
                    if first_ch.kind != "voice" {
                        shell.chat.loading_history = true;
                        return Self::load_messages_task(url, token, first_ch.id, None, false);
                    }
                }
                Task::none()
            }
            ShellMessage::SelectChannel(channel_id) => {
                let now = std::time::Instant::now();
                let is_double_click = shell
                    .last_channel_click
                    .as_ref()
                    .is_some_and(|(prev_id, at)| {
                        prev_id == &channel_id && now.duration_since(*at).as_millis() < 450
                    });
                shell.last_channel_click = Some((channel_id.clone(), now));

                shell.selected_channel_id = Some(channel_id.clone());
                shell.active_panel = ActivePanel::Channel;
                shell.unread_counts.remove(&channel_id);
                shell.chat.error = None;

                let voice_ch_name = shell
                    .groups
                    .iter()
                    .flat_map(|g| g.channels.iter())
                    .find(|c| c.id == channel_id && c.kind == "voice")
                    .map(|c| c.name.clone());

                if let Some(ch_name) = voice_ch_name {
                    let already_here =
                        shell.voice.connected_channel_id.as_deref() == Some(channel_id.as_str());
                    if is_double_click && !already_here && !shell.voice.connecting {
                        return self.handle_voice_action(VoiceAction::JoinChannel {
                            channel_id,
                            name: ch_name,
                        });
                    }
                    return Task::none();
                }

                shell.chat.loading_history = true;
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                Self::load_messages_task(url, token, channel_id, None, false)
            }
            ShellMessage::TogglePanel(panel) => {
                if shell.active_panel == panel {
                    shell.active_panel = ActivePanel::Channel;
                    return Task::none();
                }
                shell.active_panel = panel;
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                match panel {
                    ActivePanel::Soundboard if shell.soundboard.sounds.is_empty() => {
                        shell.soundboard.loading = true;
                        let space_id = shell.selected_group_id.clone();
                        Self::load_soundboard_task(url, token, space_id)
                    }
                    ActivePanel::Dms if shell.dm.channels.is_empty() => {
                        shell.dm.loading = true;
                        Self::load_dms_task(url, token)
                    }
                    ActivePanel::Settings => {
                        if let Some(space_id) = shell.selected_group_id.clone() {
                            shell.settings.loading_keys = true;
                            Self::load_api_keys_task(url, token, space_id)
                        } else {
                            Task::none()
                        }
                    }
                    _ => Task::none(),
                }
            }
            ShellMessage::ToggleMemberList => {
                shell.show_member_list = !shell.show_member_list;
                Task::none()
            }
            ShellMessage::OpenProfile(user_id) => {
                if shell.selected_profile_user_id.as_deref() == Some(user_id.as_str()) {
                    shell.selected_profile_user_id = None;
                    return Task::none();
                }
                shell.selected_profile_user_id = Some(user_id);
                shell.show_member_list = true;
                self.enqueue_images_for_shell()
            }
            ShellMessage::CloseProfile => {
                shell.selected_profile_user_id = None;
                Task::none()
            }
            ShellMessage::SetStatus(status) => {
                shell.status_picker_open = false;
                shell.presence = status;
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                Task::perform(
                    async move {
                        let client = ApiClient::new(url, Some(token))?;
                        client.update_status(status).await?;
                        Ok(status)
                    },
                    Message::StatusUpdated,
                )
            }
            ShellMessage::RefreshGroups => {
                shell.loading_groups = true;
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                Self::load_groups_task(url, token)
            }
            ShellMessage::ToggleStatusPicker => {
                shell.status_picker_open = !shell.status_picker_open;
                Task::none()
            }
            ShellMessage::Chat(action) => self.handle_chat_action(action),
            ShellMessage::Dm(action) => self.handle_dm_action(action),
            ShellMessage::Voice(action) => self.handle_voice_action(action),
            ShellMessage::Music(action) => self.handle_music_action(action),
            ShellMessage::Soundboard(action) => self.handle_soundboard_action(action),
            ShellMessage::Stream(action) => self.handle_stream_action(action),
            ShellMessage::P2P(action) => self.handle_p2p_action(action),
            ShellMessage::Overlay(action) => self.handle_overlay_action(action),
            ShellMessage::Settings(action) => self.handle_settings_action(action),
            ShellMessage::ApplyStagedUpdate(path) => {
                if let Err(err) = updater::install_and_restart(&path) {
                    self.update_state = UpdateCheckState::Failed(err);
                }
                Task::none()
            }
            ShellMessage::OpenReleasePage(url) => {
                let _ = open::that(url);
                Task::none()
            }
            ShellMessage::Logout => {
                self.active_loopback = None;
                self.config.auth_token = None;
                let _ = self.config.save();
                self.screen = Screen::Auth(AuthState::new(self.config.instance_url.clone()));
                Task::none()
            }
        }
    }

    fn handle_chat_action(&mut self, action: ChatMessageAction) -> Task<Message> {
        let Screen::Shell(shell) = &mut self.screen else {
            return Task::none();
        };

        match action {
            ChatMessageAction::DraftChanged(v) => {
                shell.chat.draft = v;
                Task::none()
            }
            ChatMessageAction::SearchChanged(v) => {
                shell.chat.search_query = v;
                Task::none()
            }
            ChatMessageAction::ToggleSearch => {
                shell.chat.show_search = !shell.chat.show_search;
                if !shell.chat.show_search {
                    shell.chat.search_query.clear();
                }
                Task::none()
            }
            ChatMessageAction::StartReply { message_id, author } => {
                shell.chat.replying_to = Some((message_id, author));
                Task::none()
            }
            ChatMessageAction::CancelReply => {
                shell.chat.replying_to = None;
                Task::none()
            }
            ChatMessageAction::StartEdit {
                message_id,
                current_text,
            } => {
                shell.chat.editing_message_id = Some(message_id);
                shell.chat.edit_draft = current_text;
                Task::none()
            }
            ChatMessageAction::EditDraftChanged(v) => {
                shell.chat.edit_draft = v;
                Task::none()
            }
            ChatMessageAction::CancelEdit => {
                shell.chat.editing_message_id = None;
                shell.chat.edit_draft.clear();
                Task::none()
            }
            ChatMessageAction::CommitEdit => {
                let Some(message_id) = shell.chat.editing_message_id.clone() else {
                    return Task::none();
                };
                let content = shell.chat.edit_draft.trim().to_string();
                if content.is_empty() {
                    return Task::none();
                }
                let is_dm = shell.active_panel == ActivePanel::Dms;
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                Task::perform(
                    async move {
                        let client = ApiClient::new(url, Some(token))?;
                        client.edit_message(&message_id, &content, is_dm).await
                    },
                    Message::ChatEdited,
                )
            }
            ChatMessageAction::OpenUrl(url) => {
                let _ = open::that(url);
                Task::none()
            }
            ChatMessageAction::PickAttachment => {
                if shell.chat.uploading {
                    return Task::none();
                }
                shell.chat.uploading = true;
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                Task::perform(
                    async move {
                        let Some(file) = rfd::AsyncFileDialog::new()
                            .set_title("Selecionar arquivo ou imagem para enviar")
                            .pick_file()
                            .await
                        else {
                            return Ok(None);
                        };
                        let name = file.file_name();
                        let bytes = file.read().await;
                        let mime = guess_mime_from_filename(&name);
                        let client = ApiClient::new(url, Some(token))?;
                        let att_id = client.upload_file_tus(&name, mime, bytes).await?;
                        Ok(Some((att_id, name)))
                    },
                    Message::AttachmentUploaded,
                )
            }
            ChatMessageAction::RemovePendingAttachment(idx) => {
                if idx < shell.chat.pending_attachments.len() {
                    shell.chat.pending_attachments.remove(idx);
                }
                Task::none()
            }
            ChatMessageAction::Send => {
                let is_dm = shell.active_panel == ActivePanel::Dms;
                let target_id = if is_dm {
                    shell.dm.selected_dm_id.clone()
                } else {
                    shell.selected_channel_id.clone()
                };
                let Some(channel_id) = target_id else {
                    return Task::none();
                };
                let content = shell.chat.draft.trim().to_string();
                let attachment_ids: Vec<String> = shell
                    .chat
                    .pending_attachments
                    .iter()
                    .map(|(id, _)| id.clone())
                    .collect();
                if (content.is_empty() && attachment_ids.is_empty()) || shell.chat.sending {
                    return Task::none();
                }
                let reply_to = shell.chat.replying_to.as_ref().map(|(id, _)| id.clone());
                shell.chat.sending = true;
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                Task::perform(
                    async move {
                        let client = ApiClient::new(url, Some(token))?;
                        if is_dm {
                            client
                                .send_dm_message(
                                    &channel_id,
                                    &content,
                                    reply_to.as_deref(),
                                    &attachment_ids,
                                )
                                .await
                        } else {
                            client
                                .send_message(
                                    &channel_id,
                                    &content,
                                    reply_to.as_deref(),
                                    &attachment_ids,
                                )
                                .await
                        }
                    },
                    Message::ChatSent,
                )
            }
            ChatMessageAction::LoadOlder => {
                let is_dm = shell.active_panel == ActivePanel::Dms;
                let target_id = if is_dm {
                    shell.dm.selected_dm_id.clone()
                } else {
                    shell.selected_channel_id.clone()
                };
                let Some(channel_id) = target_id else {
                    return Task::none();
                };
                let before = shell.chat.oldest_message_id(&channel_id);
                shell.chat.loading_history = true;
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                if is_dm {
                    Self::load_dm_messages_task(url, token, channel_id, before, true)
                } else {
                    Self::load_messages_task(url, token, channel_id, before, true)
                }
            }
            ChatMessageAction::DeleteMessage(message_id) => {
                let is_dm = shell.active_panel == ActivePanel::Dms;
                let target_id = if is_dm {
                    shell.dm.selected_dm_id.clone()
                } else {
                    shell.selected_channel_id.clone()
                };
                let Some(channel_id) = target_id else {
                    return Task::none();
                };
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                let msg_id_clone = message_id.clone();
                Task::perform(
                    async move {
                        let result = match ApiClient::new(url, Some(token)) {
                            Ok(client) => client.delete_message(&msg_id_clone, is_dm).await,
                            Err(err) => Err(err),
                        };
                        Message::ChatDeleted {
                            channel_id,
                            message_id: msg_id_clone,
                            result,
                        }
                    },
                    std::convert::identity,
                )
            }
        }
    }

    fn handle_voice_action(&mut self, action: VoiceAction) -> Task<Message> {
        let Screen::Shell(shell) = &mut self.screen else {
            return Task::none();
        };

        match action {
            VoiceAction::JoinChannel { channel_id, name } => {
                shell.voice.connecting = true;
                shell.voice.error = None;
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                Task::perform(
                    async move {
                        let result = match ApiClient::new(url, Some(token)) {
                            Ok(client) => client.request_livekit_token(&channel_id).await,
                            Err(err) => Err(err),
                        };
                        Message::VoiceTokenReceived {
                            channel_id,
                            channel_name: name,
                            result,
                        }
                    },
                    std::convert::identity,
                )
            }
            VoiceAction::LeaveChannel => {
                self.active_loopback = None;
                let my_id = shell.user.id.clone();
                for users in shell.voice_states.values_mut() {
                    users.retain(|u| u != &my_id);
                }
                shell.voice.connected_channel_id = None;
                shell.voice.connected_channel_name = None;
                shell.voice.livekit_url = None;
                shell.voice.camera_on = false;
                shell.voice.show_connection_info = false;
                shell.voice.loopback_active = false;
                shell.voice.loopback_sample_rate = None;
                self.send_ws_json(serde_json::json!({ "type": "voice_leave" }));
                Task::none()
            }
            VoiceAction::ToggleMute => {
                shell.voice.muted = !shell.voice.muted;
                self.audio_params
                    .muted
                    .store(shell.voice.muted, Ordering::Relaxed);
                self.sync_voice_status_ws();
                Task::none()
            }
            VoiceAction::ToggleDeafen => {
                shell.voice.deafened = !shell.voice.deafened;
                self.audio_params
                    .deafened
                    .store(shell.voice.deafened, Ordering::Relaxed);
                self.sync_voice_status_ws();
                Task::none()
            }
            VoiceAction::ToggleCamera => {
                shell.voice.camera_on = !shell.voice.camera_on;
                self.sync_voice_status_ws();
                Task::none()
            }
            VoiceAction::ToggleRnnoise => {
                shell.voice.rnnoise_enabled = !shell.voice.rnnoise_enabled;
                self.audio_params
                    .rnnoise_enabled
                    .store(shell.voice.rnnoise_enabled, Ordering::Relaxed);
                Task::none()
            }
            VoiceAction::ToggleLoopback => {
                if self.active_loopback.is_some() {
                    self.active_loopback = None;
                    shell.voice.loopback_active = false;
                    shell.voice.loopback_sample_rate = None;
                } else {
                    match audio_engine::start_mic_loopback(
                        shell.voice.selected_input.as_deref(),
                        shell.voice.selected_output.as_deref(),
                        self.audio_params.clone(),
                    ) {
                        Ok(active) => {
                            shell.voice.loopback_sample_rate = Some(active.sample_rate);
                            shell.voice.loopback_active = true;
                            shell.voice.error = None;
                            self.active_loopback = Some(active);
                        }
                        Err(err) => {
                            shell.voice.error = Some(err);
                        }
                    }
                }
                Task::none()
            }
            VoiceAction::ToggleConnectionInfo => {
                shell.voice.show_connection_info = !shell.voice.show_connection_info;
                Task::none()
            }
            VoiceAction::ToggleAudioSettings => {
                shell.voice.show_audio_settings = !shell.voice.show_audio_settings;
                Task::none()
            }
            VoiceAction::OpenStreamPanel => {
                shell.active_panel = ActivePanel::Stream;
                Task::none()
            }
            VoiceAction::OpenSoundboardPanel => {
                shell.active_panel = ActivePanel::Soundboard;
                if shell.soundboard.sounds.is_empty() {
                    shell.soundboard.loading = true;
                    let url = shell.instance_url.clone();
                    let token = self.config.auth_token.clone().unwrap_or_default();
                    let space_id = shell.selected_group_id.clone();
                    return Self::load_soundboard_task(url, token, space_id);
                }
                Task::none()
            }
            VoiceAction::OpenMusicPanel => {
                shell.active_panel = ActivePanel::Music;
                if let Some(ch_id) = shell.voice.connected_channel_id.clone() {
                    let url = shell.instance_url.clone();
                    let token = self.config.auth_token.clone().unwrap_or_default();
                    return Self::load_music_task(url, token, ch_id);
                }
                Task::none()
            }
            VoiceAction::UserVolumeChanged {
                user_id,
                volume_pct,
            } => {
                shell.voice.user_volumes.insert(user_id, volume_pct);
                Task::none()
            }
            VoiceAction::RefreshDevices => {
                shell.voice.input_devices = audio_engine::list_input_devices();
                shell.voice.output_devices = audio_engine::list_output_devices();
                Task::none()
            }
            VoiceAction::SelectInput(dev) => {
                shell.voice.selected_input = Some(dev);
                Task::none()
            }
            VoiceAction::SelectOutput(dev) => {
                shell.voice.selected_output = Some(dev);
                Task::none()
            }
            VoiceAction::MicGainChanged(pct) => {
                shell.voice.mic_gain_pct = pct;
                self.audio_params.set_mic_gain(pct / 100.0);
                Task::none()
            }
            VoiceAction::VadThresholdChanged(db) => {
                shell.voice.vad_threshold_db = db;
                self.audio_params.set_vad_threshold_db(db);
                Task::none()
            }
            VoiceAction::JitterBufferChanged(ms) => {
                shell.voice.jitter_buffer_ms = ms;
                Task::none()
            }
            VoiceAction::ToggleTroubleshooting => {
                shell.voice.show_troubleshooting = !shell.voice.show_troubleshooting;
                Task::none()
            }
            VoiceAction::ToggleOpusMode => {
                shell.voice.opus_music_mode = !shell.voice.opus_music_mode;
                Task::none()
            }
            VoiceAction::ToggleOpusStereo => {
                shell.voice.opus_stereo = !shell.voice.opus_stereo;
                Task::none()
            }
            VoiceAction::OpusBitrateChanged(kbps) => {
                shell.voice.opus_bitrate_kbps = kbps;
                Task::none()
            }
        }
    }

    fn handle_soundboard_action(&mut self, action: SoundboardAction) -> Task<Message> {
        let Screen::Shell(shell) = &mut self.screen else {
            return Task::none();
        };

        match action {
            SoundboardAction::Refresh => {
                shell.soundboard.loading = true;
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                let space_id = shell.selected_group_id.clone();
                Self::load_soundboard_task(url, token, space_id)
            }
            SoundboardAction::SearchChanged(v) => {
                shell.soundboard.search = v;
                Task::none()
            }
            SoundboardAction::VolumeChanged(v) => {
                shell.soundboard.volume_pct = v;
                Task::none()
            }
            SoundboardAction::PreviewServerSound { name, file_url } => {
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                Task::perform(
                    async move {
                        let result = match ApiClient::new(url, Some(token)) {
                            Ok(client) => client.fetch_audio_bytes(&file_url).await,
                            Err(err) => Err(err),
                        };
                        Message::SoundboardClipFetched { name, result }
                    },
                    std::convert::identity,
                )
            }
            SoundboardAction::TrimStartChanged(v) => {
                let max_start = (shell.soundboard.trim_end - 0.05).max(0.0);
                shell.soundboard.trim_start = v.clamp(0.0, max_start);
                Task::none()
            }
            SoundboardAction::TrimEndChanged(v) => {
                let min_end = (shell.soundboard.trim_start + 0.05).min(1.0);
                shell.soundboard.trim_end = v.clamp(min_end, 1.0);
                Task::none()
            }
            SoundboardAction::NormalizeActiveRms => {
                shell.soundboard.normalize_editor_clip();
                Task::none()
            }
            SoundboardAction::PreviewEditorClip => {
                let trimmed = shell
                    .soundboard
                    .editor_clip
                    .trimmed(shell.soundboard.trim_start, shell.soundboard.trim_end);
                let gain = quadratic_gain(shell.soundboard.volume_pct);
                let out = shell.voice.selected_output.clone();
                audio_engine::play_clip_once(trimmed.samples, gain, out);
                shell.soundboard.status_note = Some("Reproduzindo prévia recortada...".to_string());
                Task::none()
            }
            SoundboardAction::LoadDemoClip => {
                shell
                    .soundboard
                    .load_clip_into_editor(WavClip::demo_chime(), "Clipe Demo".to_string());
                Task::none()
            }
        }
    }

    fn handle_stream_action(&mut self, action: StreamAction) -> Task<Message> {
        let Screen::Shell(shell) = &mut self.screen else {
            return Task::none();
        };

        match action {
            StreamAction::ToggleSharing => {
                shell.stream.sharing_active = !shell.stream.sharing_active;
                self.sync_voice_status_ws();
                Task::none()
            }
            StreamAction::ToggleFullscreenFocus => {
                shell.stream.fullscreen_focus = !shell.stream.fullscreen_focus;
                Task::none()
            }
            StreamAction::ToggleHideNonVideo => {
                shell.stream.hide_non_video = !shell.stream.hide_non_video;
                Task::none()
            }
            StreamAction::TogglePointerMode => {
                shell.stream.pointer_mode = !shell.stream.pointer_mode;
                Task::none()
            }
            StreamAction::SetAudioScope(scope) => {
                shell.stream.audio_scope = scope;
                Task::none()
            }
            StreamAction::SetPreset(preset) => {
                shell.stream.preset = preset;
                Task::none()
            }
            StreamAction::AvSyncBufferChanged(ms) => {
                shell.stream.av_sync_buffer_ms = ms;
                Task::none()
            }
            StreamAction::ZoomAt {
                cursor_x,
                cursor_y,
                width,
                height,
                factor,
            } => {
                shell
                    .stream
                    .viewport
                    .zoom_at(cursor_x, cursor_y, width, height, factor);
                Task::none()
            }
            StreamAction::PanBy {
                dx,
                dy,
                width,
                height,
            } => {
                shell.stream.viewport.pan_by(dx, dy, width, height);
                Task::none()
            }
            StreamAction::ResetZoom => {
                shell.stream.viewport.reset();
                Task::none()
            }
            StreamAction::PointerPingAt { nx, ny } => {
                shell.stream.pointers.push(ActivePointerPing {
                    sender: shell.user.label().to_string(),
                    x: nx,
                    y: ny,
                });
                if shell.stream.pointers.len() > 8 {
                    shell.stream.pointers.remove(0);
                }
                Task::none()
            }
            StreamAction::ClearPointers => {
                shell.stream.pointers.clear();
                Task::none()
            }
            StreamAction::SimulateRemoteRequest => {
                shell
                    .stream
                    .remote_control
                    .request_from("Participante Remoto".to_string());
                Task::none()
            }
            StreamAction::ApproveRemoteControl { allow_keyboard } => {
                shell.stream.remote_control.approve(true, allow_keyboard);
                Task::none()
            }
            StreamAction::PanicRevokeRemote => {
                shell.stream.remote_control.panic_revoke();
                Task::none()
            }
        }
    }

    fn handle_p2p_action(&mut self, action: P2PAction) -> Task<Message> {
        let Screen::Shell(shell) = &mut self.screen else {
            return Task::none();
        };

        match action {
            P2PAction::ToggleP2P => {
                shell.p2p.p2p_enabled = !shell.p2p.p2p_enabled;
                shell.p2p.reevaluate_all();
                Task::none()
            }
            P2PAction::SimulateServerOutage => {
                let next = !shell.p2p.server_online;
                shell.p2p.set_server_online(next);
                Task::none()
            }
            P2PAction::AcceptFileOffer(id) => {
                if let Some(offer) = shell.p2p.file_offers.iter_mut().find(|o| o.id == id) {
                    offer.status = FileTransferStatus::Accepted;
                }
                Task::none()
            }
            P2PAction::RejectFileOffer(id) => {
                if let Some(offer) = shell.p2p.file_offers.iter_mut().find(|o| o.id == id) {
                    offer.status = FileTransferStatus::Rejected;
                }
                Task::none()
            }
        }
    }

    fn handle_overlay_action(&mut self, action: OverlayAction) -> Task<Message> {
        let Screen::Shell(shell) = &mut self.screen else {
            return Task::none();
        };

        match action {
            OverlayAction::ToggleOverlay => {
                shell.overlay.overlay_enabled = !shell.overlay.overlay_enabled;
                Task::none()
            }
            OverlayAction::SetCorner(c) => {
                shell.overlay.corner = c;
                Task::none()
            }
            OverlayAction::OpacityChanged(v) => {
                shell.overlay.opacity_pct = v;
                Task::none()
            }
            OverlayAction::ScaleChanged(v) => {
                shell.overlay.scale_pct = v;
                Task::none()
            }
            OverlayAction::ToggleCompactSpeakers => {
                shell.overlay.compact_speakers_only = !shell.overlay.compact_speakers_only;
                Task::none()
            }
            OverlayAction::ToggleJoinToasts => {
                shell.overlay.show_join_leave_toasts = !shell.overlay.show_join_leave_toasts;
                Task::none()
            }
            OverlayAction::ToggleStreamPointers => {
                shell.overlay.show_stream_pointers = !shell.overlay.show_stream_pointers;
                Task::none()
            }
            OverlayAction::ToggleKeybind(idx) => {
                if let Some(kb) = shell.overlay.keybinds.get_mut(idx) {
                    kb.enabled = !kb.enabled;
                }
                Task::none()
            }
            OverlayAction::ToggleShowActivity => {
                shell.overlay.show_activity_publicly = !shell.overlay.show_activity_publicly;
                Task::none()
            }
            OverlayAction::ManualGameChanged(v) => {
                shell.overlay.manual_game_override = v;
                Task::none()
            }
            OverlayAction::IgnoredAppsChanged(v) => {
                shell.overlay.ignored_apps_csv = v;
                Task::none()
            }
            OverlayAction::ScanGamesNow => {
                shell.overlay.run_game_scan();
                Task::none()
            }
        }
    }

    fn handle_dm_action(&mut self, action: DmAction) -> Task<Message> {
        let Screen::Shell(shell) = &mut self.screen else {
            return Task::none();
        };

        match action {
            DmAction::Refresh => {
                shell.dm.loading = true;
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                Self::load_dms_task(url, token)
            }
            DmAction::SearchChanged(v) => {
                shell.dm.search = v;
                Task::none()
            }
            DmAction::SelectDm(id) => {
                shell.dm.selected_dm_id = Some(id.clone());
                shell.active_panel = ActivePanel::Dms;
                shell.chat.loading_history = true;
                shell.chat.error = None;
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                Self::load_dm_messages_task(url, token, id, None, false)
            }
        }
    }

    fn handle_music_action(&mut self, action: MusicAction) -> Task<Message> {
        let Screen::Shell(shell) = &mut self.screen else {
            return Task::none();
        };
        if matches!(action, MusicAction::OpenFullPanel) {
            shell.active_panel = ActivePanel::Music;
            if let Some(ch_id) = shell.voice.connected_channel_id.clone() {
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                return Self::load_music_task(url, token, ch_id);
            }
            return Task::none();
        }
        if let MusicAction::UrlInputChanged(v) = action {
            shell.music.track_url_input = v;
            return Task::none();
        }
        let Some(channel_id) = shell.voice.connected_channel_id.clone() else {
            return Task::none();
        };
        let url = shell.instance_url.clone();
        let token = self.config.auth_token.clone().unwrap_or_default();

        match action {
            MusicAction::UrlInputChanged(_) | MusicAction::OpenFullPanel => Task::none(),
            MusicAction::AddToQueue => {
                let track_url = shell.music.track_url_input.trim().to_string();
                if track_url.is_empty() {
                    return Task::none();
                }
                shell.music.busy = true;
                shell.music.track_url_input.clear();
                Task::perform(
                    async move {
                        let client = ApiClient::new(url, Some(token))?;
                        client.add_music_track(&channel_id, &track_url).await
                    },
                    Message::MusicCommandDone,
                )
            }
            MusicAction::TogglePlayPause => {
                shell.music.busy = true;
                let cmd = if shell.music.state.status == "playing" {
                    "pause"
                } else {
                    "resume"
                };
                Task::perform(
                    async move {
                        let client = ApiClient::new(url, Some(token))?;
                        client.control_music(&channel_id, cmd, None).await
                    },
                    Message::MusicCommandDone,
                )
            }
            MusicAction::VoteSkip => {
                shell.music.busy = true;
                Task::perform(
                    async move {
                        let client = ApiClient::new(url, Some(token))?;
                        client.vote_skip_music(&channel_id).await
                    },
                    Message::MusicCommandDone,
                )
            }
            MusicAction::Stop => {
                shell.music.busy = true;
                Task::perform(
                    async move {
                        let client = ApiClient::new(url, Some(token))?;
                        client.control_music(&channel_id, "stop", None).await
                    },
                    Message::MusicCommandDone,
                )
            }
            MusicAction::CycleLoop => {
                shell.music.busy = true;
                let next = match shell.music.state.loop_mode.as_str() {
                    "off" | "" => "track",
                    "track" => "queue",
                    _ => "off",
                };
                Task::perform(
                    async move {
                        let client = ApiClient::new(url, Some(token))?;
                        client
                            .control_music(
                                &channel_id,
                                "loop",
                                Some(serde_json::Value::String(next.to_string())),
                            )
                            .await
                    },
                    Message::MusicCommandDone,
                )
            }
            MusicAction::VolumeChanged(vol) => {
                shell.music.state.volume = vol;
                Task::perform(
                    async move {
                        let client = ApiClient::new(url, Some(token))?;
                        client
                            .control_music(
                                &channel_id,
                                "volume",
                                Some(serde_json::Value::from(vol)),
                            )
                            .await
                    },
                    Message::MusicCommandDone,
                )
            }
            MusicAction::RemoveTrack(idx) => {
                shell.music.busy = true;
                Task::perform(
                    async move {
                        let client = ApiClient::new(url, Some(token))?;
                        client
                            .control_music(
                                &channel_id,
                                "queue_remove",
                                Some(serde_json::Value::from(idx)),
                            )
                            .await
                    },
                    Message::MusicCommandDone,
                )
            }
            MusicAction::ClearQueue => {
                shell.music.busy = true;
                Task::perform(
                    async move {
                        let client = ApiClient::new(url, Some(token))?;
                        client.control_music(&channel_id, "queue_clear", None).await
                    },
                    Message::MusicCommandDone,
                )
            }
            MusicAction::Refresh => {
                shell.music.busy = true;
                Self::load_music_task(url, token, channel_id)
            }
        }
    }

    fn handle_settings_action(&mut self, action: SettingsAction) -> Task<Message> {
        let Screen::Shell(shell) = &mut self.screen else {
            return Task::none();
        };

        match action {
            SettingsAction::SelectTab(tab) => {
                shell.settings.active_tab = tab;
                Task::none()
            }
            SettingsAction::ProfileDisplayNameChanged(v) => {
                shell.settings.profile_display_name = v;
                shell.settings.profile_note = None;
                shell.settings.profile_error = None;
                Task::none()
            }
            SettingsAction::ProfileBioChanged(v) => {
                shell.settings.profile_bio = v;
                shell.settings.profile_note = None;
                shell.settings.profile_error = None;
                Task::none()
            }
            SettingsAction::SaveProfile => {
                shell.settings.profile_saving = true;
                let display_name = shell.settings.profile_display_name.clone();
                let bio = shell.settings.profile_bio.clone();
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                Task::perform(
                    async move {
                        let client = ApiClient::new(url, Some(token))?;
                        client.update_profile(&display_name, &bio).await
                    },
                    Message::ProfileSaved,
                )
            }
            SettingsAction::NewGroupNameChanged(v) => {
                shell.settings.new_group_name = v;
                shell.settings.group_create_note = None;
                Task::none()
            }
            SettingsAction::CreateGroup => {
                let name = shell.settings.new_group_name.trim().to_string();
                if name.is_empty() {
                    return Task::none();
                }
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                Task::perform(
                    async move {
                        let client = ApiClient::new(url, Some(token))?;
                        client.create_group(&name).await
                    },
                    Message::GroupCreated,
                )
            }
            SettingsAction::NewChannelNameChanged(v) => {
                shell.settings.new_channel_name = v;
                shell.settings.channel_create_note = None;
                Task::none()
            }
            SettingsAction::ToggleNewChannelVoice => {
                shell.settings.new_channel_is_voice = !shell.settings.new_channel_is_voice;
                Task::none()
            }
            SettingsAction::CreateChannel => {
                let Some(space_id) = shell.selected_group_id.clone() else {
                    return Task::none();
                };
                let name = shell.settings.new_channel_name.trim().to_string();
                if name.is_empty() {
                    return Task::none();
                }
                let kind = if shell.settings.new_channel_is_voice {
                    "voice"
                } else {
                    "text"
                };
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                Task::perform(
                    async move {
                        let result = match ApiClient::new(url, Some(token)) {
                            Ok(client) => client.create_channel(&space_id, &name, kind).await,
                            Err(err) => Err(err),
                        };
                        Message::ChannelCreated { space_id, result }
                    },
                    std::convert::identity,
                )
            }
            SettingsAction::NewApiKeyNameChanged(v) => {
                shell.settings.new_api_key_name = v;
                shell.settings.api_keys_error = None;
                Task::none()
            }
            SettingsAction::CreateApiKey => {
                let Some(space_id) = shell.selected_group_id.clone() else {
                    return Task::none();
                };
                let name = shell.settings.new_api_key_name.trim().to_string();
                if name.is_empty() {
                    return Task::none();
                }
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                Task::perform(
                    async move {
                        let client = ApiClient::new(url, Some(token))?;
                        client.create_space_api_key(&space_id, &name).await
                    },
                    Message::ApiKeyCreated,
                )
            }
            SettingsAction::RevokeApiKey(key_id) => {
                let Some(space_id) = shell.selected_group_id.clone() else {
                    return Task::none();
                };
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                let kid = key_id.clone();
                Task::perform(
                    async move {
                        let result = match ApiClient::new(url, Some(token)) {
                            Ok(client) => client.revoke_space_api_key(&space_id, &kid).await,
                            Err(err) => Err(err),
                        };
                        Message::ApiKeyRevoked {
                            key_id: kid,
                            result,
                        }
                    },
                    std::convert::identity,
                )
            }
            SettingsAction::VoteSkipInputChanged(v) => {
                shell.settings.vote_skip_input = v;
                shell.settings.vote_skip_error = None;
                shell.settings.vote_skip_saved_note = None;
                Task::none()
            }
            SettingsAction::SaveVoteSkip => {
                let pct = match parse_vote_skip_percent(&shell.settings.vote_skip_input) {
                    Ok(v) => v,
                    Err(err) => {
                        shell.settings.vote_skip_error = Some(err);
                        shell.settings.vote_skip_saved_note = None;
                        return Task::none();
                    }
                };
                // Aplica no canal de voz ativo ou primeiro canal de voz do grupo selecionado
                let target_voice_id = shell.voice.connected_channel_id.clone().or_else(|| {
                    shell
                        .groups
                        .iter()
                        .find(|g| shell.selected_group_id.as_deref() == Some(g.id.as_str()))
                        .and_then(|g| g.channels.iter().find(|c| c.kind == "voice"))
                        .map(|c| c.id.clone())
                });
                let Some(channel_id) = target_voice_id else {
                    shell.settings.vote_skip_saved_note = Some(format!(
                        "Vote-Skip definido em {pct}% (selecione um grupo com canal de voz para sincronizar)."
                    ));
                    shell.settings.vote_skip_error = None;
                    return Task::none();
                };
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                Task::perform(
                    async move {
                        let client = ApiClient::new(url, Some(token))?;
                        client.update_music_vote_skip(&channel_id, pct).await?;
                        Ok(pct)
                    },
                    Message::VoteSkipSaved,
                )
            }
            SettingsAction::RefreshApiKeys => {
                let Some(space_id) = shell.selected_group_id.clone() else {
                    return Task::none();
                };
                shell.settings.loading_keys = true;
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                Self::load_api_keys_task(url, token, space_id)
            }
            SettingsAction::ToggleRetention => {
                shell.settings.retention_enabled = !shell.settings.retention_enabled;
                Task::none()
            }
            SettingsAction::ToggleLowInterrupt => {
                shell.settings.low_interrupt_mode = !shell.settings.low_interrupt_mode;
                self.config.low_interrupt_mode = shell.settings.low_interrupt_mode;
                let _ = self.config.save();
                Task::none()
            }
            SettingsAction::ToggleDesktopNotifications => {
                shell.settings.desktop_notifications = !shell.settings.desktop_notifications;
                self.config.desktop_notifications = shell.settings.desktop_notifications;
                let _ = self.config.save();
                Task::none()
            }
            SettingsAction::ToggleAutostart => {
                let target = !shell.settings.autostart_enabled;
                match autostart::set_enabled(target) {
                    Ok(()) => {
                        shell.settings.autostart_enabled = target;
                        shell.settings.profile_error = None;
                    }
                    Err(err) => {
                        shell.settings.profile_error = Some(err);
                    }
                }
                Task::none()
            }
            SettingsAction::SelectTheme(theme_id) => {
                shell.settings.theme = theme_id;
                self.config.theme = theme_id.code().to_string();
                let _ = self.config.save();
                Task::none()
            }
            SettingsAction::SelectLanguage(lang) => {
                shell.settings.language = lang;
                self.config.language = lang.code().to_string();
                let _ = self.config.save();
                Task::none()
            }
            SettingsAction::SelectClockFormat(fmt) => {
                shell.settings.clock_format = fmt;
                self.config.clock_format = match fmt {
                    ClockFormat::Auto => "auto",
                    ClockFormat::H24 => "h24",
                    ClockFormat::H12 => "h12",
                }
                .to_string();
                let _ = self.config.save();
                Task::none()
            }
            SettingsAction::OpenFeedUrl(url) => {
                let _ = open::that(url);
                Task::none()
            }
        }
    }

    fn load_dms_task(url: String, token: String) -> Task<Message> {
        Task::perform(
            async move {
                let client = ApiClient::new(url, Some(token))?;
                client.fetch_dms().await
            },
            Message::DmsLoaded,
        )
    }

    fn load_music_task(url: String, token: String, channel_id: String) -> Task<Message> {
        Task::perform(
            async move {
                let client = ApiClient::new(url, Some(token))?;
                client.fetch_music_state(&channel_id).await
            },
            Message::MusicStateLoaded,
        )
    }

    fn load_api_keys_task(url: String, token: String, space_id: String) -> Task<Message> {
        Task::perform(
            async move {
                let client = ApiClient::new(url, Some(token))?;
                client.fetch_space_api_keys(&space_id).await
            },
            Message::ApiKeysLoaded,
        )
    }

    fn load_groups_task(url: String, token: String) -> Task<Message> {
        Task::perform(
            async move {
                let client = ApiClient::new(url, Some(token))?;
                client.fetch_groups().await
            },
            Message::GroupsLoaded,
        )
    }

    fn load_group_detail_task(url: String, token: String, space_id: String) -> Task<Message> {
        Task::perform(
            async move {
                let client = ApiClient::new(url, Some(token))?;
                client.fetch_group_detail(&space_id).await
            },
            Message::GroupDetailLoaded,
        )
    }

    fn load_dm_messages_task(
        url: String,
        token: String,
        dm_id: String,
        before: Option<String>,
        prepend: bool,
    ) -> Task<Message> {
        Task::perform(
            async move {
                let result = match ApiClient::new(url, Some(token)) {
                    Ok(client) => client.fetch_dm_messages(&dm_id, before.as_deref()).await,
                    Err(err) => Err(err),
                };
                Message::MessagesLoaded {
                    channel_id: dm_id,
                    prepend,
                    result,
                }
            },
            std::convert::identity,
        )
    }

    fn load_messages_task(
        url: String,
        token: String,
        channel_id: String,
        before: Option<String>,
        prepend: bool,
    ) -> Task<Message> {
        Task::perform(
            async move {
                let result = match ApiClient::new(url, Some(token)) {
                    Ok(client) => client.fetch_messages(&channel_id, before.as_deref()).await,
                    Err(err) => Err(err),
                };
                Message::MessagesLoaded {
                    channel_id,
                    prepend,
                    result,
                }
            },
            std::convert::identity,
        )
    }

    fn enqueue_images_for_shell(&mut self) -> Task<Message> {
        let Screen::Shell(shell) = &mut self.screen else {
            return Task::none();
        };

        // (url_ou_path, circular)
        let mut candidates: Vec<(String, bool)> = Vec::new();
        if let Some(url) = shell.user.avatar_url.as_deref() {
            candidates.push((url.to_string(), true));
        }
        for g in &shell.groups {
            if let Some(url) = g.icon_url.as_deref() {
                candidates.push((url.to_string(), true));
            }
        }
        for dm in &shell.dm.channels {
            for u in &dm.members {
                if let Some(url) = u.avatar_url.as_deref() {
                    candidates.push((url.to_string(), true));
                }
            }
        }
        if let Some(sel_id) = shell.selected_group_id.as_deref() {
            if let Some(g) = shell.groups.iter().find(|g| g.id == sel_id) {
                for m in &g.members {
                    if let Some(url) = m.user.avatar_url.as_deref() {
                        candidates.push((url.to_string(), true));
                    }
                    if shell.selected_profile_user_id.as_deref() == Some(m.user_id.as_str()) {
                        if let Some(banner) = m.user.banner_url.as_deref() {
                            candidates.push((banner.to_string(), false));
                        }
                    }
                }
            }
        }
        let active_ch = if shell.active_panel == ActivePanel::Dms {
            shell.dm.selected_dm_id.as_deref()
        } else {
            shell.selected_channel_id.as_deref()
        };
        if let Some(ch_id) = active_ch {
            if let Some(msgs) = shell.chat.messages_by_channel.get(ch_id) {
                for msg in msgs {
                    if let Some(url) = msg.user.as_ref().and_then(|u| u.avatar_url.as_deref()) {
                        candidates.push((url.to_string(), true));
                    }
                    for att in &msg.attachments {
                        if att.is_image() {
                            candidates.push((att.preview_path(), false));
                        }
                    }
                }
            }
        }

        let base_url = shell.instance_url.clone();
        let token = self.config.auth_token.clone().unwrap_or_default();
        let mut tasks = Vec::new();

        for (raw, circular) in candidates {
            let key = raw.trim().to_string();
            if key.is_empty()
                || shell.image_cache.contains_key(&key)
                || shell.image_pending.contains(&key)
            {
                continue;
            }
            shell.image_pending.insert(key.clone());
            let base = base_url.clone();
            let tok = token.clone();
            tasks.push(Task::perform(
                async move {
                    let bytes = match ApiClient::new(base, Some(tok)) {
                        Ok(client) => client.fetch_image_bytes(&key).await.ok(),
                        Err(_) => None,
                    };
                    Message::ImageLoaded {
                        key,
                        bytes,
                        circular,
                    }
                },
                std::convert::identity,
            ));
            if tasks.len() >= 32 {
                break;
            }
        }

        if tasks.is_empty() {
            Task::none()
        } else {
            Task::batch(tasks)
        }
    }

    fn send_ws_json(&self, payload: serde_json::Value) {
        if let Some(tx) = &self.ws_tx {
            let _ = tx.send(payload.to_string());
        }
    }

    fn sync_voice_status_ws(&self) {
        if let Screen::Shell(shell) = &self.screen {
            if shell.voice.connected_channel_id.is_some() {
                self.send_ws_json(serde_json::json!({
                    "type": "voice_status",
                    "isMuted": shell.voice.muted,
                    "isDeafened": shell.voice.deafened,
                    "isCameraOn": shell.voice.camera_on,
                    "isScreenSharing": shell.stream.sharing_active,
                }));
            }
        }
    }

    fn load_soundboard_task(
        url: String,
        token: String,
        space_id: Option<String>,
    ) -> Task<Message> {
        Task::perform(
            async move {
                let client = ApiClient::new(url, Some(token))?;
                client.fetch_soundboard(space_id.as_deref()).await
            },
            Message::SoundboardLoaded,
        )
    }
}

/// Decodifica uma imagem (PNG/JPEG/WebP/GIF) e aplica máscara circular real com antialiasing suave
/// para que fotos de perfil e ícones de grupos fiquem perfeitamente redondos na GPU.
fn decode_circular_avatar(bytes: &[u8], size: u32) -> Option<iced::widget::image::Handle> {
    let img = image::load_from_memory(bytes).ok()?;
    let (w, h) = (img.width(), img.height());
    let side = w.min(h);
    if side == 0 {
        return None;
    }
    let x0 = (w - side) / 2;
    let y0 = (h - side) / 2;
    let cropped = img.crop_imm(x0, y0, side, side);
    let resized = cropped
        .resize_exact(size, size, image::imageops::FilterType::Triangle)
        .to_rgba8();

    let mut pixels = resized.into_raw();
    let center = (size as f32 - 1.0) * 0.5;
    let radius = size as f32 * 0.5 - 0.5;

    for y in 0..size {
        for x in 0..size {
            let dx = x as f32 - center;
            let dy = y as f32 - center;
            let dist = (dx * dx + dy * dy).sqrt();
            let alpha_idx = ((y * size + x) * 4 + 3) as usize;
            if dist >= radius + 0.75 {
                pixels[alpha_idx] = 0;
            } else if dist > radius - 0.75 {
                let t = ((radius + 0.75) - dist) / 1.5;
                let a = pixels[alpha_idx] as f32 * t.clamp(0.0, 1.0);
                pixels[alpha_idx] = a.round() as u8;
            }
        }
    }

    Some(iced::widget::image::Handle::from_rgba(size, size, pixels))
}

fn guess_mime_from_filename(name: &str) -> &'static str {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".mp4") {
        "video/mp4"
    } else if lower.ends_with(".webm") {
        "video/webm"
    } else if lower.ends_with(".mp3") {
        "audio/mpeg"
    } else if lower.ends_with(".wav") {
        "audio/wav"
    } else if lower.ends_with(".ogg") {
        "audio/ogg"
    } else if lower.ends_with(".pdf") {
        "application/pdf"
    } else {
        "application/octet-stream"
    }
}
