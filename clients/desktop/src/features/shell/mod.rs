use iced::widget::{button, column, container, horizontal_space, row, scrollable, text};
use iced::{Alignment, Color, Element, Length};
use std::collections::HashMap;

use crate::core::models::{AuthUser, GroupSummary, PresenceStatus};
use crate::features::chat::{self, ChatMessageAction, ChatState};
use crate::features::p2p::{self, P2PAction, P2PState};
use crate::features::soundboard::{self, SoundboardAction, SoundboardState};
use crate::features::stream::{self, StreamAction, StreamState};
use crate::features::voice::{self, VoiceAction, VoiceState};
use crate::os::updater::UpdateCheckState;
use crate::ui::aether_drift;

#[derive(Debug, Clone)]
pub struct ShellState {
    pub instance_url: String,
    pub user: AuthUser,
    pub presence: PresenceStatus,
    pub status_picker_open: bool,
    pub soundboard_open: bool,
    pub stream_open: bool,
    pub p2p_open: bool,
    pub ws_connected: bool,
    pub ws_status_label: String,
    pub groups: Vec<GroupSummary>,
    pub unread_counts: HashMap<String, u32>,
    pub selected_group_id: Option<String>,
    pub selected_channel_id: Option<String>,
    pub chat: ChatState,
    pub voice: VoiceState,
    pub soundboard: SoundboardState,
    pub stream: StreamState,
    pub p2p: P2PState,
    pub loading_groups: bool,
    pub error: Option<String>,
}

impl ShellState {
    pub fn new(instance_url: String, user: AuthUser) -> Self {
        let presence = PresenceStatus::from_api_str(user.status.as_deref());
        Self {
            instance_url,
            user,
            presence,
            status_picker_open: false,
            soundboard_open: false,
            stream_open: false,
            p2p_open: false,
            ws_connected: false,
            ws_status_label: "Conectando WS...".to_string(),
            groups: Vec::new(),
            unread_counts: HashMap::new(),
            selected_group_id: None,
            selected_channel_id: None,
            chat: ChatState::default(),
            voice: VoiceState::default(),
            soundboard: SoundboardState::default(),
            stream: StreamState::default(),
            p2p: P2PState::default(),
            loading_groups: true,
            error: None,
        }
    }
}

#[derive(Debug, Clone)]
pub enum ShellMessage {
    SelectGroup(String),
    SelectChannel(String),
    RefreshGroups,
    ToggleStatusPicker,
    ToggleSoundboard,
    ToggleStream,
    ToggleP2P,
    SetStatus(PresenceStatus),
    Chat(ChatMessageAction),
    Voice(VoiceAction),
    Soundboard(SoundboardAction),
    Stream(StreamAction),
    P2P(P2PAction),
    OpenReleasePage(String),
    Logout,
}

fn status_color(status: PresenceStatus) -> Color {
    match status {
        PresenceStatus::Online => aether_drift::SUCCESS_GREEN,
        PresenceStatus::Idle => Color::from_rgb(0.984, 0.749, 0.141),
        PresenceStatus::Dnd => aether_drift::DANGER_RED,
        PresenceStatus::Invisible => aether_drift::TEXT_MUTED,
    }
}

