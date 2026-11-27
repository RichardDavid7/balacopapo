use iced::widget::{
    button, column, container, horizontal_space, image, opaque, row, scrollable, stack, text,
    vertical_space,
};
use iced::{Alignment, Background, Border, Color, ContentFit, Element, Length, Padding};
use std::collections::{HashMap, HashSet};

use crate::core::models::{
    format_date_pt_ms, AuthUser, ChannelSummary, GroupMember, GroupSummary, PresenceStatus,
    RoleSummary, VoiceUserMediaState,
};
use crate::features::chat::{self, ChatMessageAction, ChatState};
use crate::features::dm::{DmAction, DmState};
use crate::features::music::{self, MusicAction, MusicUiState};
use crate::features::overlay::{self, OverlayAction, OverlayAndGameState};
use crate::features::p2p::{self, P2PAction, P2PState};
use crate::features::settings::{self, SettingsAction, SettingsState, SettingsTab};
use crate::features::soundboard::{self, SoundboardAction, SoundboardState};
use crate::features::stream::{self, StreamAction, StreamState};
use crate::features::voice::{self, VoiceAction, VoiceParticipantCard, VoiceState};
use crate::os::updater::UpdateCheckState;
use crate::ui::{aether_drift, icons};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActivePanel {
    Channel,
    Dms,
    Music,
    Soundboard,
    Stream,
    P2P,
    Overlay,
    Settings,
}

#[allow(dead_code)]
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
    pub collapsed_categories: HashSet<String>,
    pub unread_counts: HashMap<String, u32>,
    pub voice_states: HashMap<String, Vec<String>>,
    pub voice_user_states: HashMap<String, VoiceUserMediaState>,
    pub image_cache: HashMap<String, image::Handle>,
    pub image_pending: HashSet<String>,
    pub show_member_list: bool,
    pub selected_profile_user_id: Option<String>,
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
        let settings = SettingsState {
            profile_display_name: user.display_name.clone().unwrap_or_default(),
            profile_bio: user.bio.clone().unwrap_or_default(),
            ..SettingsState::default()
        };
        Self {
            instance_url,
            user,
            presence,
            status_picker_open: false,
            active_panel: ActivePanel::Channel,
            ws_connected: false,
            ws_status_label: "Conectando...".to_string(),
            groups: Vec::new(),
            collapsed_categories: HashSet::new(),
            unread_counts: HashMap::new(),
            voice_states: HashMap::new(),
            voice_user_states: HashMap::new(),
            image_cache: HashMap::new(),
            image_pending: HashSet::new(),
            show_member_list: true,
            selected_profile_user_id: None,
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
            settings,
            loading_groups: true,
            error: None,
        }
    }
}

