use iced::widget::{
    button, column, container, horizontal_space, image, pick_list, row, scrollable, slider, text,
};
use iced::{Alignment, Background, Border, Color, ContentFit, Element, Length};
use std::collections::HashMap;

use crate::core::audio_policy::{resolve_opus_policy, EffectiveOpusConfig, OpusMode, OpusOverride};
use crate::core::models::ChannelSummary;
use crate::media::audio_engine;
use crate::ui::{aether_drift, icons};

#[derive(Debug, Clone)]
pub struct VoiceParticipantCard<'a> {
    pub user_id: &'a str,
    pub display_name: String,
    pub avatar: Option<image::Handle>,
    pub is_muted: bool,
    pub is_deafened: bool,
    pub is_screen_sharing: bool,
    pub is_self: bool,
}

#[derive(Debug, Clone)]
pub struct VoiceState {
    pub connected_channel_id: Option<String>,
    pub connected_channel_name: Option<String>,
    pub livekit_url: Option<String>,
    pub connecting: bool,
    pub muted: bool,
    pub deafened: bool,
    pub camera_on: bool,
    pub rnnoise_enabled: bool,
    pub loopback_active: bool,
    pub loopback_sample_rate: Option<u32>,
    pub mic_gain_pct: f32,
    pub vad_threshold_db: f32,
    /// `0` = Automático (adaptativo estilo Mumble/NetEQ); >0 = override manual no Solucionador.
    pub jitter_buffer_ms: u32,
    pub show_audio_settings: bool,
    pub show_troubleshooting: bool,
    pub opus_music_mode: bool,
    pub opus_stereo: bool,
    pub opus_bitrate_kbps: u32,
    pub input_devices: Vec<String>,
    pub output_devices: Vec<String>,
    pub selected_input: Option<String>,
    pub selected_output: Option<String>,
    pub user_volumes: HashMap<String, u32>,
    pub error: Option<String>,
}

impl Default for VoiceState {
    fn default() -> Self {
        let inputs = audio_engine::list_input_devices();
        let outputs = audio_engine::list_output_devices();
        let selected_input = inputs.first().cloned();
        let selected_output = outputs.first().cloned();
        Self {
            connected_channel_id: None,
            connected_channel_name: None,
            livekit_url: None,
            connecting: false,
            muted: false,
            deafened: false,
            camera_on: false,
            rnnoise_enabled: true,
            loopback_active: false,
            loopback_sample_rate: None,
            mic_gain_pct: 100.0,
            vad_threshold_db: -48.0,
            jitter_buffer_ms: 0,
            show_audio_settings: false,
            show_troubleshooting: false,
            opus_music_mode: false,
            opus_stereo: false,
            opus_bitrate_kbps: 96,
            input_devices: inputs,
            output_devices: outputs,
            selected_input,
            selected_output,
            user_volumes: HashMap::new(),
            error: None,
        }
    }
}

impl VoiceState {
    pub fn effective_opus(&self) -> EffectiveOpusConfig {
        let user_override = OpusOverride {
            bitrate_kbps: Some(self.opus_bitrate_kbps),
            mode: Some(if self.opus_music_mode {
                OpusMode::Music
            } else {
                OpusMode::Voice
            }),
            stereo: Some(self.opus_stereo),
        };
        resolve_opus_policy(256, &[&user_override])
    }
}

#[derive(Debug, Clone)]
pub enum VoiceAction {
    JoinChannel { channel_id: String, name: String },
    LeaveChannel,
    ToggleMute,
    ToggleDeafen,
    ToggleCamera,
    ToggleRnnoise,
    ToggleLoopback,
    ToggleAudioSettings,
    OpenStreamPanel,
    OpenSoundboardPanel,
    OpenMusicPanel,
    UserVolumeChanged { user_id: String, volume_pct: u32 },
    RefreshDevices,
    SelectInput(String),
    SelectOutput(String),
    MicGainChanged(f32),
    VadThresholdChanged(f32),
    JitterBufferChanged(u32),
    ToggleTroubleshooting,
    ToggleOpusMode,
    ToggleOpusStereo,
    OpusBitrateChanged(u32),
}

fn initials(name: &str) -> String {
    let mut out = String::new();
    for w in name.split_whitespace().take(2) {
        if let Some(ch) = w.chars().next() {
            out.push(ch.to_ascii_uppercase());
        }
    }
    if out.is_empty() {
        "U".to_string()
    } else {
        out
    }
}

