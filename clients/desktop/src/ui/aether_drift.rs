//! Design System **Aether Drift** em Rust nativo (`Iced` + `wgpu`).
//! Mantém identidade visual consistente com o Balacopapo Web/Android sem duplicar CSS.

use iced::widget::{button, container, text_input};
use iced::{theme::Palette, Background, Border, Color, Theme};

pub const BG_RAIL: Color = Color::from_rgb(0.035, 0.039, 0.059); // #090a0f (Discord/Backspace server rail)
pub const BG_OBSIDIAN: Color = Color::from_rgb(0.086, 0.094, 0.141); // #161824 (main chat canvas)
pub const SURFACE: Color = Color::from_rgb(0.067, 0.075, 0.110); // #11131c (channel sidebar)
pub const SURFACE_DOCK: Color = Color::from_rgb(0.051, 0.059, 0.090); // #0d0f17 (user footer dock)
pub const SURFACE_ELEVATED: Color = Color::from_rgb(0.118, 0.129, 0.192); // #1e2131 (composer / hover)
pub const BORDER_SUBTLE: Color = Color::from_rgba(1.0, 1.0, 1.0, 0.07);
pub const TEXT_PRIMARY: Color = Color::from_rgb(0.953, 0.957, 0.973); // #f3f4f8
pub const TEXT_MUTED: Color = Color::from_rgb(0.604, 0.627, 0.706); // #9aa0b4
pub const ACCENT_VIOLET: Color = Color::from_rgb(0.545, 0.361, 0.965); // #8b5cf6
pub const ACCENT_VIOLET_HOVER: Color = Color::from_rgb(0.486, 0.227, 0.929); // #7c3aed
pub const SUCCESS_GREEN: Color = Color::from_rgb(0.204, 0.827, 0.600); // #34d399
pub const DANGER_RED: Color = Color::from_rgb(0.973, 0.443, 0.443); // #f87171

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AppThemeId {
    #[default]
    AetherDrift,
    MidnightBlue,
    EmeraldDark,
    OledPureBlack,
}

impl AppThemeId {
    pub const ALL: &'static [Self] = &[
        Self::AetherDrift,
        Self::MidnightBlue,
        Self::EmeraldDark,
        Self::OledPureBlack,
    ];

    pub fn code(self) -> &'static str {
        match self {
            Self::AetherDrift => "aether_drift",
            Self::MidnightBlue => "midnight_blue",
            Self::EmeraldDark => "emerald_dark",
            Self::OledPureBlack => "oled_black",
        }
    }

    pub fn from_code(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "midnight_blue" => Self::MidnightBlue,
            "emerald_dark" => Self::EmeraldDark,
            "oled_black" => Self::OledPureBlack,
            _ => Self::AetherDrift,
        }
    }

    pub fn label_pt(self) -> &'static str {
        match self {
            Self::AetherDrift => "Aether Drift (Padrão)",
            Self::MidnightBlue => "Azul Meia-Noite",
            Self::EmeraldDark => "Esmeralda Escuro",
            Self::OledPureBlack => "Preto OLED Puro",
        }
    }
}

pub fn theme_for(id: AppThemeId) -> Theme {
    let (bg, primary) = match id {
        AppThemeId::AetherDrift => (BG_OBSIDIAN, ACCENT_VIOLET),
        AppThemeId::MidnightBlue => (
            Color::from_rgb(0.039, 0.059, 0.110),
            Color::from_rgb(0.231, 0.510, 0.965),
        ),
        AppThemeId::EmeraldDark => (
            Color::from_rgb(0.035, 0.075, 0.063),
            Color::from_rgb(0.063, 0.725, 0.506),
        ),
        AppThemeId::OledPureBlack => (Color::BLACK, ACCENT_VIOLET),
    };
    Theme::custom(
        id.label_pt().to_string(),
        Palette {
            background: bg,
            text: TEXT_PRIMARY,
            primary,
            success: SUCCESS_GREEN,
            danger: DANGER_RED,
        },
    )
}

pub fn card_style(_theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(SURFACE)),
        text_color: Some(TEXT_PRIMARY),
        border: Border {
            color: BORDER_SUBTLE,
            width: 1.0,
            radius: 14.0.into(),
        },
        ..Default::default()
    }
}

pub fn transparent_style(_theme: &Theme) -> container::Style {
    container::Style::default()
}

pub fn sidebar_style(_theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(SURFACE)),
        text_color: Some(TEXT_PRIMARY),
        border: Border {
            color: Color::from_rgba(1.0, 1.0, 1.0, 0.05),
            width: 1.0,
            radius: 0.0.into(),
        },
        ..Default::default()
    }
}

pub fn rail_style(_theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(BG_RAIL)),
        text_color: Some(TEXT_PRIMARY),
        ..Default::default()
    }
}

pub fn dock_style(_theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(SURFACE_DOCK)),
        text_color: Some(TEXT_PRIMARY),
        border: Border {
            color: Color::from_rgba(1.0, 1.0, 1.0, 0.05),
            width: 1.0,
            radius: 0.0.into(),
        },
        ..Default::default()
    }
}

