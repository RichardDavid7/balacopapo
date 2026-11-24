use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

use crate::config::{normalize_instance_url, ConfigState, DEFAULT_RELEASES_URL};
use crate::tray::{self, MAIN_WINDOW_LABEL};
use crate::updater::{self, UpdateSnapshot, UpdaterState};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoLaunchSettings {
    pub open_at_login: bool,
    pub start_minimized: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoLaunchPatch {
    pub open_at_login: Option<bool>,
    pub start_minimized: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryStatePayload {
    pub mode: String,
    pub reason: Option<serde_json::Value>,
    pub update_state: String,
    pub update_version: Option<String>,
    pub last_update_error: Option<serde_json::Value>,
    pub last_check_result: Option<String>,
}

// ---------------------------------------------------------------------------
// Controles de janela & Modo Standby
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn window_minimize(app: AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = win.minimize();
    }
}

#[tauri::command]
pub fn window_toggle_maximize(app: AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        if win.is_maximized().unwrap_or(false) {
            let _ = win.unmaximize();
        } else {
            let _ = win.maximize();
        }
    }
}

#[tauri::command]
pub fn window_close_to_tray(app: AppHandle) {
    tray::close_to_tray_or_standby(&app);
}

#[tauri::command]
pub fn get_standby_mode(app: AppHandle) -> bool {
    app.state::<ConfigState>().snapshot().standby_mode
}

#[tauri::command]
pub fn set_standby_mode(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let cfg = app
        .state::<ConfigState>()
        .update(|c| c.standby_mode = enabled)?;
    Ok(cfg.standby_mode)
}

#[tauri::command]
pub fn hibernate_now(app: AppHandle) {
    tray::hibernate_main_window(&app);
}

// ---------------------------------------------------------------------------
// Instância Backspace
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_instance_url(app: AppHandle) -> Option<String> {
    app.state::<ConfigState>().snapshot().instance_url
}

#[tauri::command]
pub fn set_instance_url(app: AppHandle, url: String) -> Result<String, String> {
    let normalized = normalize_instance_url(&url)?;
    app.state::<ConfigState>()
        .update(|c| c.instance_url = Some(normalized.clone()))?;
    Ok(normalized)
}

#[tauri::command]
pub fn clear_instance_url(app: AppHandle) -> Result<(), String> {
    app.state::<ConfigState>()
        .update(|c| c.instance_url = None)?;
    tray::open_or_focus_main_window(&app, true)
}

#[tauri::command]
pub fn set_connected_origins(_origins: Vec<String>) {
    // Reservado para política de abertura de links externos na Fase 2.
}

// ---------------------------------------------------------------------------
// Notificações, Badge & Idioma
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn show_notification(
    app: AppHandle,
    title: String,
    body: String,
    _options: Option<serde_json::Value>,
) {
    let _ = app.notification().builder().title(title).body(body).show();
}

#[tauri::command]
pub fn set_badge_count(app: AppHandle, count: u32) {
    if let Some(win) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let title = if count > 0 {
            format!("({count}) Balacopapo")
        } else {
            "Balacopapo".to_string()
        };
        let _ = win.set_title(&title);
    }
}

#[tauri::command]
pub fn set_language(app: AppHandle, language: String) {
    let _ = app
        .state::<ConfigState>()
        .update(|c| c.language = language);
}

// ---------------------------------------------------------------------------
// Auto-Launch
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_auto_launch_settings(app: AppHandle) -> AutoLaunchSettings {
    let open_at_login = app.autolaunch().is_enabled().unwrap_or(false);
    let start_minimized = app.state::<ConfigState>().snapshot().start_minimized;
    AutoLaunchSettings {
        open_at_login,
        start_minimized,
    }
}

#[tauri::command]
pub fn set_auto_launch_settings(
    app: AppHandle,
    settings: AutoLaunchPatch,
) -> Result<AutoLaunchSettings, String> {
    if let Some(enable) = settings.open_at_login {
        let manager = app.autolaunch();
        let res = if enable {
            manager.enable()
        } else {
            manager.disable()
        };
        if let Err(err) = res {
            return Err(format!("Falha ao configurar início automático: {err}"));
        }
    }

    if let Some(minimized) = settings.start_minimized {
        app.state::<ConfigState>()
            .update(|c| c.start_minimized = minimized)?;
    }

    Ok(get_auto_launch_settings(app))
}

// ---------------------------------------------------------------------------
// Auto-Update & Versão
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub fn get_update_status(app: AppHandle) -> UpdateSnapshot {
    app.state::<UpdaterState>().snapshot()
}

#[tauri::command]
pub fn is_sandboxed() -> bool {
    std::env::var_os("FLATPAK_ID").is_some() || std::env::var_os("SNAP").is_some()
}

#[tauri::command]
pub fn check_for_updates(app: AppHandle) {
    updater::spawn_check_for_updates(app);
}

#[tauri::command]
pub fn install_update(app: AppHandle) {
    updater::spawn_install_update(app);
}

#[tauri::command]
pub fn dismiss_update(app: AppHandle, version: String) {
    updater::dismiss_update_version(&app, version);
}

#[tauri::command]
pub fn open_release_page(app: AppHandle) {
    let _ = app.opener().open_url(DEFAULT_RELEASES_URL, None::<&str>);
}

// ---------------------------------------------------------------------------
// Recovery Bridge
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn renderer_ready(app: AppHandle) {
    tray::flush_pending_deep_link(&app);
}

#[tauri::command]
pub fn get_recovery_state(app: AppHandle) -> RecoveryStatePayload {
    let snap = app.state::<UpdaterState>().snapshot();
    let update_state = match snap.status {
        updater::UpdateStatus::Idle | updater::UpdateStatus::UpToDate { .. } => "idle",
        updater::UpdateStatus::Checking => "checking",
        updater::UpdateStatus::Available { .. } | updater::UpdateStatus::Downloading { .. } => {
            "downloading"
        }
        updater::UpdateStatus::Ready { .. } => "downloaded",
        updater::UpdateStatus::Failed { .. } => "error",
    };

    RecoveryStatePayload {
        mode: "normal".to_string(),
        reason: None,
        update_state: update_state.to_string(),
        update_version: None,
        last_update_error: None,
        last_check_result: None,
    }
}

#[tauri::command]
pub fn recovery_action(app: AppHandle, action: String) {
    match action.as_str() {
        "reload" => {
            let _ = tray::open_or_focus_main_window(&app, false);
        }
        "check-update" => updater::spawn_check_for_updates(app),
        "install-update" => updater::spawn_install_update(app),
        "change-instance" => {
            let _ = tray::open_or_focus_main_window(&app, true);
        }
        "open-releases" => {
            let _ = app.opener().open_url(DEFAULT_RELEASES_URL, None::<&str>);
        }
        "quit" => tray::quit_app(&app),
        _ => {}
    }
}