#[derive(Debug, Clone)]
pub enum ShellMessage {
    SelectGroup(String),
    SelectChannel(String),
    ToggleCategory(String),
    TogglePanel(ActivePanel),
    OpenSettingsTab(SettingsTab),
    ToggleMemberList,
    OpenProfile(String),
    CloseProfile,
    StartDmWithUser(String),
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
        PresenceStatus::Idle => aether_drift::STATUS_IDLE,
        PresenceStatus::Dnd => aether_drift::DANGER_RED,
        PresenceStatus::Invisible => aether_drift::STATUS_OFFLINE,
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

fn dim_color(c: Color, factor: f32) -> Color {
    Color::from_rgba(c.r, c.g, c.b, factor)
}

/// Cor oficial de um membro seguindo `memberGroups.ts` do Backspace Web:
/// 1) Cor do cargo de maior `position` (`top_role()`)
/// 2) Se for dono do grupo sem cargo colorido, `ACCENT_ROSE` (`#FDA4AF`)
/// 3) Caso contrário, `TEXT_PRIMARY` (`#EFEFEF`)
fn resolve_member_color(group: &GroupSummary, m: &GroupMember) -> Color {
    if let Some(c) = m.color_hex().and_then(parse_hex_color) {
        return c;
    }
    if group.owner_id.as_deref() == Some(m.user_id.as_str()) {
        return aether_drift::ACCENT_ROSE;
    }
    aether_drift::TEXT_PRIMARY
}

/// Layout 1:1 do Backspace / Balacopapo Web (`SpaceSidebar` 72px + `ChannelSidebar` 240px com
/// bolha unificada inferior + `MainContent` `#13131A` + `MemberSidebar` 240px + Overlays flutuantes).
pub fn view<'a>(
    state: &'a ShellState,
    update_state: &'a UpdateCheckState,
) -> Element<'a, ShellMessage> {
    let selected_group = state
        .groups
        .iter()
        .find(|g| state.selected_group_id.as_deref() == Some(g.id.as_str()));

    // Mapas de cores de cargo e apelidos do grupo ativo para o Chat
    let mut author_colors: HashMap<String, Color> = HashMap::new();
    let mut author_nicks: HashMap<String, String> = HashMap::new();
    if let Some(g) = selected_group {
        for m in &g.members {
            author_colors.insert(m.user_id.clone(), resolve_member_color(g, m));
            author_nicks.insert(m.user_id.clone(), m.display_name().to_string());
        }
    }

    // ── COLUNA 1: Space Rail (`72 px`, `#0B0B10`) ────────────────────────────
    let dm_active = state.active_panel == ActivePanel::Dms;
    let home_fg = if dm_active {
        aether_drift::BG_RAIL
    } else {
        Color::WHITE
    };
    let home_pill = rail_left_pill(dm_active);
    let home_btn = button(container(icons::backspace_mark(22.0, home_fg)).center(Length::Fill))
        .width(Length::Fixed(40.0))
        .height(Length::Fixed(40.0))
        .padding(0)
        .on_press(ShellMessage::TogglePanel(ActivePanel::Dms))
        .style(aether_drift::rail_home_button_style(dm_active));

    let home_row = row![
        home_pill,
        container(home_btn)
            .width(Length::Fill)
            .center_x(Length::Fill),
    ]
    .width(Length::Fixed(72.0))
    .align_y(Alignment::Center);

    let mut rail_items = column![home_row, rail_divider()]
        .spacing(8)
        .align_x(Alignment::Center)
        .padding([12, 0]);

    for group in &state.groups {
        let active =
            !dm_active && state.selected_group_id.as_deref() == Some(group.id.as_str());
        let cache_key = if active {
            group
                .icon_url
                .as_deref()
                .map(|u| format!("#squircle:{u}"))
                .and_then(|k| state.image_cache.get(&k))
                .or_else(|| {
                    group
                        .icon_url
                        .as_deref()
                        .and_then(|u| state.image_cache.get(u))
                })
        } else {
            group
                .icon_url
                .as_deref()
                .and_then(|u| state.image_cache.get(u))
        };

        let icon_content: Element<'a, ShellMessage> = if let Some(handle) = cache_key {
            image(handle.clone())
                .width(Length::Fixed(40.0))
                .height(Length::Fixed(40.0))
                .content_fit(ContentFit::Cover)
                .into()
        } else {
            container(text(initials(&group.name)).size(14).color(Color::WHITE))
                .center(Length::Fill)
                .into()
        };

        let g_btn = button(icon_content)
            .width(Length::Fixed(40.0))
            .height(Length::Fixed(40.0))
            .padding(0)
            .on_press(ShellMessage::SelectGroup(group.id.clone()))
            .style(if cache_key.is_some() {
                aether_drift::icon_button_style(false)
            } else {
                aether_drift::rail_icon_button_style(active)
            });

        let g_row = row![
            rail_left_pill(active),
            container(g_btn)
                .width(Length::Fill)
                .center_x(Length::Fill),
        ]
        .width(Length::Fixed(72.0))
        .align_y(Alignment::Center);

        rail_items = rail_items.push(g_row);
    }

    // Os 3 botões redondos mint (`+`, Entrar, Explorar) logo abaixo dos grupos igual à screenshot!
    rail_items = rail_items
        .push(rail_divider())
        .push(rail_mint_action_row(
            icons::add_circle(20.0, aether_drift::SUCCESS_GREEN),
            ShellMessage::OpenSettingsTab(SettingsTab::Account),
        ))
        .push(rail_mint_action_row(
            icons::join_arrow(18.0, aether_drift::SUCCESS_GREEN),
            ShellMessage::OpenSettingsTab(SettingsTab::Account),
        ))
        .push(rail_mint_action_row(
            icons::explore_compass(20.0, aether_drift::SUCCESS_GREEN),
            ShellMessage::RefreshGroups,
        ));

    let rail = container(scrollable(rail_items).height(Length::Fill))
        .width(Length::Fixed(72.0))
        .height(Length::Fill)
        .style(aether_drift::rail_style);

    // ── COLUNA 2: Channel Sidebar (`240 px`, `#1A1A23`) + Bolha Unificada ────
    let sidebar_title = if dm_active {
        "Mensagens Diretas"
    } else {
        selected_group
            .map(|g| g.name.as_str())
            .unwrap_or("Balacopapo")
    };

    let sidebar_header = container(
        row![
            button(
                row![
                    text(sidebar_title)
                        .size(15)
                        .color(aether_drift::TEXT_PRIMARY),
                    icons::chevron_down(16.0, aether_drift::TEXT_SECONDARY),
                ]
                .spacing(4)
                .align_y(Alignment::Center),
            )
            .padding([4, 4])
            .on_press(if dm_active {
                ShellMessage::Dm(DmAction::Refresh)
            } else {
                ShellMessage::OpenSettingsTab(SettingsTab::Group)
            })
            .style(aether_drift::icon_button_style(false)),
            horizontal_space(),
            button(if dm_active {
                icons::refresh(15.0, aether_drift::TEXT_SECONDARY)
            } else {
                icons::invite_user(16.0, aether_drift::TEXT_SECONDARY)
            })
            .on_press(if dm_active {
                ShellMessage::Dm(DmAction::Refresh)
            } else {
                ShellMessage::OpenSettingsTab(SettingsTab::Group)
            })
            .padding(5)
            .style(aether_drift::icon_button_style(false)),
        ]
        .align_y(Alignment::Center),
    )
    .width(Length::Fill)
    .height(Length::Fixed(48.0))
    .padding([0, 12])
    .center_y(Length::Fixed(48.0))
    .style(|_t| container::Style {
        border: Border {
            color: aether_drift::BORDER_HARD,
            width: 1.0,
            ..Default::default()
        },
        ..Default::default()
    });

    let mut mid_list = column![].spacing(2).padding([10, 8]);

    if dm_active {
        if state.dm.loading && state.dm.channels.is_empty() {
            mid_list = mid_list.push(
                container(
                    text("Carregando conversas...")
                        .size(12)
                        .color(aether_drift::TEXT_MUTED),
                )
                .padding([8, 8]),
            );
        } else if state.dm.channels.is_empty() {
            mid_list = mid_list.push(
                container(
                    text("Nenhuma mensagem direta ainda.")
                        .size(12)
                        .color(aether_drift::TEXT_MUTED),
                )
                .padding([8, 8]),
            );
        } else {
            for dm in &state.dm.channels {
                let label = dm.display_label(&state.user.id);
                let active = state.dm.selected_dm_id.as_deref() == Some(dm.id.as_str());
                let partner = dm.members.iter().find(|u| u.id != state.user.id);
                let partner_avatar = partner.and_then(|u| u.avatar_url.as_deref());
                let avatar = avatar_circle(&state.image_cache, partner_avatar, &label, 30.0);
                let sub = partner
                    .and_then(|u| u.custom_status.as_deref())
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or(if dm.is_group_dm() {
                        "Grupo Direto"
                    } else {
                        "Conversa Direta"
                    });
                mid_list = mid_list.push(
                    button(
                        row![
                            left_active_bar(active),
                            avatar,
                            column![
                                text(label).size(13.5).color(if active {
                                    aether_drift::TEXT_PRIMARY
                                } else {
                                    aether_drift::TEXT_SECONDARY
                                }),
                                text(sub).size(10.5).color(aether_drift::TEXT_MUTED),
                            ]
                            .spacing(1),
                        ]
                        .spacing(8)
                        .align_y(Alignment::Center),
                    )
                    .width(Length::Fill)
                    .padding([5, 6])
                    .on_press(ShellMessage::Dm(DmAction::SelectDm(dm.id.clone())))
                    .style(aether_drift::channel_row_button_style(active)),
                );
            }
        }
    } else if let Some(group) = selected_group {
        if group.channels.is_empty() {
            mid_list = mid_list.push(
                container(
                    text("Carregando canais...")
                        .size(12)
                        .color(aether_drift::TEXT_MUTED),
                )
                .padding([8, 8]),
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
                let collapsed = state.collapsed_categories.contains(&cat.id);
                let chev = if collapsed {
                    icons::chevron_right(12.0, aether_drift::TEXT_CATEGORY)
                } else {
                    icons::chevron_down(12.0, aether_drift::TEXT_CATEGORY)
                };
                let mut cat_hdr = row![
                    chev,
                    text(cat.name.to_uppercase())
                        .size(10.5)
                        .color(aether_drift::TEXT_CATEGORY),
                ]
                .spacing(3)
                .align_y(Alignment::Center);

                if cat.is_private {
                    cat_hdr = cat_hdr.push(icons::lock(10.5, aether_drift::TEXT_CATEGORY));
                }

                mid_list = mid_list.push(
                    container(
                        button(cat_hdr)
                            .width(Length::Fill)
                            .padding([3, 2])
                            .on_press(ShellMessage::ToggleCategory(cat.id.clone()))
                            .style(aether_drift::icon_button_style(false)),
                    )
                    .padding(Padding {
                        top: 12.0,
                        right: 2.0,
                        bottom: 2.0,
                        left: 2.0,
                    }),
                );

                if !collapsed {
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
        }
    } else if state.loading_groups {
        mid_list = mid_list.push(
            container(
                text("Carregando grupos...")
                    .size(12)
                    .color(aether_drift::TEXT_MUTED),
            )
            .padding([8, 8]),
        );
    } else {
        mid_list = mid_list.push(
            container(
                text("Selecione um grupo na barra esquerda.")
                    .size(12)
                    .color(aether_drift::TEXT_MUTED),
            )
            .padding([8, 8]),
        );
    }

    // ── Bolha Flutuante Inferior Unificada (`glass-bubble rounded-[14px]`) ───
    let bottom_bubble = build_unified_bottom_bubble(state);

    let sidebar_col = column![
        sidebar_header,
        scrollable(mid_list).height(Length::Fill),
        container(bottom_bubble).padding(Padding {
            top: 4.0,
            right: 8.0,
            bottom: 10.0,
            left: 8.0,
        }),
    ];

    let channel_sidebar = container(sidebar_col)
        .width(Length::Fixed(240.0))
        .height(Length::Fill)
        .style(aether_drift::sidebar_style);

    // ── COLUNA 3: Cabeçalho Limpo (`48 px`) + Área Central + Membros ─────────
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

    let (header_icon, header_title, header_topic): (
        Element<'a, ShellMessage>,
        String,
        Option<&'a str>,
    ) = match state.active_panel {
        ActivePanel::Dms => (
            icons::message(17.0, aether_drift::TEXT_MUTED).into(),
            selected_dm
                .map(|d| d.display_label(&state.user.id))
                .unwrap_or_else(|| "Mensagens Diretas".to_string()),
            None,
        ),
        ActivePanel::Settings => (
            icons::settings(17.0, aether_drift::TEXT_MUTED).into(),
            "Configurações".to_string(),
            None,
        ),
        ActivePanel::Overlay => (
            icons::layers(17.0, aether_drift::TEXT_MUTED).into(),
            "Overlay In-Game & Atalhos".to_string(),
            None,
        ),
        ActivePanel::P2P => (
            icons::download_tray(17.0, aether_drift::TEXT_MUTED).into(),
            "Transferências & Malha P2P".to_string(),
            None,
        ),
        ActivePanel::Stream => (
            icons::monitor(17.0, aether_drift::TEXT_MUTED).into(),
            "Vídeo & Compartilhamento de Tela".to_string(),
            None,
        ),
        ActivePanel::Music => (
            icons::music(17.0, aether_drift::TEXT_MUTED).into(),
            "Bot de Música".to_string(),
            None,
        ),
        ActivePanel::Soundboard => (
            icons::music(17.0, aether_drift::TEXT_MUTED).into(),
            "Soundboard & Editor WAV".to_string(),
            None,
        ),
        ActivePanel::Channel => {
            if let Some(ch) = selected_channel {
                let ic = if ch.kind == "voice" {
                    icons::volume(18.0, aether_drift::TEXT_MUTED).into()
                } else {
                    icons::hash(18.0, aether_drift::TEXT_MUTED).into()
                };
                let topic = ch.topic.as_deref().filter(|t| !t.trim().is_empty());
                (ic, ch.name.clone(), topic)
            } else {
                (
                    icons::hash(18.0, aether_drift::TEXT_MUTED).into(),
                    "Balacopapo".to_string(),
                    None,
                )
            }
        }
    };

    let mut left_hdr = row![
        header_icon,
        text(header_title)
            .size(15)
            .color(aether_drift::TEXT_PRIMARY),
    ]
    .spacing(8)
    .align_y(Alignment::Center);

    if let Some(topic) = header_topic {
        left_hdr = left_hdr
            .push(header_v_divider())
            .push(text(topic).size(12.5).color(aether_drift::TEXT_MUTED));
    }

    let mut right_hdr = row![].spacing(6).align_y(Alignment::Center);

    match update_state {
        UpdateCheckState::ReadyToRestart {
            version,
            staged_path,
        } => {
            right_hdr = right_hdr.push(
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
            right_hdr = right_hdr.push(
                button(text(format!("Nova {version}")).size(11))
                    .on_press(ShellMessage::OpenReleasePage(release_url.clone()))
                    .padding([4, 9])
                    .style(aether_drift::ghost_button_style),
            );
        }
        _ => {}
    }

    if state.active_panel == ActivePanel::Settings {
        right_hdr = right_hdr
            .push(
                button(text("Overlay").size(11.5))
                    .on_press(ShellMessage::TogglePanel(ActivePanel::Overlay))
                    .padding([4, 10])
                    .style(aether_drift::ghost_button_style),
            )
            .push(
                button(
                    row![
                        icons::logout(13.0, aether_drift::DANGER_RED),
                        text("Sair").size(11.5).color(aether_drift::DANGER_RED),
                    ]
                    .spacing(5)
                    .align_y(Alignment::Center),
                )
                .on_press(ShellMessage::Logout)
                .padding([4, 10])
                .style(aether_drift::ghost_button_style),
            );
    }

    // Ícones exatos da barra superior do Backspace Web: Sino, Lupa, Downloads/P2P, Divisor, Membros!
    let bell_color = if state.settings.desktop_notifications {
        aether_drift::TEXT_SECONDARY
    } else {
        aether_drift::TEXT_MUTED
    };
    let search_color = if state.chat.show_search {
        aether_drift::TEXT_PRIMARY
    } else {
        aether_drift::TEXT_SECONDARY
    };
    let p2p_color = if state.active_panel == ActivePanel::P2P {
        aether_drift::TEXT_PRIMARY
    } else {
        aether_drift::TEXT_SECONDARY
    };
    let members_color = if state.show_member_list {
        aether_drift::TEXT_PRIMARY
    } else {
        aether_drift::TEXT_MUTED
    };

    right_hdr = right_hdr
        .push(
            button(icons::bell(17.0, bell_color))
                .on_press(ShellMessage::Settings(
                    SettingsAction::ToggleDesktopNotifications,
                ))
                .padding(6)
                .style(aether_drift::icon_button_style(false)),
        )
        .push(
            button(icons::search(17.0, search_color))
                .on_press(ShellMessage::Chat(ChatMessageAction::ToggleSearch))
                .padding(6)
                .style(aether_drift::icon_button_style(state.chat.show_search)),
        )
        .push(
            button(icons::download_tray(17.0, p2p_color))
                .on_press(ShellMessage::TogglePanel(ActivePanel::P2P))
                .padding(6)
                .style(aether_drift::icon_button_style(
                    state.active_panel == ActivePanel::P2P,
                )),
        )
        .push(header_v_divider())
        .push(
            button(icons::users(18.0, members_color))
                .on_press(ShellMessage::ToggleMemberList)
                .padding(6)
                .style(aether_drift::icon_button_style(state.show_member_list)),
        );

    let top_bar = container(
        row![left_hdr, horizontal_space(), right_hdr].align_y(Alignment::Center),
    )
    .width(Length::Fill)
    .height(Length::Fixed(48.0))
    .padding([0, 16])
    .center_y(Length::Fixed(48.0))
    .style(aether_drift::header_bar_style);

    let center_content: Element<'a, ShellMessage> = match state.active_panel {
        ActivePanel::Dms => {
            if let Some(dm) = selected_dm {
                let label = dm.display_label(&state.user.id);
                let dm_id = dm.id.as_str();
                chat::view(
                    &state.chat,
                    dm_id,
                    &label,
                    true,
                    &state.user.id,
                    &state.instance_url,
                    &state.image_cache,
                    &author_colors,
                    &author_nicks,
                )
                .map(ShellMessage::Chat)
            } else {
                container(
                    column![
                        text("Mensagens Diretas")
                            .size(18)
                            .color(aether_drift::TEXT_PRIMARY),
                        text("Selecione uma conversa à esquerda ou clique em um membro para enviar mensagem.")
                            .size(13)
                            .color(aether_drift::TEXT_MUTED),
                    ]
                    .spacing(6),
                )
                .width(Length::Fill)
                .height(Length::Fill)
                .padding(24)
                .style(aether_drift::chat_canvas_style)
                .into()
            }
        }
        ActivePanel::Settings => container(
            settings::view(
                &state.settings,
                &state.instance_url,
                selected_group.map(|g| g.name.as_str()),
                selected_group.map(|g| g.roles.as_slice()).unwrap_or(&[]),
            )
            .map(ShellMessage::Settings),
        )
        .padding(18)
        .width(Length::Fill)
        .height(Length::Fill)
        .style(aether_drift::chat_canvas_style)
        .into(),
        ActivePanel::Overlay => container(overlay::view(&state.overlay).map(ShellMessage::Overlay))
            .padding(18)
            .width(Length::Fill)
            .height(Length::Fill)
            .style(aether_drift::chat_canvas_style)
            .into(),
        ActivePanel::P2P => container(p2p::view(&state.p2p).map(ShellMessage::P2P))
            .padding(18)
            .width(Length::Fill)
            .height(Length::Fill)
            .style(aether_drift::chat_canvas_style)
            .into(),
        ActivePanel::Stream => container(
            scrollable(stream::view(&state.stream).map(ShellMessage::Stream)).height(Length::Fill),
        )
        .padding(18)
        .width(Length::Fill)
        .height(Length::Fill)
        .style(aether_drift::chat_canvas_style)
        .into(),
        ActivePanel::Music => container(
            music::view_full_panel(&state.music, state.voice.connected_channel_name.as_deref())
                .map(ShellMessage::Music),
        )
        .padding(18)
        .width(Length::Fill)
        .height(Length::Fill)
        .style(aether_drift::chat_canvas_style)
        .into(),
        ActivePanel::Soundboard => {
            container(soundboard::view(&state.soundboard).map(ShellMessage::Soundboard))
                .padding(18)
                .width(Length::Fill)
                .height(Length::Fill)
                .style(aether_drift::chat_canvas_style)
                .into()
        }
        ActivePanel::Channel => {
            if let Some(ch) = selected_channel {
                if ch.kind == "voice" {
                    let participants = build_voice_participants(state, selected_group, &ch.id);
                    container(
                        voice::view(&state.voice, ch, participants).map(ShellMessage::Voice),
                    )
                    .padding(18)
                    .width(Length::Fill)
                    .height(Length::Fill)
                    .style(aether_drift::chat_canvas_style)
                    .into()
                } else {
                    chat::view(
                        &state.chat,
                        &ch.id,
                        &ch.name,
                        false,
                        &state.user.id,
                        &state.instance_url,
                        &state.image_cache,
                        &author_colors,
                        &author_nicks,
                    )
                    .map(ShellMessage::Chat)
                }
            } else {
                container(
                    column![
                        text("Selecione um canal à esquerda")
                            .size(17)
                            .color(aether_drift::TEXT_PRIMARY),
                        text(format!("Conectado em {}", state.instance_url))
                            .size(12)
                            .color(aether_drift::TEXT_MUTED),
                    ]
                    .spacing(6),
                )
                .width(Length::Fill)
                .height(Length::Fill)
                .padding(24)
                .style(aether_drift::chat_canvas_style)
                .into()
            }
        }
    };

    let body_row: Element<'a, ShellMessage> =
        if state.show_member_list && state.active_panel == ActivePanel::Channel {
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
        .height(Length::Fill)
        .style(aether_drift::chat_canvas_style);

    let base_layout: Element<'a, ShellMessage> = row![rail, channel_sidebar, main_area].into();

    // ── Camadas Flutuantes (`stack!`) — ZERO deslocamento de colunas! ────────
    let profile_overlay: Option<Element<'a, ShellMessage>> = state
        .selected_profile_user_id
        .as_deref()
        .and_then(|pid| {
            let group = selected_group?;
            let pm = group.members.iter().find(|m| m.user_id == pid)?;
            let right_offset = if state.show_member_list && state.active_panel == ActivePanel::Channel
            {
                252.0
            } else {
                18.0
            };
            let card = opaque(floating_profile_popout(state, group, pm));
            Some(
                container(
                    row![
                        horizontal_space(),
                        column![card, vertical_space()].height(Length::Fill),
                    ]
                    .width(Length::Fill),
                )
                .width(Length::Fill)
                .height(Length::Fill)
                .padding(Padding {
                    top: 60.0,
                    right: right_offset,
                    bottom: 0.0,
                    left: 0.0,
                })
                .into(),
            )
        });

    let conn_overlay: Option<Element<'a, ShellMessage>> = if state.voice.show_connection_info
        && (state.voice.connected_channel_id.is_some() || state.voice.loopback_active)
    {
        let pop = opaque(
            container(
                voice::view_connection_info(
                    &state.voice,
                    &state.stream,
                    state.p2p.survival_mode_active(),
                )
                .map(ShellMessage::Voice),
            )
            .width(Length::Fixed(304.0)),
        );
        Some(
            container(
                column![
                    vertical_space(),
                    row![pop, horizontal_space()].width(Length::Fill),
                ]
                .height(Length::Fill),
            )
            .width(Length::Fill)
            .height(Length::Fill)
            .padding(Padding {
                top: 0.0,
                right: 0.0,
                bottom: 196.0,
                left: 80.0,
            })
            .into(),
        )
    } else {
        None
    };

    let status_overlay: Option<Element<'a, ShellMessage>> = if state.status_picker_open {
        let picker = opaque(
            container(
                column![
                    status_option(PresenceStatus::Online),
                    status_option(PresenceStatus::Idle),
                    status_option(PresenceStatus::Dnd),
                    status_option(PresenceStatus::Invisible),
                ]
                .spacing(2),
            )
            .width(Length::Fixed(224.0))
            .padding(8)
            .style(aether_drift::glass_modal_style),
        );
        Some(
            container(
                column![
                    vertical_space(),
                    row![picker, horizontal_space()].width(Length::Fill),
                ]
                .height(Length::Fill),
            )
            .width(Length::Fill)
            .height(Length::Fill)
            .padding(Padding {
                top: 0.0,
                right: 0.0,
                bottom: 70.0,
                left: 80.0,
            })
            .into(),
        )
    } else {
        None
    };

    let mut stacked: Element<'a, ShellMessage> = base_layout;
    if let Some(ov) = conn_overlay {
        stacked = stack![stacked, ov].into();
    }
    if let Some(ov) = status_overlay {
        stacked = stack![stacked, ov].into();
    }
    if let Some(ov) = profile_overlay {
        stacked = stack![stacked, ov].into();
    }
    stacked
}

/// Constrói a bolha única flutuante `.glass-bubble` no rodapé da barra de canais contendo:
/// 1) Mini-cabeçalho do Bot de Música (quando em voz)
/// 2) `Voz conectada` + `• P2P` + `ms` + 4 botões escuros de 34px (`Câmera`, `Tela`, `AI Mic`, `Soundboard`)
/// 3) Área do Usuário (`Avatar` + `Display Name` + `@username` + `Mic` + `Fone` + `Engrenagem`)
fn build_unified_bottom_bubble<'a>(state: &'a ShellState) -> Element<'a, ShellMessage> {
    let in_voice = state.voice.connected_channel_id.is_some() || state.voice.loopback_active;
    let mut card_col = column![].spacing(0);

    if in_voice {
        // 1. Mini-cabeçalho do Bot de Música igual à screenshot (`Bot de Música` / `Aguardando Bot de Música` + `^`)
        let playing_track = state
            .music
            .state
            .current_track
            .as_ref()
            .filter(|t| !t.title.trim().is_empty());
        let music_title = playing_track
            .map(|t| t.title.as_str())
            .unwrap_or("Bot de Música");
        let music_sub = if playing_track.is_some() {
            if state.music.state.status == "paused" {
                "Pausado · Clique para controlar"
            } else {
                "Tocando agora no canal"
            }
        } else {
            "Aguardando Bot de Música"
        };
        let note_color = if playing_track.is_some() {
            aether_drift::SUCCESS_GREEN
        } else {
            aether_drift::TEXT_MUTED
        };

        let music_badge = container(icons::music(13.0, note_color))
            .width(Length::Fixed(26.0))
            .height(Length::Fixed(26.0))
            .center(Length::Fixed(26.0))
            .style(|_t| container::Style {
                background: Some(Background::Color(Color::from_rgba(1.0, 1.0, 1.0, 0.05))),
                border: Border {
                    radius: 7.0.into(),
                    ..Default::default()
                },
                ..Default::default()
            });

        let music_row = button(
            row![
                music_badge,
                column![
                    text(music_title)
                        .size(12)
                        .color(aether_drift::TEXT_PRIMARY),
                    text(music_sub)
                        .size(10)
                        .color(aether_drift::TEXT_MUTED),
                ]
                .spacing(1),
                horizontal_space(),
                icons::chevron_up(15.0, aether_drift::TEXT_MUTED),
            ]
            .spacing(8)
            .align_y(Alignment::Center),
        )
        .width(Length::Fill)
        .padding([8, 10])
        .on_press(ShellMessage::TogglePanel(ActivePanel::Music))
        .style(aether_drift::icon_button_style(
            state.active_panel == ActivePanel::Music,
        ));

        card_col = card_col.push(music_row).push(bubble_h_divider());

        // 2. Seção `VoiceControls` (`Voz conectada` + `• P2P` + `ms` + Desligar + 4 tiles de 34px)
        let ch_label = state
            .voice
            .connected_channel_name
            .as_deref()
            .unwrap_or("Teste de Microfone");

        let signal_box = container(icons::signal(16.0, aether_drift::SUCCESS_GREEN))
            .width(Length::Fixed(32.0))
            .height(Length::Fixed(32.0))
            .center(Length::Fixed(32.0))
            .style(|_t| container::Style {
                background: Some(Background::Color(Color::from_rgba(0.525, 0.937, 0.675, 0.16))),
                border: Border {
                    radius: 8.0.into(),
                    ..Default::default()
                },
                ..Default::default()
            });

        let mut badges_line = row![
            text("Voz conecta...")
                .size(12)
                .color(aether_drift::SUCCESS_GREEN),
        ]
        .spacing(4)
        .align_y(Alignment::Center);

        if state.p2p.p2p_enabled {
            badges_line = badges_line.push(
                container(
                    text("• P2P")
                        .size(9.5)
                        .color(aether_drift::SUCCESS_GREEN),
                )
                .padding([1, 5])
                .style(aether_drift::mint_pill_style),
            );
        }

        if let Some(ms) = state.voice.ping_ms {
            badges_line = badges_line.push(
                container(
                    text(format!("{ms} ms"))
                        .size(9.5)
                        .color(aether_drift::SUCCESS_GREEN),
                )
                .padding([1, 5])
                .style(aether_drift::mint_pill_style),
            );
        }

        let conn_trigger = button(
            row![
                signal_box,
                column![
                    badges_line,
                    text(ch_label)
                        .size(11)
                        .color(aether_drift::TEXT_MUTED),
                ]
                .spacing(1),
            ]
            .spacing(8)
            .align_y(Alignment::Center),
        )
        .padding([2, 2])
        .on_press(ShellMessage::Voice(VoiceAction::ToggleConnectionInfo))
        .style(aether_drift::icon_button_style(
            state.voice.show_connection_info,
        ));

        let voice_top = row![
            conn_trigger,
            horizontal_space(),
            button(icons::phone_off(17.0, aether_drift::TEXT_SECONDARY))
                .on_press(ShellMessage::Voice(VoiceAction::LeaveChannel))
                .padding(6)
                .style(aether_drift::icon_button_style(false)),
        ]
        .align_y(Alignment::Center);

        let tile_btn = |ic: iced::widget::svg::Svg<'a>, active: bool, msg: ShellMessage| {
            button(container(ic).center(Length::Fill))
                .width(Length::FillPortion(1))
                .height(Length::Fixed(34.0))
                .padding(0)
                .on_press(msg)
                .style(aether_drift::voice_tile_button_style(active))
        };

        let cam_color = if state.voice.camera_on {
            aether_drift::SUCCESS_GREEN
        } else {
            aether_drift::TEXT_SECONDARY
        };
        let stream_active = state.stream.sharing_active || state.active_panel == ActivePanel::Stream;
        let stream_color = if stream_active {
            aether_drift::SUCCESS_GREEN
        } else {
            aether_drift::TEXT_SECONDARY
        };
        let rn_color = if state.voice.rnnoise_enabled {
            aether_drift::SUCCESS_GREEN
        } else {
            aether_drift::TEXT_SECONDARY
        };
        let sb_active = state.active_panel == ActivePanel::Soundboard;
        let sb_color = if sb_active {
            aether_drift::SUCCESS_GREEN
        } else {
            aether_drift::TEXT_SECONDARY
        };

        let voice_tiles = row![
            tile_btn(
                if state.voice.camera_on {
                    icons::video(16.0, cam_color)
                } else {
                    icons::video_off(16.0, cam_color)
                },
                state.voice.camera_on,
                ShellMessage::Voice(VoiceAction::ToggleCamera),
            ),
            tile_btn(
                icons::monitor(16.0, stream_color),
                stream_active,
                ShellMessage::TogglePanel(ActivePanel::Stream),
            ),
            tile_btn(
                icons::ai_mic(16.0, rn_color),
                state.voice.rnnoise_enabled,
                ShellMessage::Voice(VoiceAction::ToggleRnnoise),
            ),
            tile_btn(
                icons::music(15.0, sb_color),
                sb_active,
                ShellMessage::TogglePanel(ActivePanel::Soundboard),
            ),
        ]
        .spacing(5);

        card_col = card_col
            .push(container(column![voice_top, voice_tiles].spacing(8)).padding([9, 10]))
            .push(bubble_h_divider());
    }

    // 3. Área do Usuário (`34px` avatar + dot + `Display Name` + `@username` + `Mic` + `Fone` + `Settings`)
    let user_av = avatar_with_status(
        &state.image_cache,
        state.user.avatar_url.as_deref(),
        state.user.label(),
        34.0,
        status_color(state.presence),
    );

    let user_row = container(
        row![
            button(
                row![
                    user_av,
                    column![
                        text(state.user.label())
                            .size(13)
                            .color(aether_drift::TEXT_PRIMARY),
                        text(format!("@{}", state.user.username))
                            .size(10.5)
                            .color(aether_drift::TEXT_MUTED),
                    ]
                    .spacing(0),
                ]
                .spacing(8)
                .align_y(Alignment::Center),
            )
            .on_press(ShellMessage::ToggleStatusPicker)
            .padding([3, 4])
            .style(aether_drift::icon_button_style(state.status_picker_open)),
            horizontal_space(),
            button(if state.voice.muted {
                icons::mic_off(16.0, aether_drift::DANGER_RED)
            } else {
                icons::mic(16.0, aether_drift::TEXT_SECONDARY)
            })
            .on_press(ShellMessage::Voice(VoiceAction::ToggleMute))
            .padding(5)
            .style(aether_drift::icon_button_style(state.voice.muted)),
            button(if state.voice.deafened {
                icons::headphones_off(16.0, aether_drift::DANGER_RED)
            } else {
                icons::headphones(16.0, aether_drift::TEXT_SECONDARY)
            })
            .on_press(ShellMessage::Voice(VoiceAction::ToggleDeafen))
            .padding(5)
            .style(aether_drift::icon_button_style(state.voice.deafened)),
            button(icons::settings(16.0, aether_drift::TEXT_SECONDARY))
                .on_press(ShellMessage::TogglePanel(ActivePanel::Settings))
                .padding(5)
                .style(aether_drift::icon_button_style(
                    state.active_panel == ActivePanel::Settings,
                )),
        ]
        .spacing(2)
        .align_y(Alignment::Center),
    )
    .width(Length::Fill)
    .height(Length::Fixed(52.0))
    .padding([0, 8])
    .center_y(Length::Fixed(52.0));

    card_col = card_col.push(user_row);

    container(card_col)
        .width(Length::Fill)
        .style(aether_drift::glass_bubble_style)
        .into()
}