pub fn view<'a>(
    state: &'a ShellState,
    update_state: &'a UpdateCheckState,
) -> Element<'a, ShellMessage> {
    let mut group_list =
        column![text("GRUPOS").size(11).color(aether_drift::TEXT_MUTED)].spacing(6);

    if state.loading_groups && state.groups.is_empty() {
        group_list = group_list.push(
            text("Carregando grupos...")
                .size(13)
                .color(aether_drift::TEXT_MUTED),
        );
    } else if state.groups.is_empty() {
        group_list = group_list.push(
            text("Nenhum grupo encontrado.")
                .size(13)
                .color(aether_drift::TEXT_MUTED),
        );
    } else {
        for group in &state.groups {
            let active = state.selected_group_id.as_deref() == Some(group.id.as_str());
            let style = if active {
                aether_drift::primary_button_style
            } else {
                aether_drift::ghost_button_style
            };
            group_list = group_list.push(
                button(text(&group.name).size(13))
                    .width(Length::Fill)
                    .padding([8, 10])
                    .on_press(ShellMessage::SelectGroup(group.id.clone()))
                    .style(style),
            );
        }
    }

    let selected_group = state
        .groups
        .iter()
        .find(|g| state.selected_group_id.as_deref() == Some(g.id.as_str()));

    let mut channel_list =
        column![text("CANAIS").size(11).color(aether_drift::TEXT_MUTED)].spacing(6);

    if let Some(group) = selected_group {
        if group.channels.is_empty() {
            channel_list = channel_list.push(
                text("Sem canais carregados.")
                    .size(12)
                    .color(aether_drift::TEXT_MUTED),
            );
        } else {
            for ch in group.channels.iter().filter(|c| c.category_id.is_none()) {
                channel_list = channel_list.push(channel_button(state, ch));
            }
            let mut categories = group.categories.clone();
            categories.sort_by_key(|c| c.position);
            for cat in &categories {
                let mut cat_channels: Vec<_> = group
                    .channels
                    .iter()
                    .filter(|c| c.category_id.as_deref() == Some(cat.id.as_str()))
                    .collect();
                cat_channels.sort_by_key(|c| c.position);
                if cat_channels.is_empty() {
                    continue;
                }
                channel_list = channel_list.push(
                    text(cat.name.to_uppercase())
                        .size(10)
                        .color(aether_drift::TEXT_MUTED),
                );
                for ch in cat_channels {
                    channel_list = channel_list.push(channel_button(state, ch));
                }
            }
        }
    }

    let mut sidebar_col = column![
        scrollable(group_list).height(Length::FillPortion(1)),
        scrollable(channel_list).height(Length::FillPortion(2)),
    ]
    .spacing(10);

    // Barra compacta de voz conectada / teste de loopback
    if state.voice.connected_channel_id.is_some() || state.voice.loopback_active {
        let label = state
            .voice
            .connected_channel_name
            .as_deref()
            .map(|n| format!("🔊 {n}"))
            .unwrap_or_else(|| "🎙 Loopback de Mic ativo".to_string());
        let voice_bar = container(
            row![
                text(label).size(12).color(aether_drift::SUCCESS_GREEN),
                horizontal_space(),
                button(text(if state.voice.muted { "Unmute" } else { "Mute" }).size(11))
                    .on_press(ShellMessage::Voice(VoiceAction::ToggleMute))
                    .padding([3, 7])
                    .style(aether_drift::ghost_button_style),
                button(text("Sair").size(11))
                    .on_press(ShellMessage::Voice(VoiceAction::LeaveChannel))
                    .padding([3, 7])
                    .style(aether_drift::ghost_button_style),
            ]
            .spacing(6)
            .align_y(Alignment::Center),
        )
        .padding(8)
        .style(aether_drift::pill_style);
        sidebar_col = sidebar_col.push(voice_bar);
    }

    let mut user_footer = column![row![
        column![
            text(state.user.label()).size(13),
            button(
                text(format!("● {}", state.presence.label_pt()))
                    .size(11)
                    .color(status_color(state.presence))
            )
            .on_press(ShellMessage::ToggleStatusPicker)
            .padding([2, 4])
            .style(aether_drift::ghost_button_style),
        ]
        .spacing(2),
        horizontal_space(),
        button(text("Sair").size(12))
            .on_press(ShellMessage::Logout)
            .padding([6, 10])
            .style(aether_drift::ghost_button_style),
    ]
    .align_y(Alignment::Center)]
    .spacing(8);

    if state.status_picker_open {
        let picker = column![
            status_option(PresenceStatus::Online),
            status_option(PresenceStatus::Idle),
            status_option(PresenceStatus::Dnd),
            status_option(PresenceStatus::Invisible),
        ]
        .spacing(4);
        user_footer = user_footer.push(picker);
    }

    sidebar_col = sidebar_col.push(
        container(user_footer)
            .padding(10)
            .style(aether_drift::card_style),
    );

    let sidebar = container(sidebar_col)
        .width(Length::Fixed(276.0))
        .height(Length::Fill)
        .padding(14)
        .style(aether_drift::sidebar_style);

    let ws_color = if state.ws_connected {
        aether_drift::SUCCESS_GREEN
    } else {
        aether_drift::TEXT_MUTED
    };

    let sb_style = if state.soundboard_open {
        aether_drift::primary_button_style
    } else {
        aether_drift::ghost_button_style
    };
    let stream_style = if state.stream_open {
        aether_drift::primary_button_style
    } else {
        aether_drift::ghost_button_style
    };
    let p2p_style = if state.p2p_open {
        aether_drift::primary_button_style
    } else {
        aether_drift::ghost_button_style
    };

    let mut top_bar = row![
        text(
            selected_group
                .map(|g| g.name.as_str())
                .unwrap_or("Balacopapo Desktop")
        )
        .size(16),
        container(text(&state.ws_status_label).size(11).color(ws_color))
            .padding([4, 10])
            .style(aether_drift::pill_style),
        horizontal_space(),
        button(text("🕸️ P2P").size(12))
            .on_press(ShellMessage::ToggleP2P)
            .padding([6, 12])
            .style(p2p_style),
        button(text("🖥️ Stream").size(12))
            .on_press(ShellMessage::ToggleStream)
            .padding([6, 12])
            .style(stream_style),
        button(text("🎵 Soundboard").size(12))
            .on_press(ShellMessage::ToggleSoundboard)
            .padding([6, 12])
            .style(sb_style),
        button(text("Atualizar").size(12))
            .on_press(ShellMessage::RefreshGroups)
            .padding([6, 12])
            .style(aether_drift::ghost_button_style),
    ]
    .spacing(8)
    .align_y(Alignment::Center);

    if let UpdateCheckState::Available {
        version,
        release_url,
    } = update_state
    {
        top_bar = top_bar.push(
            button(text(format!("Atualizar para {version}")).size(12))
                .on_press(ShellMessage::OpenReleasePage(release_url.clone()))
                .padding([6, 12])
                .style(aether_drift::primary_button_style),
        );
    }

    let selected_channel = selected_group.and_then(|g| {
        g.channels
            .iter()
            .find(|c| state.selected_channel_id.as_deref() == Some(c.id.as_str()))
    });

    let center_content: Element<'a, ShellMessage> = if state.p2p_open {
        p2p::view(&state.p2p).map(ShellMessage::P2P)
    } else if state.stream_open {
        scrollable(stream::view(&state.stream).map(ShellMessage::Stream))
            .height(Length::Fill)
            .into()
    } else if state.soundboard_open {
        soundboard::view(&state.soundboard).map(ShellMessage::Soundboard)
    } else if let Some(ch) = selected_channel {
        if ch.kind == "voice" {
            scrollable(voice::view(&state.voice, ch).map(ShellMessage::Voice))
                .height(Length::Fill)
                .into()
        } else {
            chat::view(&state.chat, ch, &state.user.id).map(ShellMessage::Chat)
        }
    } else {
        container(
            column![
                text("Selecione um canal de texto ou voz").size(17),
                text(format!("Instância conectada: {}", state.instance_url))
                    .size(13)
                    .color(aether_drift::TEXT_MUTED),
                text("Marco 3 ativo: Motor de Áudio Nativo Lock-Free (WASAPI/PipeWire + RNNoise + Opus 5 níveis + Soundboard com Editor WAV em GPU).")
                    .size(13)
                    .color(aether_drift::TEXT_MUTED),
            ]
            .spacing(10),
        )
        .width(Length::Fill)
        .padding(22)
        .style(aether_drift::card_style)
        .into()
    };

    let mut body = column![top_bar, center_content].spacing(14);
    if let Some(err) = &state.error {
        body = body.push(text(err).size(12).color(aether_drift::DANGER_RED));
    }

    let main_area = container(body)
        .width(Length::Fill)
        .height(Length::Fill)
        .padding(18);

    row![sidebar, main_area].into()
}

