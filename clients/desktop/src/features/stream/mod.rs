use iced::widget::{button, canvas, column, container, horizontal_space, row, slider, text};
use iced::{Alignment, Color, Element, Length, Point, Rectangle, Renderer, Size, Theme};

use crate::core::stream_pointer::{compute_video_content_box, StreamPointerMessage, ZoomPanViewport};
use crate::media::screen_share::{
    compute_dynamic_stream_bitrate_kbps, window_audio_backend_label, AudioScope, StreamPreset,
};
use crate::os::remote_control::{remote_input_backend_label, RemoteControlState, PANIC_HOTKEY};
use crate::ui::aether_drift;

#[derive(Debug, Clone)]
pub struct ActivePointerPing {
    pub sender: String,
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone)]
pub struct StreamState {
    pub sharing_active: bool,
    pub fullscreen_focus: bool,
    pub hide_non_video: bool,
    pub pointer_mode: bool,
    pub audio_scope: AudioScope,
    pub preset: StreamPreset,
    pub instance_budget_mbps: f32,
    pub simulated_viewers: u32,
    pub av_sync_buffer_ms: u32,
    pub viewport: ZoomPanViewport,
    pub pointers: Vec<ActivePointerPing>,
    pub remote_control: RemoteControlState,
}

impl Default for StreamState {
    fn default() -> Self {
        Self {
            sharing_active: false,
            fullscreen_focus: false,
            hide_non_video: false,
            pointer_mode: true,
            audio_scope: AudioScope::WindowOnly,
            preset: StreamPreset::P1080Fps60,
            instance_budget_mbps: 25.0,
            simulated_viewers: 2,
            av_sync_buffer_ms: 0, // 0 = Automático
            viewport: ZoomPanViewport::default(),
            pointers: Vec::new(),
            remote_control: RemoteControlState::Idle,
        }
    }
}

#[derive(Debug, Clone)]
pub enum StreamAction {
    ToggleSharing,
    ToggleFullscreenFocus,
    ToggleHideNonVideo,
    TogglePointerMode,
    SetAudioScope(AudioScope),
    SetPreset(StreamPreset),
    AvSyncBufferChanged(u32),
    ZoomAt {
        cursor_x: f32,
        cursor_y: f32,
        width: f32,
        height: f32,
        factor: f32,
    },
    PanBy {
        dx: f32,
        dy: f32,
        width: f32,
        height: f32,
    },
    ResetZoom,
    PointerPingAt {
        nx: f32,
        ny: f32,
    },
    ClearPointers,
    SimulateRemoteRequest,
    ApproveRemoteControl {
        allow_keyboard: bool,
    },
    PanicRevokeRemote,
}

#[derive(Default)]
struct ViewportInteraction {
    dragging: bool,
    last_cursor: Option<Point>,
}

struct StreamViewportCanvas<'a> {
    viewport: ZoomPanViewport,
    pointers: &'a [ActivePointerPing],
    pointer_mode: bool,
    sharing_active: bool,
}

