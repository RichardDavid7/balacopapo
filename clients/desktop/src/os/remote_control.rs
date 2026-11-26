//! Motor de **Controle Remoto Seguro (Fase 8 / Fase D4)**:
//! - Exige **consentimento explícito** do dono da tela antes de aceitar qualquer evento.
//! - Coordenadas de mouse normalizadas `[0..1]` mapeadas à janela/monitor compartilhado.
//! - **Atalho de pânico local (`Ctrl+Alt+Esc`)** revoga o controle instantaneamente.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

pub const PANIC_HOTKEY: &str = "Ctrl+Alt+Esc";

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum RemoteControlState {
    #[default]
    Idle,
    PendingConsent {
        requester: String,
    },
    Active {
        controller: String,
        allow_mouse: bool,
        allow_keyboard: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RemoteInputEvent {
    MouseMove { nx: f32, ny: f32 },
    MouseButton { button: String, pressed: bool },
    KeyPress { code: String, pressed: bool },
}

impl RemoteControlState {
    pub fn request_from(&mut self, requester: String) {
        if matches!(self, Self::Idle) {
            *self = Self::PendingConsent { requester };
        }
    }

    pub fn approve(&mut self, allow_mouse: bool, allow_keyboard: bool) {
        if let Self::PendingConsent { requester } = self.clone() {
            *self = Self::Active {
                controller: requester,
                allow_mouse,
                allow_keyboard,
            };
        }
    }

    /// Revogação instantânea (botão ou atalho global de pânico `Ctrl+Alt+Esc`).
    pub fn panic_revoke(&mut self) {
        *self = Self::Idle;
    }

    /// Verifica se um evento de entrada remoto pode ser injetado com segurança.
    pub fn accepts_event(&self, event: &RemoteInputEvent) -> bool {
        let Self::Active {
            allow_mouse,
            allow_keyboard,
            ..
        } = self
        else {
            return false;
        };

        match event {
            RemoteInputEvent::MouseMove { nx, ny } => {
                *allow_mouse
                    && nx.is_finite()
                    && ny.is_finite()
                    && (0.0..=1.0).contains(nx)
                    && (0.0..=1.0).contains(ny)
            }
            RemoteInputEvent::MouseButton { .. } => *allow_mouse,
            RemoteInputEvent::KeyPress { .. } => *allow_keyboard,
        }
    }
}

pub fn remote_input_backend_label() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "Windows Win32 SendInput (com revogação instantânea Ctrl+Alt+Esc)"
    }
    #[cfg(target_os = "linux")]
    {
        "Linux xdg-desktop-portal RemoteDesktop (Wayland · Fedora / CachyOS)"
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        "macOS CGEvent"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enforces_explicit_consent_and_instant_panic_revoke() {
        let mut st = RemoteControlState::Idle;
        let move_ev = RemoteInputEvent::MouseMove { nx: 0.5, ny: 0.5 };
        let key_ev = RemoteInputEvent::KeyPress {
            code: "KeyA".to_string(),
            pressed: true,
        };

        // Bloqueado antes do consentimento
        assert!(!st.accepts_event(&move_ev));

        st.request_from("Amigo".to_string());
        // Ainda bloqueado enquanto aguarda consentimento explícito
        assert!(!st.accepts_event(&move_ev));

        // Aprovado só mouse, sem teclado
        st.approve(true, false);
        assert!(st.accepts_event(&move_ev));
        assert!(!st.accepts_event(&key_ev));

        // Rejeita coordenadas fora de [0..1]
        assert!(!st.accepts_event(&RemoteInputEvent::MouseMove { nx: 1.5, ny: 0.5 }));

        // Atalho de pânico corta na hora
        st.panic_revoke();
        assert!(!st.accepts_event(&move_ev));
        assert_eq!(st, RemoteControlState::Idle);
    }
}
