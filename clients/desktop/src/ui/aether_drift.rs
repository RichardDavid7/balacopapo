//! Design System **Backspace / Balacopapo Matte & Glass** em Rust nativo (`Iced` + `wgpu`).
//! Tokens RGB 1:1 extraídos diretamente de `packages/web/src/styles/globals.css`.

#![allow(dead_code)]

use iced::widget::{button, container, text_input};
use iced::{theme::Palette, Background, Border, Color, Theme};

const fn rgb8(r: u8, g: u8, b: u8) -> Color {
    Color {
        r: r as f32 / 255.0,
        g: g as f32 / 255.0,
        b: b as f32 / 255.0,
        a: 1.0,
    }
}

// ── Matte Surfaces (`globals.css`) ───────────────────────────────────────────
pub const BG_RAIL: Color = rgb8(11, 11, 16); // --bg-base: 11 11 16 (#0B0B10)
pub const SURFACE: Color = rgb8(26, 26, 35); // --bg-channel / --bg-members: 26 26 35 (#1A1A23)
pub const BG_OBSIDIAN: Color = rgb8(19, 19, 26); // --bg-chat: 19 19 26 (#13131A)
pub const SURFACE_ELEVATED: Color = rgb8(37, 37, 48); // --bg-elevated: 37 37 48 (#252530)
pub const BG_INPUT: Color = rgb8(17, 17, 24); // --bg-input: 17 17 24 (#111118)
pub const SURFACE_DOCK: Color = rgb8(20, 20, 26); // --glass-bg: #14141A

// ── Borders (`globals.css`) ──────────────────────────────────────────────────
pub const BORDER_HARD: Color = rgb8(34, 34, 44); // --border-hard: 34 34 44 (#22222C)
pub const BORDER_SOFT: Color = rgb8(42, 42, 54); // --border-soft: 42 42 54 (#2A2A36)
pub const BORDER_SUBTLE: Color = Color::from_rgba(1.0, 1.0, 1.0, 0.07); // --glass-border

// ── Pastel Accents & Primary (`globals.css`) ─────────────────────────────────
pub const ACCENT_VIOLET: Color = rgb8(124, 108, 246); // --accent-primary: 124 108 246 (#7C6CF6)
pub const ACCENT_VIOLET_HOVER: Color = rgb8(107, 92, 224); // --accent-primary-hover: 107 92 224
pub const SUCCESS_GREEN: Color = rgb8(134, 239, 172); // --accent-mint / --status-online: 134 239 172 (#86EFAC)
pub const STATUS_IDLE: Color = rgb8(252, 211, 77); // --status-idle / --accent-amber: 252 211 77 (#FCD34D)
pub const DANGER_RED: Color = rgb8(252, 165, 165); // --text-danger / --status-dnd: 252 165 165 (#FCA5A5)
pub const ACCENT_ROSE: Color = rgb8(253, 164, 175); // --accent-rose / --notification: 253 164 175 (#FDA4AF)
pub const STATUS_OFFLINE: Color = rgb8(58, 58, 68); // --status-offline: 58 58 68

// ── Text Hierarchy (`globals.css`) ───────────────────────────────────────────
pub const TEXT_PRIMARY: Color = rgb8(239, 239, 239); // --text-primary: 239 239 239 (#EFEFEF)
pub const TEXT_SECONDARY: Color = rgb8(160, 160, 170); // --text-secondary: 160 160 170 (#A0A0AA)
pub const TEXT_MUTED: Color = rgb8(92, 92, 104); // --text-tertiary: 92 92 104 (#5C5C68)
pub const TEXT_CATEGORY: Color = rgb8(72, 72, 84); // --text-category: 72 72 84 (#484854)
pub const TEXT_MESSAGE: Color = rgb8(216, 216, 222); // --text-message: 216 216 222 (#D8D8DE)
pub const TEXT_LINK: Color = rgb8(125, 211, 252); // --text-link: 125 211 252 (#7DD3FC)

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
            Self::AetherDrift => "Backspace Matte (Padrão)",
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
            Color::from_rgb8(12, 16, 28),
            Color::from_rgb8(59, 130, 246),
        ),
        AppThemeId::EmeraldDark => (
            Color::from_rgb8(11, 20, 17),
            Color::from_rgb8(16, 185, 129),
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

pub fn chat_canvas_style(_theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(BG_OBSIDIAN)),
        text_color: Some(TEXT_MESSAGE),
        ..Default::default()
    }
}

pub fn card_style(_theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(SURFACE_DOCK)),
        text_color: Some(TEXT_PRIMARY),
        border: Border {
            color: BORDER_SUBTLE,
            width: 1.0,
            radius: 12.0.into(),
        },
        ..Default::default()
    }
}