/// Popout flutuante `UserProfilePopout.tsx` (`Amanda` na screenshot):
/// Banner 88px, Avatar circular 72px, `Apelido neste grupo`, Display Name, `@username`,
/// `CARGOS`, `MEMBRO DESDE`, `{n} grupos em comum` e botão `Enviar mensagem`.
fn floating_profile_popout<'a>(
    state: &'a ShellState,
    group: &'a GroupSummary,
    pm: &'a GroupMember,
) -> Element<'a, ShellMessage> {
    let banner_accent = resolve_member_color(group, pm);

    let banner_bg: Element<'a, ShellMessage> = if let Some(handle) = pm
        .user
        .banner_url
        .as_deref()
        .and_then(|u| state.image_cache.get(u))
    {
        container(
            image(handle.clone())
                .width(Length::Fill)
                .height(Length::Fixed(92.0))
                .content_fit(ContentFit::Cover),
        )
        .width(Length::Fill)
        .height(Length::Fixed(92.0))
        .clip(true)
        .into()
    } else {
        container(text(""))
            .width(Length::Fill)
            .height(Length::Fixed(84.0))
            .style(move |_t| container::Style {
                background: Some(Background::Color(Color::from_rgba(
                    banner_accent.r,
                    banner_accent.g,
                    banner_accent.b,
                    0.32,
                ))),
                ..Default::default()
            })
            .into()
    };

    let close_overlay = container(
        row![
            horizontal_space(),
            button(icons::close(13.0, Color::WHITE))
                .on_press(ShellMessage::CloseProfile)
                .padding(5)
                .style(|_t, _s| button::Style {
                    background: Some(Background::Color(Color::from_rgba(0.0, 0.0, 0.0, 0.45))),
                    text_color: Color::WHITE,
                    border: Border {
                        radius: 12.0.into(),
                        ..Default::default()
                    },
                    ..Default::default()
                }),
        ]
        .padding(8),
    )
    .width(Length::Fill);

    let banner = stack![banner_bg, close_overlay];

    let presence = PresenceStatus::from_api_str(pm.user.status.as_deref());
    let av = avatar_with_status(
        &state.image_cache,
        pm.user.avatar_url.as_deref(),
        pm.display_name(),
        68.0,
        status_color(presence),
    );

    let mut body = column![av].spacing(8).padding(16);

    // Se tiver apelido no grupo diferente do Display Name global, mostra igual à screenshot:
    // "Apelido neste grupo: Batman" -> "Amanda" -> "@amanda"
    let global_name = pm.user.label();
    let has_distinct_nick = pm
        .nickname
        .as_deref()
        .map(str::trim)
        .is_some_and(|n| !n.is_empty() && n != global_name);

    let mut identity_col = column![].spacing(2);
    if let Some(nick) = pm.nickname.as_deref().filter(|_| has_distinct_nick) {
        identity_col = identity_col.push(
            text(format!("Apelido neste grupo: {}", nick.trim()))
                .size(12)
                .color(aether_drift::TEXT_SECONDARY),
        );
    }
    identity_col = identity_col
        .push(
            text(global_name)
                .size(17)
                .color(aether_drift::TEXT_PRIMARY),
        )
        .push(
            text(format!("@{}", pm.user.username))
                .size(12.5)
                .color(aether_drift::TEXT_MUTED),
        );

    if let Some(cs) = pm
        .user
        .custom_status
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        identity_col = identity_col.push(
            text(cs)
                .size(12)
                .color(aether_drift::TEXT_MESSAGE),
        );
    }

    body = body.push(identity_col);

    if let Some(bio) = pm.user.bio.as_deref().filter(|b| !b.trim().is_empty()) {
        body = body.push(bubble_h_divider()).push(
            column![
                text("SOBRE MIM")
                    .size(10)
                    .color(aether_drift::TEXT_MUTED),
                text(bio).size(12).color(aether_drift::TEXT_MESSAGE),
            ]
            .spacing(4),
        );
    }

    if !pm.roles.is_empty() {
        let mut sorted_roles = pm.roles.clone();
        sorted_roles.sort_by(|a, b| b.position.cmp(&a.position));
        let mut roles_col = column![
            text("CARGOS")
                .size(10)
                .color(aether_drift::TEXT_MUTED),
        ]
        .spacing(6);

        for chunk in sorted_roles.chunks(2) {
            let mut rrow = row![].spacing(6);
            for r in chunk {
                let rc = r
                    .color
                    .as_deref()
                    .and_then(parse_hex_color)
                    .unwrap_or(aether_drift::SUCCESS_GREEN);
                let rdot = container(text(""))
                    .width(Length::Fixed(8.0))
                    .height(Length::Fixed(8.0))
                    .style(move |_t| container::Style {
                        background: Some(Background::Color(rc)),
                        border: Border {
                            radius: 4.0.into(),
                            ..Default::default()
                        },
                        ..Default::default()
                    });
                rrow = rrow.push(
                    container(
                        row![
                            rdot,
                            text(r.name.clone())
                                .size(11.5)
                                .color(aether_drift::TEXT_PRIMARY),
                        ]
                        .spacing(6)
                        .align_y(Alignment::Center),
                    )
                    .padding([4, 9])
                    .style(|_t| container::Style {
                        background: Some(Background::Color(Color::from_rgba(1.0, 1.0, 1.0, 0.05))),
                        border: Border {
                            color: Color::from_rgba(1.0, 1.0, 1.0, 0.08),
                            width: 1.0,
                            radius: 6.0.into(),
                        },
                        ..Default::default()
                    }),
                );
            }
            roles_col = roles_col.push(rrow);
        }

        body = body.push(bubble_h_divider()).push(roles_col);
    }

    // MEMBRO DESDE + grupos em comum
    let joined_ts = pm.joined_at.or(pm.user.created_at);
    let mutual_count = state
        .groups
        .iter()
        .filter(|g| g.members.iter().any(|m| m.user_id == pm.user_id))
        .count()
        .max(1);
    let mutual_label = if mutual_count == 1 {
        "1 grupo em comum".to_string()
    } else {
        format!("{mutual_count} grupos em comum")
    };

    let mut meta_col = column![].spacing(4);
    if let Some(ms) = joined_ts {
        meta_col = meta_col.push(
            row![
                text("MEMBRO DESDE")
                    .size(10)
                    .color(aether_drift::TEXT_MUTED),
                text(format_date_pt_ms(ms))
                    .size(11.5)
                    .color(aether_drift::TEXT_PRIMARY),
            ]
            .spacing(8)
            .align_y(Alignment::Center),
        );
    }
    meta_col = meta_col.push(
        text(mutual_label)
            .size(11.5)
            .color(aether_drift::TEXT_MUTED),
    );
    body = body.push(bubble_h_divider()).push(meta_col);

    if pm.user_id != state.user.id {
        body = body.push(
            button(
                container(
                    text("Enviar mensagem")
                        .size(13)
                        .color(aether_drift::TEXT_PRIMARY),
                )
                .width(Length::Fill)
                .center_x(Length::Fill),
            )
            .width(Length::Fill)
            .padding([9, 12])
            .on_press(ShellMessage::StartDmWithUser(pm.user_id.clone()))
            .style(aether_drift::ghost_button_style),
        );
    }

    container(column![banner, body])
        .width(Length::Fixed(324.0))
        .clip(true)
        .style(aether_drift::glass_modal_style)
        .into()
}

