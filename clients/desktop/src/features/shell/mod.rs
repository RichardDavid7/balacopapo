use iced::widget::{button, column, container, horizontal_space, image, row, scrollable, text};
use iced::{Alignment, Background, Border, Color, ContentFit, Element, Length, Padding};
use std::collections::{HashMap, HashSet};

use crate::core::models::{
    AuthUser, GroupMember, GroupSummary, PresenceStatus, VoiceUserMediaState,
};
use crate::features::chat::{self, ChatMessageAction, ChatState};
use crate::features::dm::{DmAction, DmState};
use crate::features::music::{self, MusicAction, MusicUiState};
use crate::features::overlay::{self, OverlayAction, OverlayAndGameState};
use crate::features::p2p::{self, P2PAction, P2PState};
use crate::features::settings::{self, SettingsAction, SettingsState};
use crate::features::soundboard::{self, SoundboardAction, SoundboardState};
use crate::features::stream::{self, StreamAction, StreamState};
use crate::features::voice::{self, VoiceAction, VoiceState};
use crate::os::updater::UpdateCheckState;
use crate::ui::{aether_drift, icons};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActivePanel {
    Channel,
    Dms,
    Soundboard,
    Stream,
    P2P,
    Overlay,
    Settings,
}

#[derive(Debug, Clone)]
pub struct ShellState {
    pub instance_url: String,
    pub user: AuthUser,
    pub presence: PresenceStatus,
    pub status_picker_open: bool,
    pub active_panel: ActivePanel,
    pub ws_connected: bool,
    pub ws_status_label: String,
    pub groups: Vec<GroupSummary>,
    pub unread_counts: HashMap<String, u32>,
    pub voice_states: HashMap<String, Vec<String>>,
    pub voice_user_states: HashMap<String, VoiceUserMediaState>,
    pub image_cache: HashMap<String, image::Handle>,
    pub image_pending: HashSet<String>,
    pub show_member_list: bool,
    pub selected_group_id: Option<String>,
    pub selected_channel_id: Option<String>,
    pub chat: ChatState,
    pub dm: DmState,
    pub voice: VoiceState,
    pub music: MusicUiState,
    pub soundboard: SoundboardState,
    pub stream: StreamState,
    pub p2p: P2PState,
    pub overlay: OverlayAndGameState,
    pub settings: SettingsState,
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
            active_panel: ActivePanel::Channel,
            ws_connected: false,
            ws_status_label: "Conectando...".to_string(),
            groups: Vec::new(),
            unread_counts: HashMap::new(),
            voice_states: HashMap::new(),
            voice_user_states: HashMap::new(),
            image_cache: HashMap::new(),
            image_pending: HashSet::new(),
            show_member_list: true,
            selected_group_id: None,
            selected_channel_id: None,
            chat: ChatState::default(),
            dm: DmState::default(),
            voice: VoiceState::default(),
            music: MusicUiState::default(),
            soundboard: SoundboardState::default(),
            stream: StreamState::default(),
            p2p: P2PState::default(),
            overlay: OverlayAndGameState::default(),
            settings: SettingsState::default(),
            loading_groups: true,
            error: None,
        }
    }
}