/// `.glass-bubble rounded-[14px]` — dock inferior de usuário/voz/música e pílula do composer!
pub fn glass_bubble_style(_theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(SURFACE_DOCK)),
        text_color: Some(TEXT_PRIMARY),
        border: Border {
            color: Color::from_rgba(1.0, 1.0, 1.0, 0.07),
            width: 1.0,
            radius: 14.0.into(),
        },
        ..Default::default()
    }
}

/// `.glass-modal rounded-[12px]` — popout flutuante de perfil e info de conexão!
pub fn glass_modal_style(_theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(Color::from_rgb8(18, 18, 24))),
        text_color: Some(TEXT_PRIMARY),
        border: Border {
            color: Color::from_rgba(1.0, 1.0, 1.0, 0.09),
            width: 1.0,
            radius: 12.0.into(),
        },
        ..Default::default()
    }
}

pub fn sidebar_style(_theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(SURFACE)),
        text_color: Some(TEXT_PRIMARY),
        border: Border {
            color: BORDER_HARD,
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
    glass_bubble_style(_theme)
}

pub fn header_bar_style(_theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(BG_OBSIDIAN)),
        text_color: Some(TEXT_PRIMARY),
        border: Border {
            color: BORDER_HARD,
            width: 1.0,
            radius: 0.0.into(),
        },
        ..Default::default()
    }
}

/// Botão branco/escuro do topo da Rail (Home / Mensagens Diretas) igual ao Backspace Web.
pub fn rail_home_button_style(active: bool) -> impl Fn(&Theme, button::Status) -> button::Style {
    move |_theme, status| {
        let lit = active || matches!(status, button::Status::Hovered | button::Status::Pressed);
        let (bg, fg, radius) = if active {
            (Color::WHITE, BG_RAIL, 13.0)
        } else if lit {
            (Color::WHITE, BG_RAIL, 13.0)
        } else {
            (Color::from_rgb8(58, 58, 68), Color::WHITE, 20.0)
        };
        button::Style {
            background: Some(Background::Color(bg)),
            text_color: fg,
            border: Border {
                color: Color::TRANSPARENT,
                width: 0.0,
                radius: radius.into(),
            },
            ..Default::default()
        }
    }
}

/// Botão de Grupo `40x40` na Rail esquerda (`13px` ativo/hover, `20px` inativo).
pub fn rail_icon_button_style(active: bool) -> impl Fn(&Theme, button::Status) -> button::Style {
    move |_theme, status| {
        let lit = active || matches!(status, button::Status::Hovered | button::Status::Pressed);
        let radius = if lit { 13.0 } else { 20.0 };
        let bg = if active {
            ACCENT_VIOLET
        } else if lit {
            ACCENT_VIOLET_HOVER
        } else {
            Color::from_rgb8(42, 42, 54)
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

/// Botões de ação na parte inferior da Rail (`+`, Entrar, Explorar) com ícone mint `#86EFAC`.
pub fn rail_action_button_style(_theme: &Theme, status: button::Status) -> button::Style {
    let hovered = matches!(status, button::Status::Hovered | button::Status::Pressed);
    let bg = if hovered {
        Color::from_rgba(0.525, 0.937, 0.675, 0.14)
    } else {
        Color::from_rgba(1.0, 1.0, 1.0, 0.04)
    };
    let radius = if hovered { 13.0 } else { 20.0 };
    button::Style {
        background: Some(Background::Color(bg)),
        text_color: SUCCESS_GREEN,
        border: Border {
            color: Color::TRANSPARENT,
            width: 0.0,
            radius: radius.into(),
        },
        ..Default::default()
    }
}

/// Linha de canal `h-8 rounded-[6px]` igual ao `ChannelSidebar.tsx` (`bg-surface-elevated` quando ativo).
pub fn channel_row_button_style(active: bool) -> impl Fn(&Theme, button::Status) -> button::Style {
    move |_theme, status| {
        let (bg, text_color) = if active {
            (SURFACE_ELEVATED, TEXT_PRIMARY)
        } else {
            match status {
                button::Status::Hovered | button::Status::Pressed => {
                    (Color::from_rgba(1.0, 1.0, 1.0, 0.06), TEXT_SECONDARY)
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
                radius: 6.0.into(),
            },
            ..Default::default()
        }
    }
}

/// Os 4 botões inferiores de `VoiceControls.tsx` (`bg-surface-base rounded-[4px] h-[34px]`).
pub fn voice_tile_button_style(active: bool) -> impl Fn(&Theme, button::Status) -> button::Style {
    move |_theme, status| {
        let bg = match status {
            button::Status::Hovered | button::Status::Pressed => SURFACE,
            _ => BG_RAIL,
        };
        button::Style {
            background: Some(Background::Color(bg)),
            text_color: if active { SUCCESS_GREEN } else { TEXT_SECONDARY },
            border: Border {
                color: Color::TRANSPARENT,
                width: 0.0,
                radius: 5.0.into(),
            },
            ..Default::default()
        }
    }
}

/// Botão de ícone discreto (sem borda) para dock de usuário e cabeçalho.
pub fn icon_button_style(active: bool) -> impl Fn(&Theme, button::Status) -> button::Style {
    move |_theme, status| {
        let bg = if active {
            Color::from_rgba(1.0, 1.0, 1.0, 0.12)
        } else {
            match status {
                button::Status::Hovered | button::Status::Pressed => {
                    Color::from_rgba(1.0, 1.0, 1.0, 0.06)
                }
                _ => Color::TRANSPARENT,
            }
        };
        button::Style {
            background: Some(Background::Color(bg)),
            text_color: if active { TEXT_PRIMARY } else { TEXT_MUTED },
            border: Border {
                color: Color::TRANSPARENT,
                width: 0.0,
                radius: 6.0.into(),
            },
            ..Default::default()
        }
    }
}

pub fn pill_style(_theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(Color::from_rgba(1.0, 1.0, 1.0, 0.05))),
        text_color: Some(TEXT_PRIMARY),
        border: Border {
            color: Color::from_rgba(1.0, 1.0, 1.0, 0.08),
            width: 1.0,
            radius: 999.0.into(),
        },
        ..Default::default()
    }
}

pub fn mint_pill_style(_theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(Color::from_rgba(0.525, 0.937, 0.675, 0.14))),
        text_color: Some(SUCCESS_GREEN),
        border: Border {
            color: Color::from_rgba(0.525, 0.937, 0.675, 0.25),
            width: 1.0,
            radius: 6.0.into(),
        },
        ..Default::default()
    }
}

