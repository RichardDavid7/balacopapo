#![allow(dead_code)]

use iced::widget::{button, column, container, horizontal_space, row, scrollable, text, text_input};
use iced::{Alignment, Element, Length};

use crate::core::models::DmChannelSummary;
use crate::ui::aether_drift;

#[derive(Debug, Clone, Default)]
pub struct DmState {
    pub channels: Vec<DmChannelSummary>,
    pub loading: bool,
    pub search: String,
    pub selected_dm_id: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub enum DmAction {
    Refresh,
    SearchChanged(String),
    SelectDm(String),
}

pub fn view<'a>(state: &'a DmState, my_user_id: &'a str) -> Element<'a, DmAction> {
    let header = row![
        column![
            text("Mensagens Diretas & Grupos Diretos").size(18),
            text("Conversas 1:1 e Grupos Diretos sincronizados com a sua instância")
                .size(12)
                .color(aether_drift::TEXT_MUTED),
        ]
        .spacing(2),
        horizontal_space(),
        button(text(if state.loading { "..." } else { "Recarregar" }).size(12))
            .on_press_maybe((!state.loading).then_some(DmAction::Refresh))
            .padding([6, 12])
            .style(aether_drift::ghost_button_style),
    ]
    .align_y(Alignment::Center);

    let search = text_input("Filtrar DMs ou Grupos Diretos...", &state.search)
        .on_input(DmAction::SearchChanged)
        .padding(9)
        .style(aether_drift::input_style);

    let query = state.search.trim().to_ascii_lowercase();
    let mut list = column![].spacing(6);

    if state.channels.is_empty() {
        list = list.push(
            text("Nenhuma conversa direta carregada ainda.")
                .size(13)
                .color(aether_drift::TEXT_MUTED),
        );
    } else {
        for dm in &state.channels {
            let label = dm.display_label(my_user_id);
            if !query.is_empty() && !label.to_ascii_lowercase().contains(&query) {
                continue;
            }
            let badge = if dm.is_group_dm() {
                "Grupo Direto"
            } else {
                "DM"
            };
            let active = state.selected_dm_id.as_deref() == Some(dm.id.as_str());
            let style = if active {
                aether_drift::primary_button_style
            } else {
                aether_drift::ghost_button_style
            };
            list = list.push(
                button(
                    row![
                        text(label).size(13),
                        horizontal_space(),
                        text(badge).size(11).color(aether_drift::TEXT_MUTED),
                    ]
                    .align_y(Alignment::Center),
                )
                .width(Length::Fill)
                .padding([9, 12])
                .on_press(DmAction::SelectDm(dm.id.clone()))
                .style(style),
            );
        }
    }

    let mut root = column![
        header,
        search,
        scrollable(list).height(Length::Fill),
    ]
    .spacing(12);

    if let Some(err) = &state.error {
        root = root.push(text(err).size(12).color(aether_drift::DANGER_RED));
    }

    container(root).width(Length::Fill).height(Length::Fill).into()
}
