use iced::widget::{button, canvas, column, container, horizontal_space, row, scrollable, slider, text, text_input};
use iced::{Alignment, Color, Element, Length, Point, Rectangle, Renderer, Size, Theme};

use crate::os::activity::{DetectedGame, scan_running_game};
use crate::os::keybinds::{
    default_keybinds, find_shortcut_conflicts, keybind_backend_label, KeybindEntry,
};
use crate::ui::aether_drift;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OverlayCorner {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

impl OverlayCorner {
    pub fn label_pt(self) -> &'static str {
        match self {
            Self::TopLeft => "Superior Esquerdo",
            Self::TopRight => "Superior Direito",
            Self::BottomLeft => "Inferior Esquerdo",
            Self::BottomRight => "Inferior Direito",
        }
    }
}

#[derive(Debug, Clone)]
pub struct OverlayAndGameState {
    pub overlay_enabled: bool,
    pub corner: OverlayCorner,
    pub opacity_pct: f32,
    pub scale_pct: f32,
    pub compact_speakers_only: bool,
    pub show_join_leave_toasts: bool,
    pub show_stream_pointers: bool,
    pub keybinds: Vec<KeybindEntry>,
    pub show_activity_publicly: bool,
    pub detected_game: Option<DetectedGame>,
    pub manual_game_override: String,
    pub ignored_apps_csv: String,
}

impl Default for OverlayAndGameState {
    fn default() -> Self {
        Self {
            overlay_enabled: true,
            corner: OverlayCorner::TopLeft,
            opacity_pct: 85.0,
            scale_pct: 100.0,
            compact_speakers_only: true,
            show_join_leave_toasts: true,
            show_stream_pointers: true,
            keybinds: default_keybinds(),
            show_activity_publicly: true,
            detected_game: None,
            manual_game_override: String::new(),
            ignored_apps_csv: String::new(),
        }
    }
}

impl OverlayAndGameState {
    pub fn run_game_scan(&mut self) {
        let ignored: Vec<String> = self
            .ignored_apps_csv
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        self.detected_game = scan_running_game(&ignored);
    }

    pub fn active_presence_label(&self) -> String {
        if !self.show_activity_publicly {
            return "Privado (oculto no perfil)".to_string();
        }
        let manual = self.manual_game_override.trim();
        if !manual.is_empty() {
            return format!("Jogando {manual} (manual)");
        }
        if let Some(game) = &self.detected_game {
            return format!("Jogando {} ({})", game.display_name, game.process_name);
        }
        "Nenhum jogo detectado no momento".to_string()
    }
}

#[derive(Debug, Clone)]
pub enum OverlayAction {
    ToggleOverlay,
    SetCorner(OverlayCorner),
    OpacityChanged(f32),
    ScaleChanged(f32),
    ToggleCompactSpeakers,
    ToggleJoinToasts,
    ToggleStreamPointers,
    ToggleKeybind(usize),
    ToggleShowActivity,
    ManualGameChanged(String),
    IgnoredAppsChanged(String),
    ScanGamesNow,
}

struct OverlayPreviewCanvas {
    corner: OverlayCorner,
    opacity: f32,
    compact: bool,
    toasts: bool,
}

impl canvas::Program<OverlayAction> for OverlayPreviewCanvas {
    type State = ();

