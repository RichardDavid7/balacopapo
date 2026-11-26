use iced::{Element, Subscription, Task, Theme};
use std::sync::atomic::Ordering;

use crate::core::config::{normalize_instance_url, AppConfig};
use crate::core::deep_link::{parse_deep_link, DeepLinkTarget};
use crate::core::models::{
    AuthUser, ChatMessage, GroupSummary, InstanceInfo, LiveKitTokenResponse, LoginResponse,
    PresenceStatus, SoundboardSound, WsEvent,
};
use crate::core::p2p_mesh::FileTransferStatus;
use crate::features::auth::{self, AuthMessage, AuthState};
use crate::features::chat::ChatMessageAction;
use crate::features::p2p::P2PAction;
use crate::features::shell::{self, ShellMessage, ShellState};
use crate::features::soundboard::SoundboardAction;
use crate::features::stream::{ActivePointerPing, StreamAction};
use crate::features::voice::VoiceAction;
use crate::media::audio_engine::{self, ActiveLoopback, AudioParams};
use crate::media::wav_dsp::{quadratic_gain, WavClip};
use crate::net::client::ApiClient;
use crate::net::ws;
use crate::os::updater::{self, UpdateCheckState};
use crate::ui::aether_drift;

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
    MessagesLoaded {
        channel_id: String,
        prepend: bool,
        result: Result<Vec<ChatMessage>, String>,
    },
    ChatSent(Result<ChatMessage, String>),
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
            updater::check_github_updates(),
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
        aether_drift::theme()
    }

    pub fn subscription(&self) -> Subscription<Message> {
        match &self.screen {
            Screen::Auth(_) => Subscription::none(),
            Screen::Shell(shell) => match self.config.auth_token.clone() {
                Some(token) if !token.is_empty() => {
                    ws::connect_subscription(shell.instance_url.clone(), token)
                        .map(Message::WsEvent)
                }
                _ => Subscription::none(),
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
                    self.screen = Screen::Shell(Box::new(ShellState::new(url.clone(), resp.user)));
                    Self::load_groups_task(url, resp.token)
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
                    self.screen = Screen::Shell(Box::new(ShellState::new(url.clone(), user)));
                    Self::load_groups_task(url, token)
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
                let mut auto_fetch: Option<(String, String, String)> = None;
                if let Screen::Shell(shell) = &mut self.screen {
                    shell.loading_groups = false;
                    match result {
                        Ok(groups) => {
                            shell.error = None;
                            if shell.selected_group_id.is_none() {
                                shell.selected_group_id = groups.first().map(|g| g.id.clone());
                            }
                            if shell.selected_channel_id.is_none() {
                                if let Some(first_ch) = groups
                                    .iter()
                                    .find(|g| {
                                        shell.selected_group_id.as_deref() == Some(g.id.as_str())
                                    })
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
                                        auto_fetch = Some((
                                            shell.instance_url.clone(),
                                            self.config.auth_token.clone().unwrap_or_default(),
                                            first_ch.id.clone(),
                                        ));
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
                if let Some((url, token, channel_id)) = auto_fetch {
                    Self::load_messages_task(url, token, channel_id, None, false)
                } else {
                    Task::none()
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
                Task::none()
            }
            Message::ChatSent(result) => {
                if let Screen::Shell(shell) = &mut self.screen {
                    shell.chat.sending = false;
                    match result {
                        Ok(msg) => {
                            shell.chat.error = None;
                            shell.chat.draft.clear();
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
                if let Screen::Shell(shell) = &mut self.screen {
                    shell.voice.connecting = false;
                    match result {
                        Ok(resp) => {
                            shell.voice.error = None;
                            shell.voice.connected_channel_id = Some(channel_id);
                            shell.voice.connected_channel_name = Some(channel_name);
                            shell.voice.livekit_url = Some(resp.url);
                        }
                        Err(err) => {
                            shell.voice.error = Some(err);
                        }
                    }
                }
                Task::none()
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
        let Screen::Shell(shell) = &mut self.screen else {
            return Task::none();
        };

        match event {
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
                unread_counts,
            } => {
                shell.presence = PresenceStatus::from_api_str(user.status.as_deref());
                shell.user = user;
                shell.unread_counts = unread_counts;
                shell.loading_groups = false;
                if !groups.is_empty() {
                    if shell.selected_group_id.is_none() {
                        shell.selected_group_id = groups.first().map(|g| g.id.clone());
                    }
                    shell.groups = groups;
                }
                Task::none()
            }
            WsEvent::MessageCreated(msg) => {
                let is_active =
                    shell.selected_channel_id.as_deref() == Some(msg.channel_id.as_str());
                if !is_active {
                    *shell.unread_counts.entry(msg.channel_id.clone()).or_insert(0) += 1;
                }
                shell.chat.upsert_message(msg);
                Task::none()
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
                    if let Ok(client) = ApiClient::new(url, None) {
                        let _ = open::that(client.oidc_start_url());
                        state.status_note = Some(
                            "Navegador aberto para autenticação OIDC (balacopapo://auth/callback)."
                                .to_string(),
                        );
                    }
                    Task::none()
                }
                Err(err) => {
                    state.error = Some(err);
                    Task::none()
                }
            },
            AuthMessage::CheckUpdates => {
                self.update_state = UpdateCheckState::Checking;
                Task::perform(updater::check_github_updates(), Message::UpdateChecked)
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
                shell.selected_group_id = Some(id);
                shell.selected_channel_id = None;
                shell.soundboard_open = false;
                shell.stream_open = false;
                shell.p2p_open = false;
                Task::none()
            }
            ShellMessage::SelectChannel(channel_id) => {
                shell.selected_channel_id = Some(channel_id.clone());
                shell.soundboard_open = false;
                shell.stream_open = false;
                shell.p2p_open = false;
                shell.unread_counts.remove(&channel_id);
                shell.chat.error = None;

                let is_voice = shell
                    .groups
                    .iter()
                    .flat_map(|g| g.channels.iter())
                    .find(|c| c.id == channel_id)
                    .is_some_and(|c| c.kind == "voice");

                if is_voice {
                    return Task::none();
                }

                shell.chat.loading_history = true;
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                Self::load_messages_task(url, token, channel_id, None, false)
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
            ShellMessage::ToggleSoundboard => {
                shell.soundboard_open = !shell.soundboard_open;
                if shell.soundboard_open {
                    shell.stream_open = false;
                    shell.p2p_open = false;
                }
                if shell.soundboard_open && shell.soundboard.sounds.is_empty() {
                    shell.soundboard.loading = true;
                    let url = shell.instance_url.clone();
                    let token = self.config.auth_token.clone().unwrap_or_default();
                    let space_id = shell.selected_group_id.clone();
                    return Self::load_soundboard_task(url, token, space_id);
                }
                Task::none()
            }
            ShellMessage::ToggleStream => {
                shell.stream_open = !shell.stream_open;
                if shell.stream_open {
                    shell.soundboard_open = false;
                    shell.p2p_open = false;
                }
                Task::none()
            }
            ShellMessage::ToggleP2P => {
                shell.p2p_open = !shell.p2p_open;
                if shell.p2p_open {
                    shell.soundboard_open = false;
                    shell.stream_open = false;
                }
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
            ShellMessage::Chat(action) => self.handle_chat_action(action),
            ShellMessage::Voice(action) => self.handle_voice_action(action),
            ShellMessage::Soundboard(action) => self.handle_soundboard_action(action),
            ShellMessage::Stream(action) => self.handle_stream_action(action),
            ShellMessage::P2P(action) => self.handle_p2p_action(action),
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
            ChatMessageAction::Send => {
                let Some(channel_id) = shell.selected_channel_id.clone() else {
                    return Task::none();
                };
                let content = shell.chat.draft.trim().to_string();
                if content.is_empty() || shell.chat.sending {
                    return Task::none();
                }
                shell.chat.sending = true;
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                Task::perform(
                    async move {
                        let client = ApiClient::new(url, Some(token))?;
                        client.send_message(&channel_id, &content).await
                    },
                    Message::ChatSent,
                )
            }
            ChatMessageAction::LoadOlder => {
                let Some(channel_id) = shell.selected_channel_id.clone() else {
                    return Task::none();
                };
                let before = shell.chat.oldest_message_id(&channel_id);
                shell.chat.loading_history = true;
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                Self::load_messages_task(url, token, channel_id, before, true)
            }
            ChatMessageAction::DeleteMessage(message_id) => {
                let Some(channel_id) = shell.selected_channel_id.clone() else {
                    return Task::none();
                };
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                let msg_id_clone = message_id.clone();
                Task::perform(
                    async move {
                        let result = match ApiClient::new(url, Some(token)) {
                            Ok(client) => client.delete_message(&msg_id_clone).await,
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
                shell.voice.connected_channel_id = None;
                shell.voice.connected_channel_name = None;
                shell.voice.livekit_url = None;
                shell.voice.loopback_active = false;
                shell.voice.loopback_sample_rate = None;
                Task::none()
            }
            VoiceAction::ToggleMute => {
                shell.voice.muted = !shell.voice.muted;
                self.audio_params
                    .muted
                    .store(shell.voice.muted, Ordering::Relaxed);
                Task::none()
            }
            VoiceAction::ToggleDeafen => {
                shell.voice.deafened = !shell.voice.deafened;
                self.audio_params
                    .deafened
                    .store(shell.voice.deafened, Ordering::Relaxed);
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

    fn load_groups_task(url: String, token: String) -> Task<Message> {
        Task::perform(
            async move {
                let client = ApiClient::new(url, Some(token))?;
                client.fetch_groups().await
            },
            Message::GroupsLoaded,
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