/// Agrupamento oficial 1:1 com `packages/web/src/utils/memberGroups.ts`:
/// 1) Dono (`owner_title` ou `"DONO"`)
/// 2) Cargos dos membros online (ordenados por `position` descendente)
/// 3) Online sem cargo (`ONLINE`)
/// 4) Offline (`OFFLINE`)
fn member_list_sidebar<'a>(
    state: &'a ShellState,
    group: &'a GroupSummary,
) -> Element<'a, ShellMessage> {
    let mut list = column![].spacing(2).padding([12, 10]);

    if group.members.is_empty() {
        list = list.push(
            text("Carregando membros...")
                .size(12)
                .color(aether_drift::TEXT_MUTED),
        );
    } else {
        let owner_id = group.owner_id.as_deref();
        let mut owners_online: Vec<&GroupMember> = Vec::new();
        let mut role_buckets: Vec<(&RoleSummary, Vec<&GroupMember>)> = Vec::new();
        let mut online_no_role: Vec<&GroupMember> = Vec::new();
        let mut offline: Vec<&GroupMember> = Vec::new();

        let mut sorted_roles: Vec<&RoleSummary> = group.roles.iter().collect();
        sorted_roles.sort_by(|a, b| b.position.cmp(&a.position));
        for r in &sorted_roles {
            role_buckets.push((r, Vec::new()));
        }

        for m in &group.members {
            if !m.is_online() {
                offline.push(m);
                continue;
            }
            if owner_id == Some(m.user_id.as_str()) {
                owners_online.push(m);
                continue;
            }
            if let Some(top) = m.top_role() {
                if let Some((_, bucket)) = role_buckets.iter_mut().find(|(r, _)| r.id == top.id) {
                    bucket.push(m);
                    continue;
                }
                if let Some(first_role) = sorted_roles.iter().find(|r| r.id == top.id) {
                    role_buckets.push((first_role, vec![m]));
                    continue;
                }
            }
            online_no_role.push(m);
        }

        let sort_alpha = |v: &mut Vec<&GroupMember>| {
            v.sort_by(|a, b| {
                a.display_name()
                    .to_ascii_lowercase()
                    .cmp(&b.display_name().to_ascii_lowercase())
            });
        };
        sort_alpha(&mut owners_online);
        for (_, b) in &mut role_buckets {
            sort_alpha(b);
        }
        sort_alpha(&mut online_no_role);
        sort_alpha(&mut offline);

        let mut first_section = true;

        if !owners_online.is_empty() {
            let owner_header = group
                .owner_title
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("DONO");
            list = list.push(member_group_header(
                &format!("{owner_header} — {}", owners_online.len()),
                first_section,
            ));
            first_section = false;
            for m in owners_online {
                list = list.push(member_row(&state.image_cache, group, m, true));
            }
        }

        for (role, members) in role_buckets {
            if members.is_empty() {
                continue;
            }
            list = list.push(member_group_header(
                &format!("{} — {}", role.name.to_uppercase(), members.len()),
                first_section,
            ));
            first_section = false;
            for m in members {
                list = list.push(member_row(&state.image_cache, group, m, true));
            }
        }

        if !online_no_role.is_empty() {
            list = list.push(member_group_header(
                &format!("ONLINE — {}", online_no_role.len()),
                first_section,
            ));
            first_section = false;
            for m in online_no_role {
                list = list.push(member_row(&state.image_cache, group, m, true));
            }
        }

        if !offline.is_empty() {
            list = list.push(member_group_header(
                &format!("OFFLINE — {}", offline.len()),
                first_section,
            ));
            for m in offline {
                list = list.push(member_row(&state.image_cache, group, m, false));
            }
        }
    }

    container(scrollable(list).height(Length::Fill))
        .width(Length::Fixed(240.0))
        .height(Length::Fill)
        .style(aether_drift::sidebar_style)
        .into()
}

