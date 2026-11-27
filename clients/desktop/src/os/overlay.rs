//! **Overlay In-Game Transparente & Click-Through** (Etapa 2):
//! - Janela Tauri v2 sob demanda (`label = "overlay"`): criada apenas quando ativa e destruída
//!   ao sair da chamada (`0 MB` de RAM fora de chamada).
//! - **Zero injeção de DLL / Zero risco de Anti-Cheat**: usa apenas janela nativa transparente
//!   acima do jogo em modo Tela Cheia Sem Bordas / Janela.
//! - **Anti-captura (Windows):** `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)` garante
//!   que o overlay nunca apareça na transmissão de tela (sem loop infinito).
//! - **Click-through + Anti-foco (Windows):** `WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOPMOST | WS_EX_TOOLWINDOW`.
//! - **3 Camadas:** Clicar & Apontar `(nx, ny)` na transmissão, Quem está falando, e Toasts discretos.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl};

pub const OVERLAY_LABEL: &str = "overlay";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum OverlayCorner {
    #[default]
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayConfig {
    pub enabled: bool,
    pub show_pointers: bool,
    pub show_speakers: bool,
    pub show_toasts: bool,
    pub corner: OverlayCorner,
    pub opacity: f32,
    #[serde(default)]
    pub monitor_index: Option<usize>,
}

impl Default for OverlayConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            show_pointers: true,
            show_speakers: true,
            show_toasts: true,
            corner: OverlayCorner::TopLeft,
            opacity: 0.92,
            monitor_index: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlaySpeaker {
    pub identity: String,
    pub name: String,
    pub speaking: bool,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub avatar_color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayPointerPayload {
    pub sender_name: String,
    pub x: f32,
    pub y: f32,
    #[serde(default = "default_pointer_color")]
    pub color: String,
    #[serde(default = "default_pointer_mode")]
    pub mode: String,
}

fn default_pointer_color() -> String {
    "#5865f2".to_string()
}

fn default_pointer_mode() -> String {
    "ping".to_string()
}

impl OverlayPointerPayload {
    pub fn sanitized(mut self) -> Self {
        self.x = if self.x.is_finite() {
            self.x.clamp(0.0, 1.0)
        } else {
            0.5
        };
        self.y = if self.y.is_finite() {
            self.y.clamp(0.0, 1.0)
        } else {
            0.5
        };
        if self.sender_name.trim().is_empty() {
            self.sender_name = "Amigo".to_string();
        }
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayToastPayload {
    pub title: String,
    pub body: String,
    #[serde(default = "default_toast_kind")]
    pub kind: String,
    #[serde(default = "default_toast_duration")]
    pub duration_ms: u32,
}

fn default_toast_kind() -> String {
    "info".to_string()
}

fn default_toast_duration() -> u32 {
    3_200
}

#[derive(Debug, Clone, Copy)]
struct LogicalRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn resolve_target_monitor_rect(app: &AppHandle, monitor_index: Option<usize>) -> LogicalRect {
    let fallback = LogicalRect {
        x: 0.0,
        y: 0.0,
        width: 1920.0,
        height: 1080.0,
    };

    let Some(main_win) = app.get_webview_window("main") else {
        return fallback;
    };

    let monitor = if let Some(idx) = monitor_index {
        main_win
            .available_monitors()
            .ok()
            .and_then(|list| list.into_iter().nth(idx))
    } else {
        main_win
            .primary_monitor()
            .ok()
            .flatten()
            .or_else(|| main_win.current_monitor().ok().flatten())
    };

    let Some(mon) = monitor else {
        return fallback;
    };

    let scale = mon.scale_factor().max(0.5);
    let pos = mon.position();
    let size = mon.size();

    LogicalRect {
        x: f64::from(pos.x) / scale,
        y: f64::from(pos.y) / scale,
        width: f64::from(size.width) / scale,
        height: f64::from(size.height) / scale,
    }
}

/// Garante que a janela de Overlay exista, esteja posicionada no monitor alvo e seja 100% click-through.
pub fn ensure_overlay_window(app: &AppHandle, config: &OverlayConfig) -> Result<(), String> {
    let rect = resolve_target_monitor_rect(app, config.monitor_index);

    if let Some(existing) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = existing.set_ignore_cursor_events(true);
        let _ = existing.show();
        emit_config(app, config);
        return Ok(());
    }

    let overlay = tauri::WebviewWindowBuilder::new(
        app,
        OVERLAY_LABEL,
        WebviewUrl::App("overlay.html".into()),
    )
    .title("Balacopapo Overlay")
    .position(rect.x, rect.y)
    .inner_size(rect.width, rect.height)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(false)
    .resizable(false)
    .focused(false)
    .build()
    .map_err(|e| format!("Falha ao criar janela de overlay: {e}"))?;

    let _ = overlay.set_ignore_cursor_events(true);

    #[cfg(target_os = "windows")]
    apply_windows_overlay_flags(&overlay);

    #[cfg(not(target_os = "windows"))]
    let _ = &overlay;

    emit_config(app, config);
    Ok(())
}

/// Destrói completamente a janela de Overlay ao sair da chamada (0 MB de RAM).
pub fn destroy_overlay_window(app: &AppHandle) {
    if let Some(existing) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = existing.destroy();
    }
}

pub fn is_overlay_active(app: &AppHandle) -> bool {
    app.get_webview_window(OVERLAY_LABEL).is_some()
}

pub fn emit_config(app: &AppHandle, config: &OverlayConfig) {
    let _ = app.emit_to(OVERLAY_LABEL, "balacopapo://overlay-config", config);
}

pub fn emit_pointer(app: &AppHandle, pointer: OverlayPointerPayload) {
    let _ = app.emit_to(
        OVERLAY_LABEL,
        "balacopapo://overlay-pointer",
        pointer.sanitized(),
    );
}

pub fn emit_speakers(app: &AppHandle, speakers: &[OverlaySpeaker]) {
    let _ = app.emit_to(OVERLAY_LABEL, "balacopapo://overlay-speakers", speakers);
}

pub fn emit_toast(app: &AppHandle, toast: OverlayToastPayload) {
    let _ = app.emit_to(OVERLAY_LABEL, "balacopapo://overlay-toast", toast);
}

#[cfg(target_os = "windows")]
fn apply_windows_overlay_flags(window: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongW, SetWindowDisplayAffinity, SetWindowLongW, GWL_EXSTYLE,
        WDA_EXCLUDEFROMCAPTURE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
        WS_EX_TRANSPARENT,
    };

    let Ok(tauri_hwnd) = window.hwnd() else {
        return;
    };
    let hwnd = HWND(tauri_hwnd.0 as *mut std::ffi::c_void);

    unsafe {
        // Exclui o overlay da captura de tela/transmissão (sem loop infinito na stream).
        let _ = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);

        // Reforça click-through, sem foco e fora do Alt+Tab.
        let current_ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        let next_ex = current_ex
            | WS_EX_TRANSPARENT.0
            | WS_EX_NOACTIVATE.0
            | WS_EX_TOPMOST.0
            | WS_EX_TOOLWINDOW.0;
        let _ = SetWindowLongW(hwnd, GWL_EXSTYLE, next_ex as i32);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_overlay_pointer_coordinates_and_defaults_name() {
        let p = OverlayPointerPayload {
            sender_name: "   ".to_string(),
            x: 1.4,
            y: -0.2,
            color: "#3ba55d".to_string(),
            mode: "ping".to_string(),
        }
        .sanitized();

        assert_eq!(p.sender_name, "Amigo");
        assert!((p.x - 1.0).abs() < 1e-6);
        assert!((p.y - 0.0).abs() < 1e-6);
    }
}