    fn draw(
        &self,
        _state: &Self::State,
        renderer: &Renderer,
        _theme: &Theme,
        bounds: Rectangle,
        _cursor: iced::mouse::Cursor,
    ) -> Vec<canvas::Geometry> {
        let mut frame = canvas::Frame::new(renderer, bounds.size());
        frame.fill_rectangle(Point::ORIGIN, bounds.size(), Color::from_rgb(0.06, 0.07, 0.10));

        let alpha = (self.opacity / 100.0).clamp(0.25, 1.0);
        let hud_w = 175.0_f32;
        let hud_h = if self.compact { 54.0_f32 } else { 80.0_f32 };
        let pad = 12.0_f32;

        let (hx, hy) = match self.corner {
            OverlayCorner::TopLeft => (pad, pad),
            OverlayCorner::TopRight => (bounds.width - hud_w - pad, pad),
            OverlayCorner::BottomLeft => (pad, bounds.height - hud_h - pad),
            OverlayCorner::BottomRight => {
                (bounds.width - hud_w - pad, bounds.height - hud_h - pad)
            }
        };

        frame.fill_rectangle(
            Point::new(hx, hy),
            Size::new(hud_w, hud_h),
            Color::from_rgba(0.08, 0.09, 0.13, alpha),
        );
        let box_path = canvas::Path::rectangle(Point::new(hx, hy), Size::new(hud_w, hud_h));
        frame.stroke(
            &box_path,
            canvas::Stroke::default()
                .with_color(Color::from_rgba(0.545, 0.361, 0.965, alpha))
                .with_width(1.5),
        );

        let dot = canvas::Path::circle(Point::new(hx + 16.0, hy + 20.0), 5.0);
        frame.fill(&dot, Color::from_rgba(0.204, 0.827, 0.600, alpha));

        frame.fill_text(canvas::Text {
            content: "Richard (falando)".to_string(),
            position: Point::new(hx + 28.0, hy + 13.0),
            color: Color::from_rgba(0.95, 0.96, 0.98, alpha),
            size: 12.0.into(),
            ..Default::default()
        });

        if !self.compact {
            frame.fill_text(canvas::Text {
                content: "Ana · mutado".to_string(),
                position: Point::new(hx + 28.0, hy + 36.0),
                color: Color::from_rgba(0.60, 0.63, 0.71, alpha),
                size: 11.0.into(),
                ..Default::default()
            });
        }

        if self.toasts {
            let toast_y = hy + hud_h + 6.0;
            let ty = if toast_y + 24.0 < bounds.height {
                toast_y
            } else {
                (hy - 28.0).max(6.0)
            };
            frame.fill_rectangle(
                Point::new(hx, ty),
                Size::new(hud_w, 22.0),
                Color::from_rgba(0.11, 0.12, 0.18, alpha),
            );
            frame.fill_text(canvas::Text {
                content: "● Lucas entrou na call".to_string(),
                position: Point::new(hx + 8.0, ty + 5.0),
                color: Color::from_rgba(0.204, 0.827, 0.600, alpha),
                size: 10.5.into(),
                ..Default::default()
            });
        }

        vec![frame.into_geometry()]
    }
}