fn member_group_header<'a>(label: &str, first: bool) -> Element<'a, ShellMessage> {
    container(
        text(label.to_string())
            .size(11)
            .color(aether_drift::TEXT_CATEGORY),
    )
    .padding(Padding {
        top: if first { 2.0 } else { 14.0 },
        right: 6.0,
        bottom: 4.0,
        left: 6.0,
    })
    .into()
}

fn member_row<'a>(
    cache: &'a HashMap<String, image::Handle>,
    group: &'a GroupSummary,
    m: &'a GroupMember,
    online: bool,
) -> Element<'a, ShellMessage> {
    let name = m.display_name();
    let presence = PresenceStatus::from_api_str(m.user.status.as_deref());
    let dot_col = if online {
        status_color(presence)
    } else {
        aether_drift::STATUS_OFFLINE
    };
    let av = if online {
        avatar_with_status(cache, m.user.avatar_url.as_deref(), name, 32.0, dot_col)
    } else {
        avatar_circle(cache, m.user.avatar_url.as_deref(), name, 32.0)
    };

    let base_color = resolve_member_color(group, m);
    let name_color = if online {
        base_color
    } else {
        dim_color(base_color, 0.52)
    };

    let mut text_col = column![text(name).size(13.5).color(name_color)].spacing(0);
    if online {
        if let Some(cs) = m
            .user
            .custom_status
            .as_deref()
            .filter(|s| !s.trim().is_empty())
        {
            text_col = text_col.push(text(cs).size(10.5).color(aether_drift::TEXT_MUTED));
        }
    }

    button(
        row![av, text_col]
            .spacing(10)
            .align_y(Alignment::Center),
    )
    .width(Length::Fill)
    .padding([5, 6])
    .on_press(ShellMessage::OpenProfile(m.user_id.clone()))
    .style(aether_drift::channel_row_button_style(false))
    .into()
}