#[derive(Debug, Clone)]
pub enum ShellMessage {
    SelectGroup(String),
    SelectChannel(String),
    TogglePanel(ActivePanel),
    ToggleMemberList,
    RefreshGroups,
    ToggleStatusPicker,
    SetStatus(PresenceStatus),
    Chat(ChatMessageAction),
    Dm(DmAction),
    Voice(VoiceAction),
    Music(MusicAction),
    Soundboard(SoundboardAction),
    Stream(StreamAction),
    P2P(P2PAction),
    Overlay(OverlayAction),
    Settings(SettingsAction),
    ApplyStagedUpdate(std::path::PathBuf),
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

fn initials(name: &str) -> String {
    let mut out = String::new();
    for word in name.split_whitespace().take(2) {
        if let Some(ch) = word.chars().next() {
            out.push(ch.to_ascii_uppercase());
        }
    }
    if out.is_empty() {
        "B".to_string()
    } else {
        out
    }
}

/// Layout clássico de 3 colunas estilo Discord / Backspace:
/// 1) Rail de ícones redondos (DMs + Grupos)
/// 2) Barra de Canais / DMs + Barra de Voz + Dock de Usuário
/// 3) Cabeçalho limpo + Área Principal (Chat / Voz / Ferramentas)
pub fn view<'a>(
    state: &'a ShellState,
    update_state: &'a UpdateCheckState,
) -> Element<'a, ShellMessage> {
    // ── COLUNA 1: Rail de ícones (68 px) ──────────────────────────────────────
    let dm_active = state.active_panel == ActivePanel::Dms;
    let dm_rail_btn = button(
        container(icons::message(20.0, Color::WHITE)).center(Length::Fill),
    )
    .width(Length::Fixed(46.0))
    .height(Length::Fixed(46.0))
    .on_press(ShellMessage::TogglePanel(ActivePanel::Dms))
    .style(aether_drift::rail_icon_button_style(dm_active));

    let divider = container(text(""))
        .width(Length::Fixed(32.0))
        .height(Length::Fixed(2.0))
        .style(|_t| container::Style {
            background: Some(Background::Color(Color::from_rgba(1.0, 1.0, 1.0, 0.10))),
            border: Border {
                radius: 1.0.into(),
                ..Default::default()
            },
            ..Default::default()
        });

    let mut rail_items = column![dm_rail_btn, divider]
        .spacing(10)
        .align_x(Alignment::Center)
        .padding([12, 0]);

    for group in &state.groups {
        let active = !dm_active
            && state.selected_group_id.as_deref() == Some(group.id.as_str());
        let icon_content: Element<'a, ShellMessage> = if let Some(handle) = group
            .icon_url
            .as_deref()
            .and_then(|u| state.image_cache.get(u))
        {
            container(
                image(handle.clone())
                    .width(Length::Fixed(46.0))
                    .height(Length::Fixed(46.0))
                    .content_fit(ContentFit::Cover),
            )
            .width(Length::Fixed(46.0))
            .height(Length::Fixed(46.0))
            .clip(true)
            .style(move |_t| container::Style {
                border: Border {
                    radius: if active { 14.0 } else { 23.0 }.into(),
                    ..Default::default()
                },
                ..Default::default()
            })
            .into()
        } else {
            container(text(initials(&group.name)).size(15).color(Color::WHITE))
                .center(Length::Fill)
                .into()
        };

        let g_btn = button(icon_content)
            .width(Length::Fixed(46.0))
            .height(Length::Fixed(46.0))
            .padding(0)
            .on_press(ShellMessage::SelectGroup(group.id.clone()))
            .style(aether_drift::rail_icon_button_style(active));

        let pill = container(text(""))
            .width(Length::Fixed(4.0))
            .height(Length::Fixed(if active { 32.0 } else { 0.0 }))
            .style(|_t| container::Style {
                background: Some(Background::Color(Color::WHITE)),
                border: Border {
                    radius: 2.0.into(),
                    ..Default::default()
                },
                ..Default::default()
            });

        rail_items = rail_items.push(
            row![pill, g_btn]
                .spacing(6)
                .align_y(Alignment::Center),
        );
    }

    let rail = container(scrollable(rail_items))
        .width(Length::Fixed(68.0))
        .height(Length::Fill)
        .center_x(Length::Fixed(68.0))
        .style(aether_drift::rail_style);

    // ── COLUNA 2: Lista de Canais ou DMs + Dock de Usuário (244 px) ──────────
    let selected_group = state
        .groups
        .iter()
        .find(|g| state.selected_group_id.as_deref() == Some(g.id.as_str()));

    let sidebar_title = if dm_active {
        "Mensagens Diretas"
    } else {
        selected_group
            .map(|g| g.name.as_str())
            .unwrap_or("Balacopapo")
    };

    let sidebar_header = container(
        row![
            text(sidebar_title).size(15),
            horizontal_space(),
            button(icons::refresh(14.0, aether_drift::TEXT_MUTED))
                .on_press(if dm_active {
                    ShellMessage::Dm(DmAction::Refresh)
                } else {
                    ShellMessage::RefreshGroups
                })
                .padding(5)
                .style(aether_drift::icon_button_style(false)),
        ]
        .align_y(Alignment::Center),
    )
    .width(Length::Fill)
    .height(Length::Fixed(48.0))
    .padding([0, 14])
    .center_y(Length::Fixed(48.0))
    .style(|_t| container::Style {
        border: Border {
            color: Color::from_rgba(1.0, 1.0, 1.0, 0.06),
            width: 1.0,
            ..Default::default()
        },
        ..Default::default()
    });

    let mut mid_list = column![].spacing(3).padding([10, 8]);

    if dm_active {
        if state.dm.loading && state.dm.channels.is_empty() {
            mid_list = mid_list.push(
                text("Carregando DMs...")
                    .size(12)
                    .color(aether_drift::TEXT_MUTED),
            );
        } else if state.dm.channels.is_empty() {
            mid_list = mid_list.push(
                text("Nenhuma conversa direta.")
                    .size(12)
                    .color(aether_drift::TEXT_MUTED),
            );
        } else {
            for dm in &state.dm.channels {
                let label = dm.display_label(&state.user.id);
                let active = state.dm.selected_dm_id.as_deref() == Some(dm.id.as_str());
                let partner_avatar = dm
                    .members
                    .iter()
                    .find(|u| u.id != state.user.id)
                    .and_then(|u| u.avatar_url.as_deref());
                let avatar = avatar_circle(&state.image_cache, partner_avatar, &label, 28.0);
                let sub = if dm.is_group_dm() {
                    "Grupo Direto"
                } else {
                    "DM"
                };
                mid_list = mid_list.push(
                    button(
                        row![
                            avatar,
                            column![
                                text(label).size(13),
                                text(sub).size(10).color(aether_drift::TEXT_MUTED),
                            ]
                            .spacing(1),
                        ]
                        .spacing(8)
                        .align_y(Alignment::Center),
                    )
                    .width(Length::Fill)
                    .padding([6, 8])
                    .on_press(ShellMessage::Dm(DmAction::SelectDm(dm.id.clone())))
                    .style(aether_drift::channel_row_button_style(active)),
                );
            }
        }
    } else if let Some(group) = selected_group {
        if group.channels.is_empty() {
            mid_list = mid_list.push(
                text("Carregando canais...")
                    .size(12)
                    .color(aether_drift::TEXT_MUTED),
            );
        } else {
            let mut uncategorized: Vec<_> = group
                .channels
                .iter()
                .filter(|c| c.category_id.is_none())
                .collect();
            uncategorized.sort_by_key(|c| c.position);
            for ch in uncategorized {
                mid_list = mid_list.push(channel_row(state, ch));
                if ch.kind == "voice" {
                    for prow in voice_participants_rows(state, group, &ch.id) {
                        mid_list = mid_list.push(prow);
                    }
                }
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
                mid_list = mid_list.push(
                    container(
                        text(cat.name.to_uppercase())
                            .size(10)
                            .color(aether_drift::TEXT_MUTED),
                    )
                    .padding(Padding {
                        top: 12.0,
                        right: 6.0,
                        bottom: 4.0,
                        left: 6.0,
                    }),
                );
                for ch in cat_channels {
                    mid_list = mid_list.push(channel_row(state, ch));
                    if ch.kind == "voice" {
                        for prow in voice_participants_rows(state, group, &ch.id) {
                            mid_list = mid_list.push(prow);
                        }
                    }
                }
            }
        }
    } else if state.loading_groups {
        mid_list = mid_list.push(
            text("Carregando grupos...")
                .size(12)
                .color(aether_drift::TEXT_MUTED),
        );
    } else {
        mid_list = mid_list.push(
            text("Selecione um grupo na barra esquerda.")
                .size(12)
                .color(aether_drift::TEXT_MUTED),
        );
    }

    let mut sidebar_col = column![sidebar_header, scrollable(mid_list).height(Length::Fill)];

    // Mini-Player limpo acoplado acima da barra de voz quando conectado
    if let Some(ch_name) = state.voice.connected_channel_name.as_deref() {
        sidebar_col = sidebar_col.push(
            container(music::view_mini_player(&state.music, ch_name).map(ShellMessage::Music))
                .padding([4, 8]),
        );
    }

    // Barra compacta de voz conectada / loopback
    if state.voice.connected_channel_id.is_some() || state.voice.loopback_active {
        let label = state
            .voice
            .connected_channel_name
            .as_deref()
            .unwrap_or("Loopback de Mic");
        let voice_bar = container(
            row![
                column![
                    text("Voz Conectada")
                        .size(11)
                        .color(aether_drift::SUCCESS_GREEN),
                    text(label).size(12).color(aether_drift::TEXT_PRIMARY),
                ]
                .spacing(1),
                horizontal_space(),
                button(icons::phone_off(15.0, aether_drift::DANGER_RED))
                    .on_press(ShellMessage::Voice(VoiceAction::LeaveChannel))
                    .padding(6)
                    .style(aether_drift::icon_button_style(false)),
            ]
            .align_y(Alignment::Center),
        )
        .width(Length::Fill)
        .padding([8, 12])
        .style(aether_drift::dock_style);
        sidebar_col = sidebar_col.push(voice_bar);
    }

    // Popover discreto de status acima do dock do usuário
    if state.status_picker_open {
        let picker = container(
            column![
                status_option(PresenceStatus::Online),
                status_option(PresenceStatus::Idle),
                status_option(PresenceStatus::Dnd),
                status_option(PresenceStatus::Invisible),
            ]
            .spacing(2),
        )
        .width(Length::Fill)
        .padding(8)
        .style(aether_drift::card_style);
        sidebar_col = sidebar_col.push(container(picker).padding(Padding {
            top: 0.0,
            right: 8.0,
            bottom: 4.0,
            left: 8.0,
        }));
    }

    // Dock de Usuário no rodapé (estilo Discord / Backspace)
    let status_dot = container(text(""))
        .width(Length::Fixed(10.0))
        .height(Length::Fixed(10.0))
        .style(move |_t| container::Style {
            background: Some(Background::Color(status_color(state.presence))),
            border: Border {
                radius: 5.0.into(),
                ..Default::default()
            },
            ..Default::default()
        });

    let user_avatar = avatar_circle(
        &state.image_cache,
        state.user.avatar_url.as_deref(),
        state.user.label(),
        32.0,
    );

    let user_dock = container(
        row![
            button(
                row![
                    user_avatar,
                    column![
                        text(state.user.label()).size(12),
                        row![
                            status_dot,
                            text(state.presence.label_pt())
                                .size(10)
                                .color(aether_drift::TEXT_MUTED),
                        ]
                        .spacing(5)
                        .align_y(Alignment::Center),
                    ]
                    .spacing(1),
                ]
                .spacing(8)
                .align_y(Alignment::Center),
            )
            .on_press(ShellMessage::ToggleStatusPicker)
            .padding([3, 4])
            .style(aether_drift::icon_button_style(state.status_picker_open)),
            horizontal_space(),
            button(if state.voice.muted {
                icons::mic_off(15.0, aether_drift::DANGER_RED)
            } else {
                icons::mic(15.0, aether_drift::TEXT_PRIMARY)
            })
            .on_press(ShellMessage::Voice(VoiceAction::ToggleMute))
            .padding(6)
            .style(aether_drift::icon_button_style(state.voice.muted)),
            button(icons::headphones(
                15.0,
                if state.voice.deafened {
                    aether_drift::DANGER_RED
                } else {
                    aether_drift::TEXT_PRIMARY
                },
            ))
            .on_press(ShellMessage::Voice(VoiceAction::ToggleDeafen))
            .padding(6)
            .style(aether_drift::icon_button_style(state.voice.deafened)),
            button(icons::settings(15.0, aether_drift::TEXT_PRIMARY))
                .on_press(ShellMessage::TogglePanel(ActivePanel::Settings))
                .padding(6)
                .style(aether_drift::icon_button_style(
                    state.active_panel == ActivePanel::Settings
                )),
        ]
        .spacing(2)
        .align_y(Alignment::Center),
    )
    .width(Length::Fill)
    .height(Length::Fixed(56.0))
    .padding([0, 8])
    .center_y(Length::Fixed(56.0))
    .style(aether_drift::dock_style);

    sidebar_col = sidebar_col.push(user_dock);

    let channel_sidebar = container(sidebar_col)
        .width(Length::Fixed(244.0))
        .height(Length::Fill)
        .style(aether_drift::sidebar_style);

    // ── COLUNA 3: Área Principal (Cabeçalho 48 px + Conteúdo) ────────────────
    let selected_channel = selected_group.and_then(|g| {
        g.channels
            .iter()
            .find(|c| state.selected_channel_id.as_deref() == Some(c.id.as_str()))
    });

    let selected_dm = state
        .dm
        .channels
        .iter()
        .find(|d| state.dm.selected_dm_id.as_deref() == Some(d.id.as_str()));

    let (header_icon, header_title): (Element<'a, ShellMessage>, String) = match state.active_panel {
        ActivePanel::Dms => (
            icons::message(17.0, aether_drift::TEXT_MUTED).into(),
            selected_dm
                .map(|d| d.display_label(&state.user.id))
                .unwrap_or_else(|| "Mensagens Diretas".to_string()),
        ),
        ActivePanel::Settings => (
            icons::settings(17.0, aether_drift::TEXT_MUTED).into(),
            "Configurações".to_string(),
        ),
        ActivePanel::Overlay => (
            icons::layers(17.0, aether_drift::TEXT_MUTED).into(),
            "Overlay In-Game & Atalhos".to_string(),
        ),
        ActivePanel::P2P => (
            icons::network(17.0, aether_drift::TEXT_MUTED).into(),
            "Malha P2P Híbrida".to_string(),
        ),
        ActivePanel::Stream => (
            icons::monitor(17.0, aether_drift::TEXT_MUTED).into(),
            "Vídeo & Transmissão de Tela".to_string(),
        ),
        ActivePanel::Soundboard => (
            icons::music(17.0, aether_drift::TEXT_MUTED).into(),
            "Soundboard & Editor WAV".to_string(),
        ),
        ActivePanel::Channel => {
            if let Some(ch) = selected_channel {
                let ic = if ch.kind == "voice" {
                    icons::volume(17.0, aether_drift::TEXT_MUTED).into()
                } else {
                    icons::hash(17.0, aether_drift::TEXT_MUTED).into()
                };
                (ic, ch.name.clone())
            } else {
                (
                    icons::hash(17.0, aether_drift::TEXT_MUTED).into(),
                    "Balacopapo".to_string(),
                )
            }
        }
    };

    let ws_dot = container(text(""))
        .width(Length::Fixed(8.0))
        .height(Length::Fixed(8.0))
        .style(move |_t| container::Style {
            background: Some(Background::Color(if state.ws_connected {
                aether_drift::SUCCESS_GREEN
            } else {
                aether_drift::TEXT_MUTED
            })),
            border: Border {
                radius: 4.0.into(),
                ..Default::default()
            },
            ..Default::default()
        });

    let mut top_bar_row = row![
        header_icon,
        text(header_title).size(15),
        ws_dot,
        horizontal_space(),
        tool_icon_btn(
            icons::monitor(16.0, aether_drift::TEXT_PRIMARY),
            ActivePanel::Stream,
            state.active_panel,
        ),
        tool_icon_btn(
            icons::music(16.0, aether_drift::TEXT_PRIMARY),
            ActivePanel::Soundboard,
            state.active_panel,
        ),
        tool_icon_btn(
            icons::network(16.0, aether_drift::TEXT_PRIMARY),
            ActivePanel::P2P,
            state.active_panel,
        ),
        tool_icon_btn(
            icons::layers(16.0, aether_drift::TEXT_PRIMARY),
            ActivePanel::Overlay,
            state.active_panel,
        ),
        button(icons::users(
            16.0,
            if state.show_member_list {
                aether_drift::TEXT_PRIMARY
            } else {
                aether_drift::TEXT_MUTED
            },
        ))
        .on_press(ShellMessage::ToggleMemberList)
        .padding(6)
        .style(aether_drift::icon_button_style(state.show_member_list)),
        button(icons::logout(15.0, aether_drift::TEXT_MUTED))
            .on_press(ShellMessage::Logout)
            .padding(6)
            .style(aether_drift::icon_button_style(false)),
    ]
    .spacing(8)
    .align_y(Alignment::Center);

    // Botãozinho discreto somente quando atualização silenciosa já baixou com o app aberto
    match update_state {
        UpdateCheckState::ReadyToRestart {
            version,
            staged_path,
        } => {
            top_bar_row = top_bar_row.push(
                button(text(format!("Atualizar {version}")).size(11))
                    .on_press(ShellMessage::ApplyStagedUpdate(staged_path.clone()))
                    .padding([4, 9])
                    .style(aether_drift::primary_button_style),
            );
        }
        UpdateCheckState::AvailableManual {
            version,
            release_url,
        } => {
            top_bar_row = top_bar_row.push(
                button(text(format!("Nova {version}")).size(11))
                    .on_press(ShellMessage::OpenReleasePage(release_url.clone()))
                    .padding([4, 9])
                    .style(aether_drift::ghost_button_style),
            );
        }
        _ => {}
    }

    let top_bar = container(top_bar_row)
        .width(Length::Fill)
        .height(Length::Fixed(48.0))
        .padding([0, 16])
        .center_y(Length::Fixed(48.0))
        .style(aether_drift::header_bar_style);

    let center_content: Element<'a, ShellMessage> = match state.active_panel {
        ActivePanel::Dms => {
            if let Some(dm) = selected_dm {
                let label = dm.display_label(&state.user.id);
                // Reusa o mesmo chat nativo limpo para conversar direto na DM!
                let label_owned = format!("@{label}");
                dm_chat_view(
                    &state.chat,
                    &dm.id,
                    label_owned,
                    &state.user.id,
                    &state.image_cache,
                )
            } else {
                container(
                    column![
                        text("Mensagens Diretas").size(18),
                        text("Selecione uma conversa na lista à esquerda.")
                            .size(13)
                            .color(aether_drift::TEXT_MUTED),
                    ]
                    .spacing(6),
                )
                .padding(24)
                .into()
            }
        }
        ActivePanel::Settings => container(
            settings::view(
                &state.settings,
                &state.instance_url,
                selected_group.map(|g| g.name.as_str()),
            )
            .map(ShellMessage::Settings),
        )
        .padding(18)
        .height(Length::Fill)
        .into(),
        ActivePanel::Overlay => container(overlay::view(&state.overlay).map(ShellMessage::Overlay))
            .padding(18)
            .height(Length::Fill)
            .into(),
        ActivePanel::P2P => container(p2p::view(&state.p2p).map(ShellMessage::P2P))
            .padding(18)
            .height(Length::Fill)
            .into(),
        ActivePanel::Stream => container(
            scrollable(stream::view(&state.stream).map(ShellMessage::Stream)).height(Length::Fill),
        )
        .padding(18)
        .height(Length::Fill)
        .into(),
        ActivePanel::Soundboard => {
            container(soundboard::view(&state.soundboard).map(ShellMessage::Soundboard))
                .padding(18)
                .height(Length::Fill)
                .into()
        }
        ActivePanel::Channel => {
            if let Some(ch) = selected_channel {
                if ch.kind == "voice" {
                    container(
                        scrollable(voice::view(&state.voice, ch).map(ShellMessage::Voice))
                            .height(Length::Fill),
                    )
                    .padding(18)
                    .height(Length::Fill)
                    .into()
                } else {
                    chat::view(
                        &state.chat,
                        &ch.id,
                        &ch.name,
                        &state.user.id,
                        &state.image_cache,
                    )
                    .map(ShellMessage::Chat)
                }
            } else {
                container(
                    column![
                        text("Selecione um canal à esquerda").size(17),
                        text(format!("Conectado em {}", state.instance_url))
                            .size(12)
                            .color(aether_drift::TEXT_MUTED),
                    ]
                    .spacing(6),
                )
                .padding(24)
                .into()
            }
        }
    };

    let body_row: Element<'a, ShellMessage> = if state.show_member_list
        && state.active_panel == ActivePanel::Channel
    {
        if let Some(group) = selected_group {
            row![
                container(center_content)
                    .width(Length::Fill)
                    .height(Length::Fill),
                member_list_sidebar(state, group),
            ]
            .height(Length::Fill)
            .into()
        } else {
            center_content
        }
    } else {
        center_content
    };

    let mut main_col = column![top_bar, body_row].height(Length::Fill);
    if let Some(err) = &state.error {
        main_col = main_col.push(
            container(text(err).size(12).color(aether_drift::DANGER_RED)).padding([4, 16]),
        );
    }

    let main_area = container(main_col)
        .width(Length::Fill)
        .height(Length::Fill);

    row![rail, channel_sidebar, main_area].into()
}

