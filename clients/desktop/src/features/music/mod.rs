use iced::widget::{
    button, column, container, horizontal_space, row, scrollable, slider, text, text_input,
};
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
    CycleLoop,
    VolumeChanged(u32),
    RemoveTrack(usize),
    ClearQueue,
    OpenFullPanel,
    Refresh,
}

fn format_duration(secs: Option<u32>) -> String {
    match secs {
        Some(s) if s > 0 => format!("{}:{:02}", s / 60, s % 60),
        _ => String::new(),
    }
}

fn loop_label(mode: &str) -> &'static str {
    match mode {
        "track" => "Loop: Faixa",
        "queue" => "Loop: Fila",
        _ => "Loop: Off",
    }
}

/// Mini-player limpo acoplado acima dos controles da call (sem clutter de % de Vote-Skip).
#[allow(dead_code)]
pub fn view_mini_player<'a>(
    state: &'a MusicUiState,
    channel_name: &'a str,
) -> Element<'a, MusicAction> {
    let title = state
        .state
        .current_track
        .as_ref()
        .map(|t| t.title.as_str())
        .filter(|t| !t.is_empty())
        .unwrap_or("Nenhuma faixa tocando");

    let is_playing = state.state.status == "playing";
    let status_lbl = if is_playing {
        format!("Tocando · {channel_name}")
    } else if state.state.status == "paused" {
        format!("Pausado · {channel_name}")
    } else {
        format!("Bot de Música · {channel_name}")
    };

    let controls = row![
        button(text(if is_playing { "Pausar" } else { "Tocar" }).size(11))
            .on_press_maybe((!state.busy).then_some(MusicAction::TogglePlayPause))
            .padding([3, 7])
            .style(aether_drift::primary_button_style),
        button(text("Pular").size(11))
            .on_press_maybe((!state.busy).then_some(MusicAction::VoteSkip))
            .padding([3, 7])
            .style(aether_drift::ghost_button_style),
        button(text("Parar").size(11))
            .on_press_maybe((!state.busy).then_some(MusicAction::Stop))
            .padding([3, 7])
            .style(aether_drift::ghost_button_style),
        horizontal_space(),
        button(text(format!("Fila ({})", state.state.queue.len())).size(11))
            .on_press(MusicAction::OpenFullPanel)
            .padding([3, 7])
            .style(aether_drift::ghost_button_style),
    ]
    .spacing(4)
    .align_y(Alignment::Center);

    let mut content = column![
        text(status_lbl).size(10).color(aether_drift::TEXT_MUTED),
        text(title).size(12),
        controls,
    ]
    .spacing(5);

    if let Some(err) = &state.error {
        content = content.push(text(err).size(10).color(aether_drift::DANGER_RED));
    }

    container(content)
        .width(Length::Fill)
        .padding(10)
        .style(aether_drift::card_style)
        .into()
}