fn channel_row<'a>(state: &'a ShellState, ch: &'a ChannelSummary) -> Element<'a, ShellMessage> {
    let selected = state.active_panel == ActivePanel::Channel
        && state.selected_channel_id.as_deref() == Some(ch.id.as_str());
    let voice_connected_here =
        ch.kind == "voice" && state.voice.connected_channel_id.as_deref() == Some(ch.id.as_str());
    let unread = state.unread_counts.get(&ch.id).copied().unwrap_or(0);

    let show_bar = selected || voice_connected_here;
    let icon_color = if selected || voice_connected_here || unread > 0 {
        aether_drift::TEXT_SECONDARY
    } else {
        aether_drift::TEXT_MUTED
    };
    let label_color = if selected || voice_connected_here || unread > 0 {
        aether_drift::TEXT_PRIMARY
    } else {
        aether_drift::TEXT_MUTED
    };

    let ch_icon: Element<'a, ShellMessage> = if ch.kind == "voice" {
        icons::volume(15.0, icon_color).into()
    } else {
        icons::hash(16.0, icon_color).into()
    };

    let mut row_content = row![
        left_active_bar(show_bar),
        ch_icon,
        text(&ch.name).size(14).color(label_color),
    ]
    .spacing(7)
    .align_y(Alignment::Center);

    if unread > 0 && !selected {
        row_content = row_content.push(horizontal_space()).push(
            container(text(""))
                .width(Length::Fixed(7.0))
                .height(Length::Fixed(7.0))
                .style(|_t| container::Style {
                    background: Some(Background::Color(aether_drift::ACCENT_ROSE)),
                    border: Border {
                        radius: 3.5.into(),
                        ..Default::default()
                    },
                    ..Default::default()
                }),
        );
    } else if voice_connected_here {
        row_content = row_content.push(horizontal_space()).push(
            text("ao vivo")
                .size(10)
                .color(aether_drift::TEXT_MUTED),
        );
    }

    button(row_content)
        .width(Length::Fill)
        .height(Length::Fixed(32.0))
        .padding([0, 6])
        .on_press(ShellMessage::SelectChannel(ch.id.clone()))
        .style(aether_drift::channel_row_button_style(selected))
        .into()
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
            text(display)
                .size(12.5)
                .color(aether_drift::TEXT_SECONDARY),
            horizontal_space(),
        ]
        .spacing(8)
        .align_y(Alignment::Center);

        if let Some(ms) = media {
            if ms.is_muted {
                r = r.push(icons::mic_off(12.0, aether_drift::DANGER_RED));
            }
            if ms.is_deafened {
                r = r.push(icons::headphones_off(12.0, aether_drift::DANGER_RED));
            }
            if ms.is_screen_sharing {
                r = r.push(icons::monitor(12.0, aether_drift::SUCCESS_GREEN));
            }
        }

        rows.push(
            container(
                button(r)
                    .width(Length::Fill)
                    .padding([3, 6])
                    .on_press(ShellMessage::OpenProfile(uid.clone()))
                    .style(aether_drift::channel_row_button_style(false)),
            )
            .padding(Padding {
                top: 0.0,
                right: 2.0,
                bottom: 0.0,
                left: 24.0,
            })
            .into(),
        );
    }
    rows
}