pub fn header_bar_style(_theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(BG_OBSIDIAN)),
        text_color: Some(TEXT_PRIMARY),
        border: Border {
            color: Color::from_rgba(1.0, 1.0, 1.0, 0.06),
            width: 1.0,
            radius: 0.0.into(),
        },
        ..Default::default()
    }
}

/// Botão redondo/squircle da barra lateral esquerda de Grupos (estilo Discord/Backspace).
pub fn rail_icon_button_style(active: bool) -> impl Fn(&Theme, button::Status) -> button::Style {
    move |_theme, status| {
        let (bg, radius) = if active {
            (ACCENT_VIOLET, 16.0)
        } else {
            match status {
                button::Status::Hovered | button::Status::Pressed => (ACCENT_VIOLET, 16.0),
                _ => (SURFACE_ELEVATED, 24.0),
            }
        };
        button::Style {
            background: Some(Background::Color(bg)),
            text_color: Color::WHITE,
            border: Border {
                color: Color::TRANSPARENT,
                width: 0.0,
                radius: radius.into(),
            },
            ..Default::default()
        }
    }
}

/// Linha limpa de canal/DM sem borda pesada (estilo Discord/Backspace).
pub fn channel_row_button_style(active: bool) -> impl Fn(&Theme, button::Status) -> button::Style {
    move |_theme, status| {
        let (bg, text_color) = if active {
            (Color::from_rgba(0.545, 0.361, 0.965, 0.18), TEXT_PRIMARY)
        } else {
            match status {
                button::Status::Hovered | button::Status::Pressed => {
                    (Color::from_rgba(1.0, 1.0, 1.0, 0.06), TEXT_PRIMARY)
                }
                _ => (Color::TRANSPARENT, TEXT_MUTED),
            }
        };
        button::Style {
            background: Some(Background::Color(bg)),
            text_color,
            border: Border {
                color: Color::TRANSPARENT,
                width: 0.0,
                radius: 8.0.into(),
            },
            ..Default::default()
        }
    }
}

/// Botão de ícone discreto (sem borda) para dock de usuário e barra superior.
pub fn icon_button_style(active: bool) -> impl Fn(&Theme, button::Status) -> button::Style {
    move |_theme, status| {
        let bg = if active {
            Color::from_rgba(0.545, 0.361, 0.965, 0.24)
        } else {
            match status {
                button::Status::Hovered | button::Status::Pressed => {
                    Color::from_rgba(1.0, 1.0, 1.0, 0.08)
                }
                _ => Color::TRANSPARENT,
            }
        };
        button::Style {
            background: Some(Background::Color(bg)),
            text_color: TEXT_PRIMARY,
            border: Border {
                color: Color::TRANSPARENT,
                width: 0.0,
                radius: 8.0.into(),
            },
            ..Default::default()
        }
    }
}

pub fn pill_style(_theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(Color::from_rgba(0.545, 0.361, 0.965, 0.16))),
        text_color: Some(TEXT_PRIMARY),
        border: Border {
            color: BORDER_SUBTLE,
            width: 1.0,
            radius: 999.0.into(),
        },
        ..Default::default()
    }
}

pub fn primary_button_style(_theme: &Theme, status: button::Status) -> button::Style {
    let bg = match status {
        button::Status::Hovered => ACCENT_VIOLET_HOVER,
        button::Status::Pressed => Color::from_rgb(0.427, 0.157, 0.851),
        button::Status::Disabled => Color::from_rgba(0.545, 0.361, 0.965, 0.40),
        button::Status::Active => ACCENT_VIOLET,
    };
    button::Style {
        background: Some(Background::Color(bg)),
        text_color: Color::WHITE,
        border: Border {
            color: Color::TRANSPARENT,
            width: 0.0,
            radius: 10.0.into(),
        },
        ..Default::default()
    }
}

pub fn ghost_button_style(_theme: &Theme, status: button::Status) -> button::Style {
    let bg = match status {
        button::Status::Hovered => Color::from_rgba(1.0, 1.0, 1.0, 0.08),
        button::Status::Pressed => Color::from_rgba(1.0, 1.0, 1.0, 0.12),
        _ => Color::from_rgba(1.0, 1.0, 1.0, 0.03),
    };
    button::Style {
        background: Some(Background::Color(bg)),
        text_color: TEXT_PRIMARY,
        border: Border {
            color: Color::from_rgba(1.0, 1.0, 1.0, 0.10),
            width: 1.0,
            radius: 10.0.into(),
        },
        ..Default::default()
    }
}

pub fn input_style(_theme: &Theme, status: text_input::Status) -> text_input::Style {
    let border_color = match status {
        text_input::Status::Focused => ACCENT_VIOLET,
        text_input::Status::Hovered => Color::from_rgba(1.0, 1.0, 1.0, 0.22),
        _ => Color::from_rgba(1.0, 1.0, 1.0, 0.12),
    };
    text_input::Style {
        background: Background::Color(SURFACE_ELEVATED),
        border: Border {
            color: border_color,
            width: 1.0,
            radius: 10.0.into(),
        },
        icon: TEXT_MUTED,
        placeholder: TEXT_MUTED,
        value: TEXT_PRIMARY,
        selection: Color::from_rgba(0.545, 0.361, 0.965, 0.35),
    }
}