fn dm_chat_view<'a>(
    chat_state: &'a ChatState,
    dm_id: &'a str,
    _label: String,
    user_id: &'a str,
    image_cache: &'a HashMap<String, image::Handle>,
) -> Element<'a, ShellMessage> {
    chat::view(chat_state, dm_id, "DM", user_id, image_cache).map(ShellMessage::Chat)
}

fn avatar_circle<'a>(
    cache: &'a HashMap<String, image::Handle>,
    avatar_url: Option<&'a str>,
    label: &str,
    size: f32,
) -> Element<'a, ShellMessage> {
    let radius = size * 0.5;
    if let Some(handle) = avatar_url.and_then(|u| cache.get(u)) {
        container(
            image(handle.clone())
                .width(Length::Fixed(size))
                .height(Length::Fixed(size))
                .content_fit(ContentFit::Cover),
        )
        .width(Length::Fixed(size))
        .height(Length::Fixed(size))
        .clip(true)
        .style(move |_t| container::Style {
            border: Border {
                radius: radius.into(),
                ..Default::default()
            },
            ..Default::default()
        })
        .into()
    } else {
        let font_sz = (size * 0.38).clamp(9.0, 14.0);
        container(text(initials(label)).size(font_sz).color(Color::WHITE))
            .width(Length::Fixed(size))
            .height(Length::Fixed(size))
            .center(Length::Fixed(size))
            .style(move |_t| container::Style {
                background: Some(Background::Color(aether_drift::SURFACE_ELEVATED)),
                border: Border {
                    radius: radius.into(),
                    ..Default::default()
                },
                ..Default::default()
            })
            .into()
    }
}

