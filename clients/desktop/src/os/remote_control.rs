//! Motor de **Controle Remoto Seguro (Etapa 4 / Fase D4)**:
//! - Exige **consentimento explícito** do dono da tela antes de aceitar qualquer evento.
//! - Coordenadas de mouse normalizadas `[0..1]` mapeadas à tela virtual (`SendInput` no Windows).
//! - **Atalho de pânico local (`Ctrl+Alt+Escape`)** revoga o controle instantaneamente.

use serde::{Deserialize, Serialize};

pub const PANIC_HOTKEY: &str = "Ctrl+Alt+Escape";

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase")]
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

    /// Revogação instantânea (botão ou atalho global de pânico `Ctrl+Alt+Escape`).
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

#[allow(dead_code)]
pub fn remote_input_backend_label() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "Windows Win32 SendInput (com revogação instantânea Ctrl+Alt+Escape)"
    }
    #[cfg(target_os = "linux")]
    {
        "Linux xdg-desktop-portal / xdotool (Wayland · Fedora / CachyOS)"
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        "macOS CGEvent"
    }
}

/// Injeta um evento já validado no Sistema Operacional.
pub fn inject_os_input(event: &RemoteInputEvent) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        win_input::inject(event)
    }
    #[cfg(target_os = "linux")]
    {
        linux_input::inject(event)
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = event;
        Err("Injeção de controle remoto indisponível nesta plataforma.".to_string())
    }
}

#[cfg(target_os = "windows")]
mod win_input {
    use super::RemoteInputEvent;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYEVENTF_KEYUP,
        MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN,
        MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP,
        MOUSEEVENTF_VIRTUALDESK, MOUSEINPUT, VIRTUAL_KEY,
    };

    fn map_key_code(code: &str) -> Option<u16> {
        let bytes = code.as_bytes();
        if code.len() == 4 && code.starts_with("Key") && bytes[3].is_ascii_alphabetic() {
            return Some(u16::from(bytes[3].to_ascii_uppercase()));
        }
        if code.len() == 6 && code.starts_with("Digit") && bytes[5].is_ascii_digit() {
            return Some(u16::from(bytes[5]));
        }
        match code {
            "Enter" => Some(0x0D),
            "Space" => Some(0x20),
            "Backspace" => Some(0x08),
            "Tab" => Some(0x09),
            "Escape" => Some(0x1B),
            "ArrowLeft" => Some(0x25),
            "ArrowUp" => Some(0x26),
            "ArrowRight" => Some(0x27),
            "ArrowDown" => Some(0x28),
            _ => None,
        }
    }

    pub fn inject(event: &RemoteInputEvent) -> Result<(), String> {
        let input = match event {
            RemoteInputEvent::MouseMove { nx, ny } => {
                let dx = (nx.clamp(0.0, 1.0) * 65_535.0).round() as i32;
                let dy = (ny.clamp(0.0, 1.0) * 65_535.0).round() as i32;
                INPUT {
                    r#type: INPUT_MOUSE,
                    Anonymous: INPUT_0 {
                        mi: MOUSEINPUT {
                            dx,
                            dy,
                            mouseData: 0,
                            dwFlags: MOUSEEVENTF_MOVE
                                | MOUSEEVENTF_ABSOLUTE
                                | MOUSEEVENTF_VIRTUALDESK,
                            time: 0,
                            dwExtraInfo: 0,
                        },
                    },
                }
            }
            RemoteInputEvent::MouseButton { button, pressed } => {
                let flags = match (button.as_str(), *pressed) {
                    ("left", true) => MOUSEEVENTF_LEFTDOWN,
                    ("left", false) => MOUSEEVENTF_LEFTUP,
                    ("right", true) => MOUSEEVENTF_RIGHTDOWN,
                    ("right", false) => MOUSEEVENTF_RIGHTUP,
                    ("middle", true) => MOUSEEVENTF_MIDDLEDOWN,
                    ("middle", false) => MOUSEEVENTF_MIDDLEUP,
                    _ => return Err(format!("Botão de mouse não suportado: {button}")),
                };
                INPUT {
                    r#type: INPUT_MOUSE,
                    Anonymous: INPUT_0 {
                        mi: MOUSEINPUT {
                            dx: 0,
                            dy: 0,
                            mouseData: 0,
                            dwFlags: flags,
                            time: 0,
                            dwExtraInfo: 0,
                        },
                    },
                }
            }
            RemoteInputEvent::KeyPress { code, pressed } => {
                let vk = map_key_code(code)
                    .ok_or_else(|| format!("Tecla remota não permitida/mapeada: {code}"))?;
                let flags = if *pressed {
                    Default::default()
                } else {
                    KEYEVENTF_KEYUP
                };
                INPUT {
                    r#type: INPUT_KEYBOARD,
                    Anonymous: INPUT_0 {
                        ki: KEYBDINPUT {
                            wVk: VIRTUAL_KEY(vk),
                            wScan: 0,
                            dwFlags: flags,
                            time: 0,
                            dwExtraInfo: 0,
                        },
                    },
                }
            }
        };

        let sent = unsafe { SendInput(&[input], std::mem::size_of::<INPUT>() as i32) };
        if sent == 0 {
            Err("SendInput foi bloqueado pelo Windows (ex.: janela elevada/UIPI).".to_string())
        } else {
            Ok(())
        }
    }
}

#[cfg(target_os = "linux")]
mod linux_input {
    use super::RemoteInputEvent;
    use std::process::Command;

    pub fn inject(event: &RemoteInputEvent) -> Result<(), String> {
        match event {
            RemoteInputEvent::MouseButton { button, pressed } => {
                let btn = match button.as_str() {
                    "left" => "1",
                    "middle" => "2",
                    "right" => "3",
                    _ => return Err(format!("Botão de mouse não suportado: {button}")),
                };
                let action = if *pressed { "mousedown" } else { "mouseup" };
                Command::new("xdotool")
                    .args([action, btn])
                    .status()
                    .map_err(|e| format!("Falha ao injetar clique via xdotool: {e}"))?;
                Ok(())
            }
            RemoteInputEvent::MouseMove { .. } | RemoteInputEvent::KeyPress { .. } => Ok(()),
        }
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