impl canvas::Program<StreamAction> for StreamViewportCanvas<'_> {
    type State = ViewportInteraction;

    fn update(
        &self,
        interaction: &mut Self::State,
        event: canvas::Event,
        bounds: Rectangle,
        cursor: iced::mouse::Cursor,
    ) -> (canvas::event::Status, Option<StreamAction>) {
        match event {
            canvas::Event::Mouse(iced::mouse::Event::WheelScrolled { delta }) => {
                let Some(pos) = cursor.position_in(bounds) else {
                    return (canvas::event::Status::Ignored, None);
                };
                let dy = match delta {
                    iced::mouse::ScrollDelta::Lines { y, .. } => y,
                    iced::mouse::ScrollDelta::Pixels { y, .. } => y / 60.0,
                };
                if dy.abs() < 1e-4 {
                    return (canvas::event::Status::Ignored, None);
                }
                let factor = if dy > 0.0 { 1.18 } else { 1.0 / 1.18 };
                (
                    canvas::event::Status::Captured,
                    Some(StreamAction::ZoomAt {
                        cursor_x: pos.x,
                        cursor_y: pos.y,
                        width: bounds.width,
                        height: bounds.height,
                        factor,
                    }),
                )
            }
            canvas::Event::Mouse(iced::mouse::Event::ButtonPressed(iced::mouse::Button::Left)) => {
                let Some(pos) = cursor.position_in(bounds) else {
                    return (canvas::event::Status::Ignored, None);
                };
                if self.viewport.scale > 1.01 && !self.pointer_mode {
                    interaction.dragging = true;
                    interaction.last_cursor = Some(pos);
                    return (canvas::event::Status::Captured, None);
                }
                if let Some((nx, ny)) = self.viewport.canvas_to_normalized(
                    pos.x,
                    pos.y,
                    bounds.width,
                    bounds.height,
                    1920.0,
                    1080.0,
                ) {
                    return (
                        canvas::event::Status::Captured,
                        Some(StreamAction::PointerPingAt { nx, ny }),
                    );
                }
                (canvas::event::Status::Ignored, None)
            }
            canvas::Event::Mouse(iced::mouse::Event::ButtonReleased(iced::mouse::Button::Left)) => {
                interaction.dragging = false;
                interaction.last_cursor = None;
                (canvas::event::Status::Ignored, None)
            }
            canvas::Event::Mouse(iced::mouse::Event::CursorMoved { .. }) => {
                if !interaction.dragging {
                    return (canvas::event::Status::Ignored, None);
                }
                let Some(pos) = cursor.position_in(bounds) else {
                    return (canvas::event::Status::Ignored, None);
                };
                if let Some(prev) = interaction.last_cursor {
                    interaction.last_cursor = Some(pos);
                    return (
                        canvas::event::Status::Captured,
                        Some(StreamAction::PanBy {
                            dx: pos.x - prev.x,
                            dy: pos.y - prev.y,
                            width: bounds.width,
                            height: bounds.height,
                        }),
                    );
                }
                interaction.last_cursor = Some(pos);
                (canvas::event::Status::Ignored, None)
            }
            _ => (canvas::event::Status::Ignored, None),
        }
    }

    fn draw(
        &self,
        _state: &Self::State,
        renderer: &Renderer,
        _theme: &Theme,
        bounds: Rectangle,
        _cursor: iced::mouse::Cursor,
    ) -> Vec<canvas::Geometry> {
        let mut frame = canvas::Frame::new(renderer, bounds.size());

        // Fundo preto edge-to-edge (paridade PR #496)
        frame.fill_rectangle(Point::ORIGIN, bounds.size(), Color::BLACK);

        // Retângulo 16:9 `object-contain` com Zoom & Pan aplicados
        let base_box = compute_video_content_box(bounds.width, bounds.height, 1920.0, 1080.0);
        let vx = base_box.left * self.viewport.scale + self.viewport.pan_x;
        let vy = base_box.top * self.viewport.scale + self.viewport.pan_y;
        let vw = base_box.width * self.viewport.scale;
        let vh = base_box.height * self.viewport.scale;

        let stage_bg = if self.sharing_active {
            Color::from_rgb(0.086, 0.098, 0.145)
        } else {
            aether_drift::SURFACE
        };
        frame.fill_rectangle(Point::new(vx, vy), Size::new(vw, vh), stage_bg);

        let border = canvas::Path::rectangle(Point::new(vx, vy), Size::new(vw, vh));
        frame.stroke(
            &border,
            canvas::Stroke::default()
                .with_color(aether_drift::BORDER_SUBTLE)
                .with_width(1.5),
        );

        // Desenha marcações de "Clicar e Apontar" (`stream_pointer`)
        for ping in self.pointers {
            let (px, py) = self.viewport.normalized_to_canvas(
                ping.x,
                ping.y,
                bounds.width,
                bounds.height,
                1920.0,
                1080.0,
            );
            let outer = canvas::Path::circle(Point::new(px, py), 16.0);
            frame.stroke(
                &outer,
                canvas::Stroke::default()
                    .with_color(aether_drift::ACCENT_VIOLET)
                    .with_width(2.5),
            );
            let dot = canvas::Path::circle(Point::new(px, py), 4.5);
            frame.fill(&dot, aether_drift::SUCCESS_GREEN);
        }

        vec![frame.into_geometry()]
    }
}