fn parse_hex_color(hex: &str) -> Option<Color> {
    let clean = hex.trim().trim_start_matches('#');
    if clean.len() != 6 {
        return None;
    }
    let r = u8::from_str_radix(&clean[0..2], 16).ok()?;
    let g = u8::from_str_radix(&clean[2..4], 16).ok()?;
    let b = u8::from_str_radix(&clean[4..6], 16).ok()?;
    Some(Color::from_rgb8(r, g, b))
}

fn voice_participants_rows<'a>(
    state: &'a ShellState,
    group: &'a GroupSummary,
    channel_id: &str,
) -> Vec<Element<'a, ShellMessage>> {
    let Some(user_ids) = state.voice_states.get(channel_id) else {
        return Vec::new();
    };
    let mut rows = Vec::with_capacity(user_ids.len());
    for uid in user_ids {
        let member = group.members.iter().find(|m| m.user_id == *uid);
        let (display, avatar_url) = if let Some(m) = member {
            (m.display_name().to_string(), m.user.avatar_url.as_deref())
        } else if uid == &state.user.id {
            (
                state.user.label().to_string(),
                state.user.avatar_url.as_deref(),
            )
        } else {
            (uid.clone(), None)
        };
        let media = state.voice_user_states.get(uid);
        let av = avatar_circle(&state.image_cache, avatar_url, &display, 22.0);
        let mut r = row![
            av,
            text(display).size(12).color(aether_drift::TEXT_PRIMARY),
            horizontal_space(),
        ]
        .spacing(7)
        .align_y(Alignment::Center);

        if let Some(ms) = media {
            if ms.is_muted {
                r = r.push(icons::mic_off(12.0, aether_drift::DANGER_RED));
            }
            if ms.is_deafened {
                r = r.push(icons::headphones(12.0, aether_drift::DANGER_RED));
            }
            if ms.is_screen_sharing {
                r = r.push(icons::monitor(12.0, aether_drift::SUCCESS_GREEN));
            }
        }

        rows.push(
            container(r)
                .width(Length::Fill)
                .padding(Padding {
                    top: 3.0,
                    right: 8.0,
                    bottom: 3.0,
                    left: 26.0,
                })
                .into(),
        );
    }
    rows
}