fn build_voice_participants<'a>(
    state: &'a ShellState,
    group: Option<&'a GroupSummary>,
    channel_id: &str,
) -> Vec<VoiceParticipantCard<'a>> {
    let mut cards = Vec::new();
    let mut seen_self = false;

    if let Some(user_ids) = state.voice_states.get(channel_id) {
        for uid in user_ids {
            let is_self = uid == &state.user.id;
            if is_self {
                seen_self = true;
            }
            let member = group.and_then(|g| g.members.iter().find(|m| m.user_id == *uid));
            let (display_name, avatar_url) = if let Some(m) = member {
                (m.display_name().to_string(), m.user.avatar_url.as_deref())
            } else if is_self {
                (
                    state.user.label().to_string(),
                    state.user.avatar_url.as_deref(),
                )
            } else {
                (uid.clone(), None)
            };
            let media = state.voice_user_states.get(uid);
            cards.push(VoiceParticipantCard {
                user_id: uid.as_str(),
                display_name,
                avatar: avatar_url.and_then(|u| state.image_cache.get(u)).cloned(),
                is_muted: if is_self {
                    state.voice.muted
                } else {
                    media.is_some_and(|m| m.is_muted)
                },
                is_deafened: if is_self {
                    state.voice.deafened
                } else {
                    media.is_some_and(|m| m.is_deafened)
                },
                is_screen_sharing: media.is_some_and(|m| m.is_screen_sharing),
                is_self,
            });
        }
    }

    if !seen_self && state.voice.connected_channel_id.as_deref() == Some(channel_id) {
        cards.push(VoiceParticipantCard {
            user_id: state.user.id.as_str(),
            display_name: state.user.label().to_string(),
            avatar: state
                .user
                .avatar_url
                .as_deref()
                .and_then(|u| state.image_cache.get(u))
                .cloned(),
            is_muted: state.voice.muted,
            is_deafened: state.voice.deafened,
            is_screen_sharing: state.stream.sharing_active,
            is_self: true,
        });
    }

    cards
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
        let font_sz = (size * 0.38).clamp(9.0, 18.0);
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