fn channel_button<'a>(
    state: &'a ShellState,
    ch: &'a crate::core::models::ChannelSummary,
) -> Element<'a, ShellMessage> {
    let prefix = if ch.kind == "voice" { "🔊 " } else { "# " };
    let unread = state.unread_counts.get(&ch.id).copied().unwrap_or(0);
    let label = if unread > 0 {
        format!("{prefix}{} ({unread})", ch.name)
    } else {
        format!("{prefix}{}", ch.name)
    };
    let active = !state.soundboard_open
        && !state.stream_open
        && !state.p2p_open
        && state.selected_channel_id.as_deref() == Some(ch.id.as_str());
    let style = if active {
        aether_drift::primary_button_style
    } else {
        aether_drift::ghost_button_style
    };
    button(text(label).size(13))
        .width(Length::Fill)
        .padding([7, 10])
        .on_press(ShellMessage::SelectChannel(ch.id.clone()))
        .style(style)
        .into()
}

fn status_option<'a>(status: PresenceStatus) -> Element<'a, ShellMessage> {
    button(
        text(format!("● {}", status.label_pt()))
            .size(12)
            .color(status_color(status)),
    )
    .width(Length::Fill)
    .padding([5, 8])
    .on_press(ShellMessage::SetStatus(status))
    .style(aether_drift::ghost_button_style)
    .into()
}
