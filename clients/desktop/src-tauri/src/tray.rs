use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use url::Url;

use crate::config::ConfigState;
use crate::updater;

pub const MAIN_WINDOW_LABEL: &str = "main";
const BRIDGE_INIT_SCRIPT: &str = include_str!("../../bridge/init-bridge.js");

pub struct RuntimeState {
    pub is_quitting: AtomicBool,
    /// Deep link `balacopapo://...` recebido no cold-start antes da UI sinalizar `renderer_ready`.
    pub pending_deep_link: Mutex<Option<String>>,
}

impl Default for RuntimeState {
    fn default() -> Self {
        Self {
            is_quitting: AtomicBool::new(false),
            pending_deep_link: Mutex::new(None),
        }
    }
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "tray_show", "Abrir Balacopapo", true, None::<&str>)?;
    let standby_item = MenuItem::with_id(
        app,
        "tray_standby",
        "Modo Standby (hibernar interface)",
        true,
        None::<&str>,
    )?;
    let update_item = MenuItem::with_id(
        app,
        "tray_check_update",
        "Verificar atualizações",
        true,
        None::<&str>,
    )?;
    let instance_item = MenuItem::with_id(
        app,
        "tray_change_instance",
        "Trocar instância...",
        true,
        None::<&str>,
    )?;
    let quit_item = MenuItem::with_id(app, "tray_quit", "Sair", true, None::<&str>)?;

    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(
        app,
        &[
            &show_item,
            &standby_item,
            &sep1,
            &update_item,
            &instance_item,
            &sep2,
            &quit_item,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("Balacopapo")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray_show" => {
                let _ = open_or_focus_main_window(app, false);
            }
            "tray_standby" => {
                hibernate_main_window(app);
            }
            "tray_check_update" => {
                updater::spawn_check_for_updates(app.clone());
            }
            "tray_change_instance" => {
                let _ = open_or_focus_main_window(app, true);
            }
            "tray_quit" => {
                quit_app(app);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = open_or_focus_main_window(tray.app_handle(), false);
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

/// Extrai a primeira URL `balacopapo://` (ou `backspace://`) de uma lista de argumentos CLI.
pub fn extract_deep_link(args: &[String]) -> Option<String> {
    args.iter()
        .find(|arg| arg.starts_with("balacopapo://") || arg.starts_with("backspace://"))
        .cloned()
}

/// Encaminha um deep link recebido para a janela principal (abrindo/acordando do Standby se necessário).
pub fn handle_deep_link(app: &AppHandle, url: String) {
    let was_open = app.get_webview_window(MAIN_WINDOW_LABEL).is_some();
    let _ = open_or_focus_main_window(app, false);
    if was_open {
        let _ = app.emit("deep-link", &url);
    } else if let Ok(mut slot) = app.state::<RuntimeState>().pending_deep_link.lock() {
        *slot = Some(url);
    }
}

/// Entrega um deep link enfileirado assim que a UI web sinaliza `rendererReady()`.
pub fn flush_pending_deep_link(app: &AppHandle) {
    let pending = app
        .state::<RuntimeState>()
        .pending_deep_link
        .lock()
        .ok()
        .and_then(|mut slot| slot.take());

    if let Some(url) = pending {
        let _ = app.emit("deep-link", &url);
    }
}

/// Abre a janela principal (ou recria a WebView caso tenha sido hibernada em Modo Standby).
pub fn open_or_focus_main_window(app: &AppHandle, force_launcher: bool) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        if force_launcher {
            let _ = win.destroy();
        } else {
            let _ = win.unminimize();
            let _ = win.show();
            let _ = win.set_focus();
            return Ok(());
        }
    }

    let cfg = app.state::<ConfigState>().snapshot();
    let target_url = if force_launcher {
        WebviewUrl::App("index.html".into())
    } else if let Some(saved) = cfg.instance_url.as_deref() {
        match Url::parse(saved) {
            Ok(parsed) => WebviewUrl::External(parsed),
            Err(_) => WebviewUrl::App("index.html".into()),
        }
    } else {
        WebviewUrl::App("index.html".into())
    };

    let win = WebviewWindowBuilder::new(app, MAIN_WINDOW_LABEL, target_url)
        .title("Balacopapo")
        .inner_size(1280.0, 820.0)
        .min_inner_size(840.0, 560.0)
        .center()
        .initialization_script(BRIDGE_INIT_SCRIPT)
        .build()
        .map_err(|e| format!("Falha ao criar janela principal: {e}"))?;

    let app_handle = app.clone();
    win.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            let quitting = app_handle
                .state::<RuntimeState>()
                .is_quitting
                .load(Ordering::SeqCst);
            if !quitting {
                api.prevent_close();
                close_to_tray_or_standby(&app_handle);
            }
        }
        WindowEvent::Focused(focused) => {
            let _ = app_handle.emit("window-focus-changed", *focused);
        }
        _ => {}
    });

    Ok(())
}

/// Fecha para a bandeja respeitando a preferência de Modo Standby:
/// - `standby_mode = true`: descarrega a WebView para liberar RAM (~10–15 MB no processo Rust).
/// - `standby_mode = false`: apenas oculta a janela (mantém chamadas WebRTC ativas na WebView).
pub fn close_to_tray_or_standby(app: &AppHandle) {
    let standby = app.state::<ConfigState>().snapshot().standby_mode;
    if standby {
        hibernate_main_window(app);
    } else if let Some(win) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = win.hide();
    }
}

/// Descarrega explicitamente a WebView mantendo o processo nativo na bandeja.
pub fn hibernate_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = win.destroy();
    }
}

pub fn quit_app(app: &AppHandle) {
    app.state::<RuntimeState>()
        .is_quitting
        .store(true, Ordering::SeqCst);
    app.exit(0);
}