pub fn view<'a>(state: &'a OverlayAndGameState) -> Element<'a, OverlayAction> {
    let header = row![
        column![
            text("Overlay In-Game, Atalhos Globais & Presença de Jogos").size(18),
            text("Superfície wgpu click-through sob demanda (+2–4 MB RAM, 0 FPS constantes sobre o jogo)")
                .size(12)
                .color(aether_drift::TEXT_MUTED),
        ]
        .spacing(2),
        horizontal_space(),
        button(
            text(if state.overlay_enabled {
                "Overlay: Ativo"
            } else {
                "Overlay: Desligado"
            })
            .size(12),
        )
        .on_press(OverlayAction::ToggleOverlay)
        .padding([7, 14])
        .style(if state.overlay_enabled {
            aether_drift::primary_button_style
        } else {
            aether_drift::ghost_button_style
        }),
    ]
    .align_y(Alignment::Center);

    let preview = canvas(OverlayPreviewCanvas {
        corner: state.corner,
        opacity: state.opacity_pct,
        compact: state.compact_speakers_only,
        toasts: state.show_join_leave_toasts,
    })
    .width(Length::Fill)
    .height(Length::Fixed(165.0));

    let corner_row = row![
        text("Posição:").size(12).color(aether_drift::TEXT_MUTED),
        corner_btn(OverlayCorner::TopLeft, state.corner),
        corner_btn(OverlayCorner::TopRight, state.corner),
        corner_btn(OverlayCorner::BottomLeft, state.corner),
        corner_btn(OverlayCorner::BottomRight, state.corner),
    ]
    .spacing(6)
    .align_y(Alignment::Center);

    let layers_row = row![
        toggle_btn(
            if state.compact_speakers_only { "Modo Compacto (só quem fala)" } else { "Mostrar todos na call" },
            state.compact_speakers_only,
            OverlayAction::ToggleCompactSpeakers
        ),
        toggle_btn(
            "Avisos de Entrada/Saída",
            state.show_join_leave_toasts,
            OverlayAction::ToggleJoinToasts
        ),
        toggle_btn(
            "Camada Apontar na Tela",
            state.show_stream_pointers,
            OverlayAction::ToggleStreamPointers
        ),
    ]
    .spacing(8);

    let overlay_card = container(
        column![
            text("Prévia do Overlay (3 Camadas: Speakers · Toasts · Pointers)").size(14),
            preview,
            corner_row,
            layers_row,
            row![
                column![
                    text(format!("Opacidade: {:.0}%", state.opacity_pct))
                        .size(11)
                        .color(aether_drift::TEXT_MUTED),
                    slider(30.0..=100.0, state.opacity_pct, OverlayAction::OpacityChanged)
                        .step(5.0_f32),
                ]
                .width(Length::FillPortion(1)),
                column![
                    text(format!("Escala: {:.0}%", state.scale_pct))
                        .size(11)
                        .color(aether_drift::TEXT_MUTED),
                    slider(75.0..=150.0, state.scale_pct, OverlayAction::ScaleChanged)
                        .step(5.0_f32),
                ]
                .width(Length::FillPortion(1)),
            ]
            .spacing(12),
        ]
        .spacing(10),
    )
    .width(Length::Fill)
    .padding(14)
    .style(aether_drift::card_style);

    let conflicts = find_shortcut_conflicts(&state.keybinds);
    let mut keybinds_col = column![
        text("Atalhos Globais em Jogos (sem Alt+Tab)").size(14),
        text(keybind_backend_label())
            .size(11)
            .color(aether_drift::TEXT_MUTED),
    ]
    .spacing(6);

    for (idx, kb) in state.keybinds.iter().enumerate() {
        keybinds_col = keybinds_col.push(
            row![
                text(kb.action.label_pt()).size(13),
                horizontal_space(),
                container(text(&kb.shortcut).size(11))
                    .padding([4, 10])
                    .style(aether_drift::pill_style),
                button(text(if kb.enabled { "Ativo" } else { "Off" }).size(11))
                    .on_press(OverlayAction::ToggleKeybind(idx))
                    .padding([4, 10])
                    .style(if kb.enabled {
                        aether_drift::primary_button_style
                    } else {
                        aether_drift::ghost_button_style
                    }),
            ]
            .spacing(8)
            .align_y(Alignment::Center),
        );
    }

    if !conflicts.is_empty() {
        keybinds_col = keybinds_col.push(
            text(format!("Conflito de atalho detectado: {}", conflicts.join(", ")))
                .size(12)
                .color(aether_drift::DANGER_RED),
        );
    }

    let keybinds_card = container(keybinds_col)
        .width(Length::Fill)
        .padding(14)
        .style(aether_drift::card_style);

    let activity_card = container(
        column![
            row![
                column![
                    text("Presença de Jogos (Baixíssimo Custo de CPU)").size(14),
                    text(state.active_presence_label())
                        .size(12)
                        .color(aether_drift::SUCCESS_GREEN),
                ]
                .spacing(2),
                horizontal_space(),
                toggle_btn(
                    if state.show_activity_publicly { "Exibir no Perfil: ON" } else { "Exibir no Perfil: OFF" },
                    state.show_activity_publicly,
                    OverlayAction::ToggleShowActivity
                ),
                button(text("Detectar Agora").size(12))
                    .on_press(OverlayAction::ScanGamesNow)
                    .padding([6, 12])
                    .style(aether_drift::primary_button_style),
            ]
            .spacing(8)
            .align_y(Alignment::Center),
            row![
                text_input("Definir jogo manualmente (opcional)...", &state.manual_game_override)
                    .on_input(OverlayAction::ManualGameChanged)
                    .padding(9)
                    .width(Length::FillPortion(1))
                    .style(aether_drift::input_style),
                text_input("Ignorar processos (ex: cs2, javaw)...", &state.ignored_apps_csv)
                    .on_input(OverlayAction::IgnoredAppsChanged)
                    .padding(9)
                    .width(Length::FillPortion(1))
                    .style(aether_drift::input_style),
            ]
            .spacing(10),
        ]
        .spacing(10),
    )
    .width(Length::Fill)
    .padding(14)
    .style(aether_drift::card_style);

    scrollable(column![header, overlay_card, keybinds_card, activity_card].spacing(12))
        .height(Length::Fill)
        .into()
}

fn corner_btn<'a>(corner: OverlayCorner, current: OverlayCorner) -> Element<'a, OverlayAction> {
    let style = if corner == current {
        aether_drift::primary_button_style
    } else {
        aether_drift::ghost_button_style
    };
    button(text(corner.label_pt()).size(11))
        .on_press(OverlayAction::SetCorner(corner))
        .padding([4, 8])
        .style(style)
        .into()
}

fn toggle_btn<'a>(label: &'a str, active: bool, msg: OverlayAction) -> Element<'a, OverlayAction> {
    let style = if active {
        aether_drift::primary_button_style
    } else {
        aether_drift::ghost_button_style
    };
    button(text(label).size(11))
        .on_press(msg)
        .padding([5, 10])
        .style(style)
        .into()
}