fn member_list_sidebar<'a>(
    state: &'a ShellState,
    group: &'a GroupSummary,
) -> Element<'a, ShellMessage> {
    let mut online: Vec<&GroupMember> = Vec::new();
    let mut offline: Vec<&GroupMember> = Vec::new();
    for m in &group.members {
        if m.is_online() {
            online.push(m);
        } else {
            offline.push(m);
        }
    }
    online.sort_by(|a, b| {
        a.display_name()
            .to_ascii_lowercase()
            .cmp(&b.display_name().to_ascii_lowercase())
    });
    offline.sort_by(|a, b| {
        a.display_name()
            .to_ascii_lowercase()
            .cmp(&b.display_name().to_ascii_lowercase())
    });

    let mut list = column![].spacing(4).padding([12, 10]);

    if group.members.is_empty() {
        list = list.push(
            text("Carregando membros...")
                .size(12)
                .color(aether_drift::TEXT_MUTED),
        );
    } else {
        if !online.is_empty() {
            list = list.push(
                container(
                    text(format!("ONLINE — {}", online.len()))
                        .size(10)
                        .color(aether_drift::TEXT_MUTED),
                )
                .padding(Padding {
                    top: 2.0,
                    right: 4.0,
                    bottom: 4.0,
                    left: 4.0,
                }),
            );
            for m in online {
                list = list.push(member_row(&state.image_cache, m, true));
            }
        }

        if !offline.is_empty() {
            list = list.push(
                container(
                    text(format!("OFFLINE — {}", offline.len()))
                        .size(10)
                        .color(aether_drift::TEXT_MUTED),
                )
                .padding(Padding {
                    top: 12.0,
                    right: 4.0,
                    bottom: 4.0,
                    left: 4.0,
                }),
            );
            for m in offline {
                list = list.push(member_row(&state.image_cache, m, false));
            }
        }
    }

    container(scrollable(list).height(Length::Fill))
        .width(Length::Fixed(232.0))
        .height(Length::Fill)
        .style(aether_drift::sidebar_style)
        .into()
}

