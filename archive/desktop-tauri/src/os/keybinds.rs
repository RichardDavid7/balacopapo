//! Motor de **Atalhos Globais em Jogos** (sem Alt+Tab):
//! *Mute*, *Deafen*, *Push-to-Talk*, *Mostrar/Ocultar Overlay*, *Silenciar Soundboard*
//! e atalhos individuais para sons do Soundboard.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum KeybindActionKind {
    ToggleMute,
    ToggleDeafen,
    PushToTalk,
    ToggleOverlay,
    MuteSoundboard,
    PlaySoundboardClip(String),
}

impl KeybindActionKind {
    pub fn label_pt(&self) -> String {
        match self {
            Self::ToggleMute => "Alternar Microfone (Mute)".to_string(),
            Self::ToggleDeafen => "Alternar Áudio (Deafen)".to_string(),
            Self::PushToTalk => "Push-to-Talk (PTT)".to_string(),
            Self::ToggleOverlay => "Mostrar / Ocultar Overlay In-Game".to_string(),
            Self::MuteSoundboard => "Silenciar Soundboard".to_string(),
            Self::PlaySoundboardClip(name) => format!("Soundboard: {name}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeybindEntry {
    pub action: KeybindActionKind,
    pub shortcut: String,
    pub enabled: bool,
}

pub fn default_keybinds() -> Vec<KeybindEntry> {
    vec![
        KeybindEntry {
            action: KeybindActionKind::ToggleMute,
            shortcut: "Ctrl+Shift+M".to_string(),
            enabled: true,
        },
        KeybindEntry {
            action: KeybindActionKind::ToggleDeafen,
            shortcut: "Ctrl+Shift+D".to_string(),
            enabled: true,
        },
        KeybindEntry {
            action: KeybindActionKind::PushToTalk,
            shortcut: "Mouse4".to_string(),
            enabled: false,
        },
        KeybindEntry {
            action: KeybindActionKind::ToggleOverlay,
            shortcut: "Ctrl+Shift+O".to_string(),
            enabled: true,
        },
        KeybindEntry {
            action: KeybindActionKind::MuteSoundboard,
            shortcut: "Ctrl+Shift+S".to_string(),
            enabled: true,
        },
    ]
}

pub fn keybind_backend_label() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "Windows Win32 Low-Level Hook (sem Alt+Tab em jogos)"
    }
    #[cfg(target_os = "linux")]
    {
        "Linux XDG GlobalShortcuts Portal (Wayland · Fedora / CachyOS) + X11"
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        "macOS CGEventTap (Acessibilidade)"
    }
}

/// Detecta conflitos de atalhos ativos duplicados (case-insensitive).
pub fn find_shortcut_conflicts(entries: &[KeybindEntry]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut conflicts = Vec::new();
    for e in entries.iter().filter(|e| e.enabled) {
        let norm = e.shortcut.trim().to_ascii_lowercase();
        if !norm.is_empty() && !seen.insert(norm.clone()) {
            conflicts.push(e.shortcut.clone());
        }
    }
    conflicts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_duplicate_enabled_shortcuts() {
        let mut list = default_keybinds();
        assert!(find_shortcut_conflicts(&list).is_empty());
        list[1].shortcut = "ctrl+shift+m".to_string();
        assert_eq!(find_shortcut_conflicts(&list).len(), 1);
    }
}
