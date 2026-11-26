use iced::widget::{button, column, container, horizontal_space, row, scrollable, text};
use iced::{Alignment, Element, Length};

use crate::core::models::{AuthUser, GroupSummary};
use crate::os::updater::UpdateCheckState;
use crate::ui::aether_drift;

#[derive(Debug, Clone)]
pub struct ShellState {
    pub instance_url: String,
    pub user: AuthUser,
    pub groups: Vec<GroupSummary>,
    pub selected_group_id: Option<String>,
    pub selected_channel_id: Option<String>,
    pub loading_groups: bool,
    pub error: Option<String>,
}

impl ShellState {
    pub fn new(instance_url: String, user: AuthUser) -> Self {
        Self {
            instance_url,
            user,
            groups: Vec::new(),
            selected_group_id: None,
            selected_channel_id: None,
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
    OpenReleasePage(String),
    Logout,
}

pub fn view<'a>(
    state: &'a ShellState,
    update_state: &'a UpdateCheckState,
) -> Element<'a, ShellMessage> {
    let mut group_list = column![text("GRUPOS").size(11).color(aether_drift::TEXT_MUTED)].spacing(6);

    if state.loading_groups {
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
            for ch in &group.channels {
                let prefix = if ch.kind == "voice" { "🔊 " } else { "# " };
                let active = state.selected_channel_id.as_deref() == Some(ch.id.as_str());
                let style = if active {
                    aether_drift::primary_button_style
                } else {
                    aether_drift::ghost_button_style
                };
                channel_list = channel_list.push(
                    button(text(format!("{prefix}{}", ch.name)).size(13))
                        .width(Length::Fill)
                        .padding([7, 10])
                        .on_press(ShellMessage::SelectChannel(ch.id.clone()))
                        .style(style),
                );
            }
        }
    }

    let sidebar = container(
        column![
            scrollable(group_list).height(Length::FillPortion(1)),
            scrollable(channel_list).height(Length::FillPortion(2)),
            container(
                row![
                    column![
                        text(state.user.label()).size(13),
                        text(format!("@{}", state.user.username))
                            .size(11)
                            .color(aether_drift::TEXT_MUTED),
                    ]
                    .spacing(2),
                    horizontal_space(),
                    button(text("Sair").size(12))
                        .on_press(ShellMessage::Logout)
                        .padding([6, 10])
                        .style(aether_drift::ghost_button_style),
                ]
                .align_y(Alignment::Center)
            )
            .padding(10)
            .style(aether_drift::card_style),
        ]
        .spacing(12),
    )
    .width(Length::Fixed(260.0))
    .height(Length::Fill)
    .padding(14)
    .style(aether_drift::sidebar_style);

    let mut top_bar = row![
        text(
            selected_group
                .map(|g| g.name.as_str())
                .unwrap_or("Balacopapo Desktop")
        )
        .size(16),
        container(
            text("Modo Baixa Interrupção · Zero WebView")
                .size(11)
                .color(aether_drift::SUCCESS_GREEN),
        )
        .padding([4, 10])
        .style(aether_drift::pill_style),
        horizontal_space(),
        button(text("Atualizar").size(12))
            .on_press(ShellMessage::RefreshGroups)
            .padding([6, 12])
            .style(aether_drift::ghost_button_style),
    ]
    .spacing(10)
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

    let mut body = column![
        top_bar,
        container(
            column![
                text("Núcleo 100% Nativo em Rust Ativo").size(18),
                text(format!("Instância conectada: {}", state.instance_url))
                    .size(13)
                    .color(aether_drift::TEXT_MUTED),
                text(
                    "Marco 1 concluído: UI acelerada por wgpu (0% GPU quando parada), \
                     zero WebView, parser balacopapo://, 23 permissões e política Opus 5 níveis."
                )
                .size(13)
                .color(aether_drift::TEXT_MUTED),
                text("Próximos marcos: Chat Virtualizado (Marco 2) → Voz Nível Mumble + Soundboard (Marco 3).")
                    .size(13)
                    .color(aether_drift::ACCENT_VIOLET),
            ]
            .spacing(10)
        )
        .width(Length::Fill)
        .padding(22)
        .style(aether_drift::card_style),
    ]
    .spacing(16);

    if let Some(err) = &state.error {
        body = body.push(text(err).size(12).color(aether_drift::DANGER_RED));
    }

    let main_area = container(body)
        .width(Length::Fill)
        .height(Length::Fill)
        .padding(20);

    row![sidebar, main_area].into()
}