pub fn primary_button_style(_theme: &Theme, status: button::Status) -> button::Style {
    let bg = match status {
        button::Status::Hovered => ACCENT_VIOLET_HOVER,
        button::Status::Pressed => Color::from_rgb8(95, 79, 208),
        button::Status::Disabled => Color::from_rgba(0.486, 0.424, 0.965, 0.40),
        button::Status::Active => ACCENT_VIOLET,
    };
    button::Style {
        background: Some(Background::Color(bg)),
        text_color: Color::WHITE,
        border: Border {
            color: Color::TRANSPARENT,
            width: 0.0,
            radius: 8.0.into(),
        },
        ..Default::default()
    }
}

pub fn ghost_button_style(_theme: &Theme, status: button::Status) -> button::Style {
    let bg = match status {
        button::Status::Hovered => Color::from_rgba(1.0, 1.0, 1.0, 0.10),
        button::Status::Pressed => Color::from_rgba(1.0, 1.0, 1.0, 0.14),
        _ => Color::from_rgba(1.0, 1.0, 1.0, 0.06),
    };
    button::Style {
        background: Some(Background::Color(bg)),
        text_color: TEXT_PRIMARY,
        border: Border {
            color: Color::from_rgba(1.0, 1.0, 1.0, 0.08),
            width: 1.0,
            radius: 8.0.into(),
        },
        ..Default::default()
    }
}

pub fn input_style(_theme: &Theme, status: text_input::Status) -> text_input::Style {
    let border_color = match status {
        text_input::Status::Focused => ACCENT_VIOLET,
        text_input::Status::Hovered => BORDER_SOFT,
        _ => BORDER_HARD,
    };
    text_input::Style {
        background: Background::Color(BG_INPUT),
        border: Border {
            color: border_color,
            width: 1.0,
            radius: 8.0.into(),
        },
        icon: TEXT_MUTED,
        placeholder: TEXT_MUTED,
        value: TEXT_PRIMARY,
        selection: Color::from_rgba(0.525, 0.937, 0.675, 0.25),
    }
}

/// Campo de texto embutido sem borda dentro da pílula flutuante do chat (`input-embedded`).
pub fn embedded_input_style(_theme: &Theme, _status: text_input::Status) -> text_input::Style {
    text_input::Style {
        background: Background::Color(Color::TRANSPARENT),
        border: Border {
            color: Color::TRANSPARENT,
            width: 0.0,
            radius: 0.0.into(),
        },
        icon: TEXT_MUTED,
        placeholder: TEXT_MUTED,
        value: TEXT_PRIMARY,
        selection: Color::from_rgba(0.525, 0.937, 0.675, 0.25),
    }
}