fn member_row<'a>(
    cache: &'a HashMap<String, image::Handle>,
    m: &'a GroupMember,
    online: bool,
) -> Element<'a, ShellMessage> {
    let name = m.display_name();
    let av = avatar_circle(cache, m.user.avatar_url.as_deref(), name, 28.0);
    let presence = PresenceStatus::from_api_str(m.user.status.as_deref());
    let dot_color = if online {
        status_color(presence)
    } else {
        Color::from_rgba(0.60, 0.62, 0.70, 0.45)
    };
    let dot = container(text(""))
        .width(Length::Fixed(8.0))
        .height(Length::Fixed(8.0))
        .style(move |_t| container::Style {
            background: Some(Background::Color(dot_color)),
            border: Border {
                radius: 4.0.into(),
                ..Default::default()
            },
            ..Default::default()
        });

    let name_color = if online {
        m.color_hex()
            .and_then(parse_hex_color)
            .unwrap_or(aether_drift::TEXT_PRIMARY)
    } else {
        aether_drift::TEXT_MUTED
    };

    container(
        row![av, text(name).size(13).color(name_color), horizontal_space(), dot]
            .spacing(8)
            .align_y(Alignment::Center),
    )
    .width(Length::Fill)
    .padding([4, 6])
    .into()
}

