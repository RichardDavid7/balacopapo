//! Preferências regionais independentes do idioma (Fase 8):
//! - Idiomas: Português (`pt`), Inglês (`en`), Espanhol (`es`), Alemão (`de`), Russo (`ru`), Chinês (`zh`)
//! - Formato de relógio independente: `Auto` | `24h` | `12h` (ex.: interface em inglês com relógio 24h)

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppLanguage {
    #[default]
    Pt,
    En,
    Es,
    De,
    Ru,
    Zh,
}

impl AppLanguage {
    pub const ALL: &'static [Self] = &[
        Self::Pt,
        Self::En,
        Self::Es,
        Self::De,
        Self::Ru,
        Self::Zh,
    ];

    pub fn code(self) -> &'static str {
        match self {
            Self::Pt => "pt",
            Self::En => "en",
            Self::Es => "es",
            Self::De => "de",
            Self::Ru => "ru",
            Self::Zh => "zh",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Pt => "Português (BR)",
            Self::En => "English",
            Self::Es => "Español",
            Self::De => "Deutsch",
            Self::Ru => "Русский",
            Self::Zh => "中文",
        }
    }

    pub fn from_code(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "en" => Self::En,
            "es" => Self::Es,
            "de" => Self::De,
            "ru" => Self::Ru,
            "zh" => Self::Zh,
            _ => Self::Pt,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClockFormat {
    #[default]
    Auto,
    H24,
    H12,
}

impl ClockFormat {
    pub fn label_pt(self) -> &'static str {
        match self {
            Self::Auto => "Automático",
            Self::H24 => "24 horas (18:05)",
            Self::H12 => "12 horas (6:05 PM)",
        }
    }
}

pub fn format_clock(hour24: u8, minute: u8, format: ClockFormat) -> String {
    let h = hour24 % 24;
    let m = minute % 60;
    match format {
        ClockFormat::Auto | ClockFormat::H24 => format!("{h:02}:{m:02}"),
        ClockFormat::H12 => {
            let suffix = if h >= 12 { "PM" } else { "AM" };
            let h12 = match h % 12 {
                0 => 12,
                v => v,
            };
            format!("{h12}:{m:02} {suffix}")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_12h_and_24h_independently_of_language() {
        assert_eq!(format_clock(18, 5, ClockFormat::H24), "18:05");
        assert_eq!(format_clock(18, 5, ClockFormat::H12), "6:05 PM");
        assert_eq!(format_clock(0, 30, ClockFormat::H12), "12:30 AM");
        assert_eq!(AppLanguage::ALL.len(), 6);
    }
}