/// Palco de Voz 1:1 com Discord/Backspace: Grade de Participantes + Barra Inferior de Controles.
pub fn view<'a>(
    state: &'a VoiceState,
    channel: &'a ChannelSummary,
    participants: Vec<VoiceParticipantCard<'a>>,
) -> Element<'a, VoiceAction> {
    let is_here = state.connected_channel_id.as_deref() == Some(channel.id.as_str());
    let eff = state.effective_opus();

    let count = participants.len();
    let subtitle = if is_here {
        format!(
            "Conectado · {} {} · LiveKit",
            count,
            if count == 1 { "participante" } else { "participantes" }
        )
    } else if count > 0 {
        format!(
            "{} {} na chamada",
            count,
            if count == 1 { "pessoa" } else { "pessoas" }
        )
    } else {
        "Canal de voz vazio — clique abaixo para entrar".to_string()
    };

    let header = row![
        column![
            text(&channel.name).size(18),
            text(subtitle).size(12).color(if is_here {
                aether_drift::SUCCESS_GREEN
            } else {
                aether_drift::TEXT_MUTED
            }),
        ]
        .spacing(2),
        horizontal_space(),
        button(
            text(if state.show_audio_settings {
                "Voltar ao Palco"
            } else {
                "Ajustes de Áudio"
            })
            .size(12),
        )
        .on_press(VoiceAction::ToggleAudioSettings)
        .padding([6, 12])
        .style(if state.show_audio_settings {
            aether_drift::primary_button_style
        } else {
            aether_drift::ghost_button_style
        }),
    ]
    .spacing(12)
    .align_y(Alignment::Center);

    let stage_body: Element<'a, VoiceAction> = if state.show_audio_settings {
        audio_settings_drawer(state, &eff)
    } else if participants.is_empty() {
        container(
            column![
                icons::volume(40.0, aether_drift::TEXT_MUTED),
                text(&channel.name).size(20),
                text("Ninguém está neste canal de voz ainda.")
                    .size(13)
                    .color(aether_drift::TEXT_MUTED),
                button(
                    text(if state.connecting {
                        "Conectando..."
                    } else {
                        "Entrar no Canal de Voz"
                    })
                    .size(14),
                )
                .on_press_maybe((!state.connecting).then(|| VoiceAction::JoinChannel {
                    channel_id: channel.id.clone(),
                    name: channel.name.clone(),
                }))
                .padding([10, 22])
                .style(aether_drift::primary_button_style),
            ]
            .spacing(12)
            .align_x(Alignment::Center),
        )
        .width(Length::Fill)
        .height(Length::Fill)
        .center(Length::Fill)
        .into()
    } else {
        let mut grid = column![].spacing(14).align_x(Alignment::Center);
        for chunk in participants.chunks(3) {
            let mut r = row![].spacing(14).align_y(Alignment::Center);
            for p in chunk {
                r = r.push(participant_tile(state, p));
            }
            grid = grid.push(r);
        }
        scrollable(
            container(grid)
                .width(Length::Fill)
                .padding([12, 0])
                .center_x(Length::Fill),
        )
        .height(Length::Fill)
        .into()
    };

    // Barra inferior centralizada estilo Discord/Backspace (`VoiceControlBar`)
    let call_cta = if is_here {
        button(
            row![
                icons::phone_off(15.0, Color::WHITE),
                text("Desconectar").size(12).color(Color::WHITE),
            ]
            .spacing(6)
            .align_y(Alignment::Center),
        )
        .on_press(VoiceAction::LeaveChannel)
        .padding([8, 14])
        .style(|_t, status| {
            let bg = match status {
                button::Status::Hovered => Color::from_rgb(0.86, 0.20, 0.24),
                _ => aether_drift::DANGER_RED,
            };
            button::Style {
                background: Some(Background::Color(bg)),
                text_color: Color::WHITE,
                border: Border {
                    radius: 10.0.into(),
                    ..Default::default()
                },
                ..Default::default()
            }
        })
    } else {
        button(
            text(if state.connecting {
                "Conectando..."
            } else {
                "Entrar na Call"
            })
            .size(12),
        )
        .on_press_maybe((!state.connecting).then(|| VoiceAction::JoinChannel {
            channel_id: channel.id.clone(),
            name: channel.name.clone(),
        }))
        .padding([8, 16])
        .style(aether_drift::primary_button_style)
    };

    let control_bar = container(
        row![
            button(if state.muted {
                icons::mic_off(17.0, aether_drift::DANGER_RED)
            } else {
                icons::mic(17.0, aether_drift::TEXT_PRIMARY)
            })
            .on_press(VoiceAction::ToggleMute)
            .padding(9)
            .style(aether_drift::icon_button_style(state.muted)),
            button(icons::headphones(
                17.0,
                if state.deafened {
                    aether_drift::DANGER_RED
                } else {
                    aether_drift::TEXT_PRIMARY
                },
            ))
            .on_press(VoiceAction::ToggleDeafen)
            .padding(9)
            .style(aether_drift::icon_button_style(state.deafened)),
            button(if state.camera_on {
                icons::video(17.0, aether_drift::SUCCESS_GREEN)
            } else {
                icons::video_off(17.0, aether_drift::TEXT_PRIMARY)
            })
            .on_press(VoiceAction::ToggleCamera)
            .padding(9)
            .style(aether_drift::icon_button_style(state.camera_on)),
            button(icons::monitor(17.0, aether_drift::TEXT_PRIMARY))
                .on_press(VoiceAction::OpenStreamPanel)
                .padding(9)
                .style(aether_drift::icon_button_style(false)),
            button(icons::music(17.0, aether_drift::TEXT_PRIMARY))
                .on_press(VoiceAction::OpenMusicPanel)
                .padding(9)
                .style(aether_drift::icon_button_style(false)),
            button(text("Soundboard").size(12))
                .on_press(VoiceAction::OpenSoundboardPanel)
                .padding([8, 12])
                .style(aether_drift::ghost_button_style),
            call_cta,
        ]
        .spacing(8)
        .align_y(Alignment::Center),
    )
    .padding([8, 14])
    .style(aether_drift::card_style);

    let mut root = column![
        header,
        container(stage_body)
            .width(Length::Fill)
            .height(Length::Fill),
        container(control_bar)
            .width(Length::Fill)
            .center_x(Length::Fill),
    ]
    .spacing(12)
    .height(Length::Fill);

    if let Some(err) = &state.error {
        root = root.push(text(err).size(12).color(aether_drift::DANGER_RED));
    }

    root.into()
}