/// Painel completo de Música (1:1 com o Web): Tocando Agora, Busca/URL, Volume, Loop e Fila completa.
pub fn view_full_panel<'a>(
    state: &'a MusicUiState,
    connected_channel_name: Option<&'a str>,
) -> Element<'a, MusicAction> {
    let is_playing = state.state.status == "playing";
    let ch_label = connected_channel_name.unwrap_or("Entre em um canal de voz");

    let header = row![
        column![
            text("Bot de Música").size(18),
            text(format!("Canal alvo: {ch_label}"))
                .size(12)
                .color(aether_drift::TEXT_MUTED),
        ]
        .spacing(2),
        horizontal_space(),
        button(text(if state.busy { "..." } else { "Atualizar" }).size(12))
            .on_press_maybe(
                (connected_channel_name.is_some() && !state.busy).then_some(MusicAction::Refresh)
            )
            .padding([6, 12])
            .style(aether_drift::ghost_button_style),
    ]
    .align_y(Alignment::Center);

    let (now_title, now_sub) = match &state.state.current_track {
        Some(track) if !track.title.is_empty() => {
            let dur = format_duration(track.duration_seconds);
            let req = track.requested_by.as_deref().unwrap_or("Participante");
            let sub = if dur.is_empty() {
                format!("Pedido por {req}")
            } else {
                format!("Pedido por {req} · {dur}")
            };
            (track.title.as_str(), sub)
        }
        _ => (
            "Nenhuma música tocando no momento",
            "Adicione um link ou nome da música abaixo para iniciar a fila.".to_string(),
        ),
    };

    let listeners = state.state.listener_count.max(1);
    let pct = state.state.vote_skip_percent.clamp(1, 100);
    let needed = ((listeners * pct).div_ceil(100)).max(1);
    let votes = state.state.skip_votes.len();

    let can_act = connected_channel_name.is_some() && !state.busy;

    let transport = row![
        button(text(if is_playing { "Pausar" } else { "Tocar / Retomar" }).size(12))
            .on_press_maybe(can_act.then_some(MusicAction::TogglePlayPause))
            .padding([7, 14])
            .style(aether_drift::primary_button_style),
        button(text(format!("Vote-Skip ({votes}/{needed})")).size(12))
            .on_press_maybe(can_act.then_some(MusicAction::VoteSkip))
            .padding([7, 12])
            .style(aether_drift::ghost_button_style),
        button(text(loop_label(&state.state.loop_mode)).size(12))
            .on_press_maybe(can_act.then_some(MusicAction::CycleLoop))
            .padding([7, 12])
            .style(aether_drift::ghost_button_style),
        button(text("Parar").size(12))
            .on_press_maybe(can_act.then_some(MusicAction::Stop))
            .padding([7, 12])
            .style(aether_drift::ghost_button_style),
    ]
    .spacing(8)
    .align_y(Alignment::Center);

    let vol_row = row![
        text(format!("Volume do Bot: {}%", state.state.volume))
            .size(12)
            .color(aether_drift::TEXT_MUTED),
        slider(0..=100, state.state.volume, MusicAction::VolumeChanged).step(5_u32),
    ]
    .spacing(12)
    .align_y(Alignment::Center);

    let now_card = container(
        column![
            text(if is_playing { "TOCANDO AGORA" } else { "PLAYER" })
                .size(10)
                .color(aether_drift::ACCENT_VIOLET),
            text(now_title).size(16),
            text(now_sub).size(12).color(aether_drift::TEXT_MUTED),
            transport,
            vol_row,
        ]
        .spacing(10),
    )
    .width(Length::Fill)
    .padding(16)
    .style(aether_drift::card_style);

    let add_bar = row![
        text_input(
            "Cole um link (YouTube, SoundCloud...) ou digite o nome da música...",
            &state.track_url_input,
        )
        .on_input(MusicAction::UrlInputChanged)
        .on_submit(MusicAction::AddToQueue)
        .padding(10)
        .style(aether_drift::input_style),
        button(text("Adicionar à Fila").size(12))
            .on_press_maybe(
                (can_act && !state.track_url_input.trim().is_empty())
                    .then_some(MusicAction::AddToQueue)
            )
            .padding([10, 16])
            .style(aether_drift::primary_button_style),
    ]
    .spacing(8)
    .align_y(Alignment::Center);

    let mut queue_col = column![
        row![
            text(format!("Próximas na Fila ({})", state.state.queue.len())).size(14),
            horizontal_space(),
            button(text("Limpar Fila").size(11))
                .on_press_maybe(
                    (can_act && !state.state.queue.is_empty()).then_some(MusicAction::ClearQueue)
                )
                .padding([4, 10])
                .style(aether_drift::ghost_button_style),
        ]
        .align_y(Alignment::Center),
    ]
    .spacing(8);

    if state.state.queue.is_empty() {
        queue_col = queue_col.push(
            text("A fila está vazia.")
                .size(12)
                .color(aether_drift::TEXT_MUTED),
        );
    } else {
        for (idx, track) in state.state.queue.iter().enumerate() {
            let dur = format_duration(track.duration_seconds);
            let req = track.requested_by.as_deref().unwrap_or("Participante");
            let meta = if dur.is_empty() {
                format!("Pedido por {req}")
            } else {
                format!("Pedido por {req} · {dur}")
            };
            queue_col = queue_col.push(
                container(
                    row![
                        text(format!("{}.", idx + 1))
                            .size(12)
                            .color(aether_drift::TEXT_MUTED),
                        column![
                            text(&track.title).size(13),
                            text(meta).size(11).color(aether_drift::TEXT_MUTED),
                        ]
                        .spacing(1),
                        horizontal_space(),
                        button(text("Remover").size(11))
                            .on_press_maybe(can_act.then_some(MusicAction::RemoveTrack(idx)))
                            .padding([4, 8])
                            .style(aether_drift::ghost_button_style),
                    ]
                    .spacing(10)
                    .align_y(Alignment::Center),
                )
                .width(Length::Fill)
                .padding([8, 10])
                .style(aether_drift::pill_style),
            );
        }
    }

    let queue_card = container(queue_col)
        .width(Length::Fill)
        .padding(16)
        .style(aether_drift::card_style);

    let mut root = column![header, now_card, add_bar, queue_card].spacing(12);
    if let Some(err) = &state.error {
        root = root.push(text(err).size(12).color(aether_drift::DANGER_RED));
    }

    scrollable(root).height(Length::Fill).into()
}