fn tool_icon_btn<'a>(
    svg_icon: iced::widget::svg::Svg<'a>,
    panel: ActivePanel,
    current: ActivePanel,
) -> Element<'a, ShellMessage> {
    button(svg_icon)
        .on_press(ShellMessage::TogglePanel(panel))
        .padding(6)
        .style(aether_drift::icon_button_style(panel == current))
        .into()
}

fn channel_row<'a>(
    state: &'a ShellState,
    ch: &'a crate::core::models::ChannelSummary,
) -> Element<'a, ShellMessage> {
    let active = state.active_panel == ActivePanel::Channel
        && state.selected_channel_id.as_deref() == Some(ch.id.as_str());
    let icon_color = if active {
        aether_drift::TEXT_PRIMARY
    } else {
        aether_drift::TEXT_MUTED
    };
    let ch_icon: Element<'a, ShellMessage> = if ch.kind == "voice" {
        icons::volume(15.0, icon_color).into()
    } else {
        icons::hash(15.0, icon_color).into()
    };

    let unread = state.unread_counts.get(&ch.id).copied().unwrap_or(0);
    let mut row_content = row![ch_icon, text(&ch.name).size(13)]
        .spacing(8)
        .align_y(Alignment::Center);

    if unread > 0 {
        row_content = row_content.push(horizontal_space()).push(
            container(text(unread.to_string()).size(10).color(Color::WHITE))
                .padding([1, 6])
                .style(|_t| container::Style {
                    background: Some(Background::Color(aether_drift::ACCENT_VIOLET)),
                    border: Border {
                        radius: 8.0.into(),
                        ..Default::default()
                    },
                    ..Default::default()
                }),
        );
    }

    button(row_content)
        .width(Length::Fill)
        .padding([6, 8])
        .on_press(ShellMessage::SelectChannel(ch.id.clone()))
        .style(aether_drift::channel_row_button_style(active))
        .into()
}

fn status_option<'a>(status: PresenceStatus) -> Element<'a, ShellMessage> {
    let dot = container(text(""))
        .width(Length::Fixed(8.0))
        .height(Length::Fixed(8.0))
        .style(move |_t| container::Style {
            background: Some(Background::Color(status_color(status))),
            border: Border {
                radius: 4.0.into(),
                ..Default::default()
            },
            ..Default::default()
        });
    button(
        row![dot, text(status.label_pt()).size(12)]
            .spacing(8)
            .align_y(Alignment::Center),
    )
    .width(Length::Fill)
    .padding([5, 8])
    .on_press(ShellMessage::SetStatus(status))
    .style(aether_drift::channel_row_button_style(false))
    .into()
}