fn participant_tile<'a>(
    state: &'a VoiceState,
    p: &VoiceParticipantCard<'a>,
) -> Element<'a, VoiceAction> {
    let avatar: Element<'a, VoiceAction> = if let Some(handle) = &p.avatar {
        container(
            image(handle.clone())
                .width(Length::Fixed(58.0))
                .height(Length::Fixed(58.0))
                .content_fit(ContentFit::Cover),
        )
        .width(Length::Fixed(58.0))
        .height(Length::Fixed(58.0))
        .clip(true)
        .style(|_t| container::Style {
            border: Border {
                color: aether_drift::ACCENT_VIOLET,
                width: 2.0,
                radius: 29.0.into(),
            },
            ..Default::default()
        })
        .into()
    } else {
        container(
            text(initials(&p.display_name))
                .size(20)
                .color(Color::WHITE),
        )
        .width(Length::Fixed(58.0))
        .height(Length::Fixed(58.0))
        .center(Length::Fixed(58.0))
        .style(|_t| container::Style {
            background: Some(Background::Color(aether_drift::SURFACE_ELEVATED)),
            border: Border {
                color: aether_drift::ACCENT_VIOLET,
                width: 2.0,
                radius: 29.0.into(),
            },
            ..Default::default()
        })
        .into()
    };

    let mut badges = row![].spacing(6).align_y(Alignment::Center);
    if p.is_muted {
        badges = badges.push(icons::mic_off(13.0, aether_drift::DANGER_RED));
    }
    if p.is_deafened {
        badges = badges.push(icons::headphones(13.0, aether_drift::DANGER_RED));
    }
    if p.is_screen_sharing {
        badges = badges.push(icons::monitor(13.0, aether_drift::SUCCESS_GREEN));
    }

    let mut tile_col = column![
        avatar,
        row![text(p.display_name.clone()).size(13), badges]
            .spacing(6)
            .align_y(Alignment::Center),
    ]
    .spacing(8)
    .align_x(Alignment::Center);

    if !p.is_self {
        let vol = state.user_volumes.get(p.user_id).copied().unwrap_or(100);
        let uid = p.user_id.to_string();
        tile_col = tile_col.push(
            row![
                text(format!("{vol}%"))
                    .size(10)
                    .color(aether_drift::TEXT_MUTED),
                slider(0..=200, vol, move |v| VoiceAction::UserVolumeChanged {
                    user_id: uid.clone(),
                    volume_pct: v,
                })
                .step(5_u32),
            ]
            .spacing(6)
            .align_y(Alignment::Center),
        );
    }

    container(tile_col)
        .width(Length::Fixed(220.0))
        .padding(16)
        .center_x(Length::Fixed(220.0))
        .style(aether_drift::card_style)
        .into()
}

