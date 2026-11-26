//! Design System **Aether Drift** em Rust nativo (`Iced` + `wgpu`).
//! Mantém identidade visual consistente com o Balacopapo Web/Android sem duplicar CSS.

use iced::widget::{button, container, text_input};
use iced::{theme::Palette, Background, Border, Color, Theme};

pub const BG_OBSIDIAN: Color = Color::from_rgb(0.047, 0.051, 0.071); // #0c0d12
pub const SURFACE: Color = Color::from_rgb(0.078, 0.086, 0.125); // #141620
pub const SURFACE_ELEVATED: Color = Color::from_rgb(0.110, 0.122, 0.180); // #1c1f2e
pub const BORDER_SUBTLE: Color = Color::from_rgba(0.655, 0.545, 0.980, 0.20);
pub const TEXT_PRIMARY: Color = Color::from_rgb(0.953, 0.957, 0.973); // #f3f4f8
pub const TEXT_MUTED: Color = Color::from_rgb(0.604, 0.627, 0.706); // #9aa0b4
pub const ACCENT_VIOLET: Color = Color::from_rgb(0.545, 0.361, 0.965); // #8b5cf6
pub const ACCENT_VIOLET_HOVER: Color = Color::from_rgb(0.486, 0.227, 0.929); // #7c3aed
pub const SUCCESS_GREEN: Color = Color::from_rgb(0.204, 0.827, 0.600); // #34d399
pub const DANGER_RED: Color = Color::from_rgb(0.973, 0.443, 0.443); // #f87171

pub fn theme() -> Theme {
    Theme::custom(
        "Aether Drift".to_string(),
        Palette {
            background: BG_OBSIDIAN,
            text: TEXT_PRIMARY,
            primary: ACCENT_VIOLET,
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

pub fn sidebar_style(_theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(SURFACE)),
        text_color: Some(TEXT_PRIMARY),
        border: Border {
            color: Color::from_rgba(1.0, 1.0, 1.0, 0.06),
            width: 1.0,
            radius: 0.0.into(),
        },
        ..Default::default()
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
