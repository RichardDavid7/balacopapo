use iced::widget::{button, column, container, horizontal_space, row, text, text_input};
use iced::{Alignment, Element, Length};

use crate::core::models::MusicChannelState;
use crate::ui::aether_drift;

#[derive(Debug, Clone, Default)]
pub struct MusicUiState {
    pub state: MusicChannelState,
    pub track_url_input: String,
    pub busy: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub enum MusicAction {
    UrlInputChanged(String),
    AddToQueue,
    TogglePlayPause,
    VoteSkip,
    Stop,
    Refresh,
}

/// Mini-player enxuto (sem poluição de configurações — Vote-Skip % fica nas Configurações do Grupo).
pub fn view_mini_player<'a>(
    ui: &'a MusicUiState,
    voice_channel_name: &'a str,
) -> Element<'a, MusicAction> {
    let now_playing = ui
        .state
        .current_track
        .as_ref()
        .map(|t| {
            if t.title.trim().is_empty() {
                t.url.as_str()
            } else {
                t.title.as_str()
            }
        })
        .unwrap_or("Nada tocando");

    let is_playing = ui.state.status == "playing";

    let controls = row![
        button(text(if is_playing { "⏸" } else { "▶" }).size(12))
            .on_press(MusicAction::TogglePlayPause)
            .padding([4, 9])
            .style(aether_drift::primary_button_style),
        button(text("⏭ Vote-Skip").size(11))
            .on_press(MusicAction::VoteSkip)
            .padding([4, 9])
            .style(aether_drift::ghost_button_style),
        button(text("⏹").size(12))
            .on_press(MusicAction::Stop)
            .padding([4, 8])
            .style(aether_drift::ghost_button_style),
        horizontal_space(),
        button(text("↻").size(11))
            .on_press(MusicAction::Refresh)
            .padding([4, 7])
            .style(aether_drift::ghost_button_style),
    ]
    .spacing(6)
    .align_y(Alignment::Center);

    let add_row = row![
        text_input("Colar link (YouTube / Navidrome)...", &ui.track_url_input)
            .on_input(MusicAction::UrlInputChanged)
            .on_submit(MusicAction::AddToQueue)
            .padding(6)
            .style(aether_drift::input_style),
        button(text("+").size(12))
            .on_press_maybe(
                (!ui.busy && !ui.track_url_input.trim().is_empty())
                    .then_some(MusicAction::AddToQueue)
            )
            .padding([6, 10])
            .style(aether_drift::primary_button_style),
    ]
    .spacing(6);

    let mut col = column![
        text(format!("🎵 Música · {voice_channel_name}"))
            .size(11)
            .color(aether_drift::ACCENT_VIOLET),
        text(now_playing).size(12),
        controls,
        add_row,
    ]
    .spacing(6);

    if !ui.state.queue.is_empty() {
        col = col.push(
            text(format!("Na fila: {} faixa(s)", ui.state.queue.len()))
                .size(11)
                .color(aether_drift::TEXT_MUTED),
        );
    }
    if let Some(err) = &ui.error {
        col = col.push(text(err).size(11).color(aether_drift::DANGER_RED));
    }

    container(col)
        .width(Length::Fill)
        .padding(10)
        .style(aether_drift::card_style)
        .into()
}