fn audio_settings_drawer<'a>(
    state: &'a VoiceState,
    eff: &EffectiveOpusConfig,
) -> Element<'a, VoiceAction> {
    let quick_controls = row![
        toggle_btn(
            if state.rnnoise_enabled {
                "RNNoise: Ligado"
            } else {
                "RNNoise: Desligado"
            },
            state.rnnoise_enabled,
            VoiceAction::ToggleRnnoise
        ),
        toggle_btn(
            if state.loopback_active {
                "Parar Teste de Mic"
            } else {
                "Testar Microfone (Loopback)"
            },
            state.loopback_active,
            VoiceAction::ToggleLoopback
        ),
    ]
    .spacing(8);

    let devices_card = container(
        column![
            row![
                text("Dispositivos Nativos (WASAPI / PipeWire)").size(14),
                horizontal_space(),
                button(text("Recarregar").size(11))
                    .on_press(VoiceAction::RefreshDevices)
                    .padding([4, 10])
                    .style(aether_drift::ghost_button_style),
            ]
            .align_y(Alignment::Center),
            row![
                column![
                    text("Entrada (Microfone)")
                        .size(12)
                        .color(aether_drift::TEXT_MUTED),
                    pick_list(
                        state.input_devices.as_slice(),
                        state.selected_input.as_ref(),
                        VoiceAction::SelectInput
                    )
                    .width(Length::Fill),
                ]
                .spacing(4)
                .width(Length::FillPortion(1)),
                column![
                    text("Saída (Fone / Caixa)")
                        .size(12)
                        .color(aether_drift::TEXT_MUTED),
                    pick_list(
                        state.output_devices.as_slice(),
                        state.selected_output.as_ref(),
                        VoiceAction::SelectOutput
                    )
                    .width(Length::Fill),
                ]
                .spacing(4)
                .width(Length::FillPortion(1)),
            ]
            .spacing(12),
            row![
                column![
                    text(format!("Ganho do Microfone: {:.0}%", state.mic_gain_pct))
                        .size(12)
                        .color(aether_drift::TEXT_MUTED),
                    slider(0.0..=200.0, state.mic_gain_pct, VoiceAction::MicGainChanged)
                        .step(5.0_f32),
                ]
                .spacing(4)
                .width(Length::FillPortion(1)),
                column![
                    text(format!("Gate VAD: {:.0} dBFS", state.vad_threshold_db))
                        .size(12)
                        .color(aether_drift::TEXT_MUTED),
                    slider(
                        -80.0..=-10.0,
                        state.vad_threshold_db,
                        VoiceAction::VadThresholdChanged
                    )
                    .step(1.0_f32),
                ]
                .spacing(4)
                .width(Length::FillPortion(1)),
            ]
            .spacing(12),
        ]
        .spacing(12),
    )
    .width(Length::Fill)
    .padding(16)
    .style(aether_drift::card_style);

    let buffer_summary = if state.jitter_buffer_ms == 0 {
        "Automático (adaptativo)"
    } else {
        "Manual (override)"
    };

    let mut troubleshooting_col = column![row![
        column![
            text("Solucionador de problemas (Avançado)").size(14),
            text(format!(
                "Buffer: {buffer_summary} · Opus: {} kbps ({}, {})",
                eff.bitrate_kbps,
                if eff.mode == OpusMode::Music {
                    "Música"
                } else {
                    "Voz"
                },
                if eff.stereo { "Estéreo" } else { "Mono" }
            ))
            .size(12)
            .color(aether_drift::TEXT_MUTED),
        ]
        .spacing(2),
        horizontal_space(),
        button(
            text(if state.show_troubleshooting {
                "Ocultar"
            } else {
                "Abrir ajustes"
            })
            .size(12),
        )
        .on_press(VoiceAction::ToggleTroubleshooting)
        .padding([6, 12])
        .style(aether_drift::ghost_button_style),
    ]
    .align_y(Alignment::Center)]
    .spacing(12);

    if state.show_troubleshooting {
        let jitter_presets = row![
            preset_btn("Automático", 0, state.jitter_buffer_ms),
            preset_btn("40ms", 40, state.jitter_buffer_ms),
            preset_btn("80ms", 80, state.jitter_buffer_ms),
            preset_btn("120ms", 120, state.jitter_buffer_ms),
            preset_btn("500ms", 500, state.jitter_buffer_ms),
            preset_btn("1000ms", 1000, state.jitter_buffer_ms),
        ]
        .spacing(6);

        troubleshooting_col = troubleshooting_col
            .push(
                text("Deixe em Automático para uso normal. Só ajuste abaixo se sua rede estiver com micro-cortes ou jitter alto.")
                    .size(12)
                    .color(aether_drift::TEXT_MUTED),
            )
            .push(
                row![
                    toggle_btn(
                        if state.opus_music_mode { "Modo: Música" } else { "Modo: Voz" },
                        state.opus_music_mode,
                        VoiceAction::ToggleOpusMode
                    ),
                    toggle_btn(
                        if state.opus_stereo { "Estéreo: Sim" } else { "Mono" },
                        state.opus_stereo,
                        VoiceAction::ToggleOpusStereo
                    ),
                ]
                .spacing(10)
                .align_y(Alignment::Center),
            )
            .push(
                column![
                    text(format!("Bitrate Opus alvo: {} kbps", state.opus_bitrate_kbps))
                        .size(12)
                        .color(aether_drift::TEXT_MUTED),
                    slider(16..=256, state.opus_bitrate_kbps, VoiceAction::OpusBitrateChanged)
                        .step(8_u32),
                ]
                .spacing(4),
            )
            .push(
                column![
                    text(if state.jitter_buffer_ms == 0 {
                        "Jitter Buffer: Automático (adaptativo)".to_string()
                    } else {
                        format!("Jitter Buffer manual: {} ms", state.jitter_buffer_ms)
                    })
                    .size(12)
                    .color(aether_drift::TEXT_MUTED),
                    jitter_presets,
                    slider(0..=2000, state.jitter_buffer_ms, VoiceAction::JitterBufferChanged)
                        .step(20_u32),
                ]
                .spacing(6),
            );
    }

    let opus_card = container(troubleshooting_col)
        .width(Length::Fill)
        .padding(16)
        .style(aether_drift::card_style);

    let telemetry_text = match state.loopback_sample_rate {
        Some(sr) => format!(
            "Pipeline Lock-Free ATIVO ({sr} Hz · RNNoise {} · Suspensão ociosa pronta)",
            if state.rnnoise_enabled { "ON" } else { "OFF" }
        ),
        None => "Pipeline ocioso (DAC liberado · 0% CPU — Suspensão Ociosa ativa)".to_string(),
    };

    scrollable(
        column![
            quick_controls,
            container(text(telemetry_text).size(12).color(aether_drift::TEXT_MUTED))
                .padding([8, 12])
                .style(aether_drift::pill_style),
            devices_card,
            opus_card,
        ]
        .spacing(12),
    )
    .height(Length::Fill)
    .into()
}

fn toggle_btn<'a>(label: &'a str, active: bool, msg: VoiceAction) -> Element<'a, VoiceAction> {
    let style = if active {
        aether_drift::primary_button_style
    } else {
        aether_drift::ghost_button_style
    };
    button(text(label).size(12))
        .on_press(msg)
        .padding([7, 12])
        .style(style)
        .into()
}

fn preset_btn<'a>(label: &'a str, value: u32, current: u32) -> Element<'a, VoiceAction> {
    let style = if value == current {
        aether_drift::primary_button_style
    } else {
        aether_drift::ghost_button_style
    };
    button(text(label).size(11))
        .on_press(VoiceAction::JitterBufferChanged(value))
        .padding([4, 8])
        .style(style)
        .into()
}