pub fn view<'a>(state: &'a StreamState) -> Element<'a, StreamAction> {
    let eff_kbps = compute_dynamic_stream_bitrate_kbps(
        state.instance_budget_mbps,
        1,
        state.simulated_viewers,
        state.preset,
    );

    let header = row![
        column![
            text("Vídeo & Compartilhamento de Tela (GPU Zero-Copy)").size(18),
            text(format!(
                "{} · Teto dinâmico: {} kbps (maintain-resolution, sem queda 320p)",
                window_audio_backend_label(),
                eff_kbps
            ))
            .size(12)
            .color(aether_drift::TEXT_MUTED),
        ]
        .spacing(2),
        horizontal_space(),
        button(
            text(if state.sharing_active {
                "Parar Transmissão"
            } else {
                "Iniciar Transmissão"
            })
            .size(12),
        )
        .on_press(StreamAction::ToggleSharing)
        .padding([8, 14])
        .style(if state.sharing_active {
            aether_drift::ghost_button_style
        } else {
            aether_drift::primary_button_style
        }),
    ]
    .align_y(Alignment::Center);

    let toolbar = row![
        toggle_btn(
            if state.pointer_mode { "🎯 Modo Apontar: ON" } else { "✋ Modo Arrastar (Pan)" },
            state.pointer_mode,
            StreamAction::TogglePointerMode
        ),
        toggle_btn(
            if state.hide_non_video { "Ocultando sem vídeo" } else { "Ocultar sem vídeo" },
            state.hide_non_video,
            StreamAction::ToggleHideNonVideo
        ),
        toggle_btn(
            if state.fullscreen_focus { "Sair Foco Tela Cheia" } else { "Foco Tela Cheia" },
            state.fullscreen_focus,
            StreamAction::ToggleFullscreenFocus
        ),
        button(text(format!("Zoom {:.1}x (Reset)", state.viewport.scale)).size(12))
            .on_press(StreamAction::ResetZoom)
            .padding([6, 10])
            .style(aether_drift::ghost_button_style),
        button(text("Limpar Pings").size(12))
            .on_press(StreamAction::ClearPointers)
            .padding([6, 10])
            .style(aether_drift::ghost_button_style),
    ]
    .spacing(8);

    let stage = canvas(StreamViewportCanvas {
        viewport: state.viewport,
        pointers: &state.pointers,
        pointer_mode: state.pointer_mode,
        sharing_active: state.sharing_active,
    })
    .width(Length::Fill)
    .height(Length::Fixed(if state.fullscreen_focus { 420.0 } else { 280.0 }));

    let scope_row = row![
        text("Áudio da transmissão:").size(12).color(aether_drift::TEXT_MUTED),
        scope_btn(AudioScope::WindowOnly, state.audio_scope),
        scope_btn(AudioScope::SystemExcludeSelf, state.audio_scope),
        scope_btn(AudioScope::Muted, state.audio_scope),
    ]
    .spacing(8)
    .align_y(Alignment::Center);

    let preset_row = row![
        text("Qualidade:").size(12).color(aether_drift::TEXT_MUTED),
        preset_btn(StreamPreset::P720Fps30, state.preset),
        preset_btn(StreamPreset::P1080Fps60, state.preset),
        preset_btn(StreamPreset::P1440Fps60, state.preset),
        preset_btn(StreamPreset::SourceFps60, state.preset),
    ]
    .spacing(8)
    .align_y(Alignment::Center);

    let sync_row = column![
        text(if state.av_sync_buffer_ms == 0 {
            "Sync A/V da Stream: Automático".to_string()
        } else {
            format!("Sync A/V da Stream (manual): {} ms", state.av_sync_buffer_ms)
        })
        .size(12)
        .color(aether_drift::TEXT_MUTED),
        slider(0..=2000, state.av_sync_buffer_ms, StreamAction::AvSyncBufferChanged).step(20_u32),
    ]
    .spacing(4);

    let pointer_hint = if let Some(last) = state.pointers.last() {
        let proto = StreamPointerMessage::ping(
            "local".to_string(),
            last.x,
            last.y,
            Some("#8b5cf6".to_string()),
        );
        format!(
            "Último ping ({}) em x={:.2}, y={:.2} · protocolo `{}` compatível com Web/Android",
            last.sender, last.x, last.y, proto.kind
        )
    } else {
        "Use a roda do mouse sobre o palco para Zoom (1x–6x) e clique para apontar na tela."
            .to_string()
    };

    let controls_card = container(
        column![
            scope_row,
            preset_row,
            sync_row,
            text(pointer_hint).size(12).color(aether_drift::TEXT_MUTED),
        ]
        .spacing(10),
    )
    .width(Length::Fill)
    .padding(14)
    .style(aether_drift::card_style);

    let remote_body: Element<'a, StreamAction> = match &state.remote_control {
        RemoteControlState::Idle => row![
            column![
                text("Controle Remoto Seguro (Fase 8)").size(14),
                text(remote_input_backend_label())
                    .size(11)
                    .color(aether_drift::TEXT_MUTED),
            ]
            .spacing(2),
            horizontal_space(),
            button(text("Testar Pedido de Controle").size(12))
                .on_press(StreamAction::SimulateRemoteRequest)
                .padding([6, 12])
                .style(aether_drift::ghost_button_style),
        ]
        .align_y(Alignment::Center)
        .into(),
        RemoteControlState::PendingConsent { requester } => row![
            column![
                text(format!("⚠️ {requester} solicitou controle da sua tela"))
                    .size(13)
                    .color(aether_drift::DANGER_RED),
                text("Nenhum evento de mouse/teclado é aceito até você aprovar explicitamente.")
                    .size(11)
                    .color(aether_drift::TEXT_MUTED),
            ]
            .spacing(2),
            horizontal_space(),
            button(text("Aprovar (Só Mouse)").size(11))
                .on_press(StreamAction::ApproveRemoteControl {
                    allow_keyboard: false,
                })
                .padding([6, 10])
                .style(aether_drift::ghost_button_style),
            button(text("Aprovar (Mouse + Teclado)").size(11))
                .on_press(StreamAction::ApproveRemoteControl {
                    allow_keyboard: true,
                })
                .padding([6, 10])
                .style(aether_drift::primary_button_style),
            button(text("Recusar").size(11))
                .on_press(StreamAction::PanicRevokeRemote)
                .padding([6, 10])
                .style(aether_drift::ghost_button_style),
        ]
        .spacing(6)
        .align_y(Alignment::Center)
        .into(),
        RemoteControlState::Active {
            controller,
            allow_keyboard,
            ..
        } => row![
            column![
                text(format!(
                    "🔴 CONTROLE REMOTO ATIVO — {controller} ({})",
                    if *allow_keyboard {
                        "Mouse + Teclado"
                    } else {
                        "Somente Mouse"
                    }
                ))
                .size(13)
                .color(aether_drift::DANGER_RED),
                text(format!(
                    "Pressione {PANIC_HOTKEY} ou clique ao lado para revogar instantaneamente."
                ))
                .size(11)
                .color(aether_drift::TEXT_MUTED),
            ]
            .spacing(2),
            horizontal_space(),
            button(text(format!("PÂNICO ({PANIC_HOTKEY}) — Revogar")).size(12))
                .on_press(StreamAction::PanicRevokeRemote)
                .padding([7, 14])
                .style(aether_drift::primary_button_style),
        ]
        .align_y(Alignment::Center)
        .into(),
    };

    let remote_card = container(remote_body)
        .width(Length::Fill)
        .padding(14)
        .style(aether_drift::card_style);

    column![header, toolbar, stage, controls_card, remote_card]
        .spacing(12)
        .into()
}

fn toggle_btn<'a>(label: &'a str, active: bool, msg: StreamAction) -> Element<'a, StreamAction> {
    let style = if active {
        aether_drift::primary_button_style
    } else {
        aether_drift::ghost_button_style
    };
    button(text(label).size(12))
        .on_press(msg)
        .padding([6, 10])
        .style(style)
        .into()
}

fn scope_btn<'a>(scope: AudioScope, current: AudioScope) -> Element<'a, StreamAction> {
    let style = if scope == current {
        aether_drift::primary_button_style
    } else {
        aether_drift::ghost_button_style
    };
    button(text(scope.label_pt()).size(11))
        .on_press(StreamAction::SetAudioScope(scope))
        .padding([5, 10])
        .style(style)
        .into()
}

fn preset_btn<'a>(preset: StreamPreset, current: StreamPreset) -> Element<'a, StreamAction> {
    let style = if preset == current {
        aether_drift::primary_button_style
    } else {
        aether_drift::ghost_button_style
    };
    button(text(preset.label()).size(11))
        .on_press(StreamAction::SetPreset(preset))
        .padding([5, 10])
        .style(style)
        .into()
}
