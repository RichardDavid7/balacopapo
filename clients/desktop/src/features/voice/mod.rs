use iced::widget::{button, column, container, horizontal_space, pick_list, row, slider, text};
use iced::{Alignment, Element, Length};

use crate::core::audio_policy::{resolve_opus_policy, EffectiveOpusConfig, OpusMode, OpusOverride};
use crate::core::models::ChannelSummary;
use crate::media::audio_engine;
use crate::ui::aether_drift;

#[derive(Debug, Clone)]
pub struct VoiceState {
    pub connected_channel_id: Option<String>,
    pub connected_channel_name: Option<String>,
    pub livekit_url: Option<String>,
    pub connecting: bool,
    pub muted: bool,
    pub deafened: bool,
    pub rnnoise_enabled: bool,
    pub loopback_active: bool,
    pub loopback_sample_rate: Option<u32>,
    pub mic_gain_pct: f32,
    pub vad_threshold_db: f32,
    /// `0` = Automático (adaptativo estilo Mumble/NetEQ); >0 = override manual no Solucionador.
    pub jitter_buffer_ms: u32,
    pub show_troubleshooting: bool,
    pub opus_music_mode: bool,
    pub opus_stereo: bool,
    pub opus_bitrate_kbps: u32,
    pub input_devices: Vec<String>,
    pub output_devices: Vec<String>,
    pub selected_input: Option<String>,
    pub selected_output: Option<String>,
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
            rnnoise_enabled: true,
            loopback_active: false,
            loopback_sample_rate: None,
            mic_gain_pct: 100.0,
            vad_threshold_db: -48.0,
            jitter_buffer_ms: 0,
            show_troubleshooting: false,
            opus_music_mode: false,
            opus_stereo: false,
            opus_bitrate_kbps: 96,
            input_devices: inputs,
            output_devices: outputs,
            selected_input,
            selected_output,
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
    ToggleRnnoise,
    ToggleLoopback,
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

pub fn view<'a>(state: &'a VoiceState, channel: &'a ChannelSummary) -> Element<'a, VoiceAction> {
    let is_here = state.connected_channel_id.as_deref() == Some(channel.id.as_str());
    let eff = state.effective_opus();

    let action_btn = if is_here {
        button(text("Desconectar da Call").size(13))
            .on_press(VoiceAction::LeaveChannel)
            .padding([9, 16])
            .style(aether_drift::ghost_button_style)
    } else {
        button(
            text(if state.connecting {
                "Conectando..."
            } else {
                "Entrar no Canal de Voz"
            })
            .size(13),
        )
        .on_press_maybe((!state.connecting).then(|| VoiceAction::JoinChannel {
            channel_id: channel.id.clone(),
            name: channel.name.clone(),
        }))
        .padding([9, 16])
        .style(aether_drift::primary_button_style)
    };

    let header = row![
        column![
            text(&channel.name).size(18),
            text(if is_here {
                format!(
                    "Conectado · LiveKit: {}",
                    state.livekit_url.as_deref().unwrap_or("instância")
                )
            } else {
                "Motor Nativo Lock-Free (WASAPI/PipeWire + RNNoise + Opus)".to_string()
            })
            .size(12)
            .color(if is_here {
                aether_drift::SUCCESS_GREEN
            } else {
                aether_drift::TEXT_MUTED
            }),
        ]
        .spacing(2),
        horizontal_space(),
        action_btn,
    ]
    .spacing(12)
    .align_y(Alignment::Center);

    let quick_controls = row![
        toggle_btn(
            if state.muted { "Microfone Mutado" } else { "Microfone Ativo" },
            state.muted,
            VoiceAction::ToggleMute
        ),
        toggle_btn(
            if state.deafened { "Áudio Ensurdecido" } else { "Áudio Ativo" },
            state.deafened,
            VoiceAction::ToggleDeafen
        ),
        toggle_btn(
            if state.rnnoise_enabled { "RNNoise: Ligado" } else { "RNNoise: Desligado" },
            state.rnnoise_enabled,
            VoiceAction::ToggleRnnoise
        ),
        toggle_btn(
            if state.loopback_active { "Parar Teste de Mic" } else { "Testar Microfone (Loopback)" },
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
                    text("Entrada (Microfone)").size(12).color(aether_drift::TEXT_MUTED),
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
                    text("Saída (Fone / Caixa)").size(12).color(aether_drift::TEXT_MUTED),
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
                    slider(-80.0..=-10.0, state.vad_threshold_db, VoiceAction::VadThresholdChanged)
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
                if eff.mode == OpusMode::Music { "Música" } else { "Voz" },
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

    let mut root = column![
        header,
        quick_controls,
        container(text(telemetry_text).size(12).color(aether_drift::TEXT_MUTED))
            .padding([8, 12])
            .style(aether_drift::pill_style),
        devices_card,
        opus_card,
    ]
    .spacing(12);

    if let Some(err) = &state.error {
        root = root.push(text(err).size(12).color(aether_drift::DANGER_RED));
    }

    root.into()
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