fn avatar_with_status<'a>(
    cache: &'a HashMap<String, image::Handle>,
    avatar_url: Option<&'a str>,
    label: &str,
    size: f32,
    dot_color: Color,
) -> Element<'a, ShellMessage> {
    let base = avatar_circle(cache, avatar_url, label, size);
    let dot_sz = (size * 0.30).clamp(10.0, 16.0);
    let dot_r = dot_sz * 0.5;
    let dot = container(text(""))
        .width(Length::Fixed(dot_sz))
        .height(Length::Fixed(dot_sz))
        .style(move |_t| container::Style {
            background: Some(Background::Color(dot_color)),
            border: Border {
                color: aether_drift::SURFACE,
                width: 2.0,
                radius: dot_r.into(),
            },
            ..Default::default()
        });
    let badge_layer = container(
        column![
            vertical_space(),
            row![horizontal_space(), dot].width(Length::Fill),
        ]
        .height(Length::Fill),
    )
    .width(Length::Fixed(size))
    .height(Length::Fixed(size));

    stack![base, badge_layer].into()
}

fn rail_left_pill<'a>(active: bool) -> Element<'a, ShellMessage> {
    container(text(""))
        .width(Length::Fixed(3.0))
        .height(Length::Fixed(if active { 32.0 } else { 0.0 }))
        .style(|_t| container::Style {
            background: Some(Background::Color(Color::WHITE)),
            border: Border {
                radius: 2.0.into(),
                ..Default::default()
            },
            ..Default::default()
        })
        .into()
}

fn left_active_bar<'a>(active: bool) -> Element<'a, ShellMessage> {
    container(text(""))
        .width(Length::Fixed(3.0))
        .height(Length::Fixed(if active { 16.0 } else { 0.0 }))
        .style(move |_t| container::Style {
            background: Some(Background::Color(if active {
                Color::WHITE
            } else {
                Color::TRANSPARENT
            })),
            border: Border {
                radius: 1.5.into(),
                ..Default::default()
            },
            ..Default::default()
        })
        .into()
}

fn rail_divider<'a>() -> Element<'a, ShellMessage> {
    container(text(""))
        .width(Length::Fixed(32.0))
        .height(Length::Fixed(1.0))
        .style(|_t| container::Style {
            background: Some(Background::Color(Color::from_rgba(1.0, 1.0, 1.0, 0.08))),
            ..Default::default()
        })
        .into()
}

fn rail_mint_action_row<'a>(
    svg_icon: iced::widget::svg::Svg<'a>,
    msg: ShellMessage,
) -> Element<'a, ShellMessage> {
    let btn = button(container(svg_icon).center(Length::Fill))
        .width(Length::Fixed(40.0))
        .height(Length::Fixed(40.0))
        .padding(0)
        .on_press(msg)
        .style(aether_drift::rail_action_button_style);

    row![
        rail_left_pill(false),
        container(btn).width(Length::Fill).center_x(Length::Fill),
    ]
    .width(Length::Fixed(72.0))
    .align_y(Alignment::Center)
    .into()
}

fn bubble_h_divider<'a>() -> Element<'a, ShellMessage> {
    container(text(""))
        .width(Length::Fill)
        .height(Length::Fixed(1.0))
        .style(|_t| container::Style {
            background: Some(Background::Color(Color::from_rgba(1.0, 1.0, 1.0, 0.06))),
            ..Default::default()
        })
        .into()
}

fn header_v_divider<'a>() -> Element<'a, ShellMessage> {
    container(text(""))
        .width(Length::Fixed(1.0))
        .height(Length::Fixed(18.0))
        .style(|_t| container::Style {
            background: Some(Background::Color(aether_drift::BORDER_SOFT)),
            ..Default::default()
        })
        .into()
}

fn status_option<'a>(status: PresenceStatus) -> Element<'a, ShellMessage> {
    let dot = container(text(""))
        .width(Length::Fixed(9.0))
        .height(Length::Fixed(9.0))
        .style(move |_t| container::Style {
            background: Some(Background::Color(status_color(status))),
            border: Border {
                radius: 4.5.into(),
                ..Default::default()
            },
            ..Default::default()
        });
    button(
        row![
            dot,
            text(status.label_pt())
                .size(12.5)
                .color(aether_drift::TEXT_PRIMARY),
        ]
        .spacing(8)
        .align_y(Alignment::Center),
    )
    .width(Length::Fill)
    .padding([6, 8])
    .on_press(ShellMessage::SetStatus(status))
    .style(aether_drift::channel_row_button_style(false))
    .into()
}
