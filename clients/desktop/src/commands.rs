use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

use crate::core::config::{normalize_instance_url, AppConfig};
use crate::os::activity::{scan_running_game, DetectedGame};
use crate::os::autostart;
use crate::os::notifications::send_desktop_notification;
use crate::os::updater::{self, UpdateCheckState};

pub struct DesktopState {
    pub config: Mutex<AppConfig>,
    pub update_state: Mutex<UpdateCheckState>,
}

impl DesktopState {
    pub fn new(config: AppConfig) -> Self {
        Self {
            config: Mutex::new(config),
            update_state: Mutex::new(UpdateCheckState::Idle),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopInfo {
    pub version: String,
    pub build_sha: Option<String>,
    pub platform: &'static str,
    pub instance_url: Option<String>,
    pub autostart_enabled: bool,
    pub update_status: UpdateCheckState,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedGameDto {
    pub process_name: String,
    pub display_name: String,
}

impl From<DetectedGame> for DetectedGameDto {
    fn from(value: DetectedGame) -> Self {
        Self {
            process_name: value.process_name,
            display_name: value.display_name,
        }
    }
}

#[tauri::command]
pub fn get_desktop_info(state: State<'_, DesktopState>) -> DesktopInfo {
    let instance_url = state
        .config
        .lock()
        .ok()
        .and_then(|cfg| cfg.instance_url.clone());

    let update_status = if let Ok(guard) = state.update_state.lock() {
        guard.clone()
    } else {
        UpdateCheckState::Idle
    };

    DesktopInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        build_sha: option_env!("BALACOPAPO_BUILD_SHA").map(ToString::to_string),
        platform: std::env::consts::OS,
        instance_url,
        autostart_enabled: autostart::is_enabled(),
        update_status,
    }
}

#[tauri::command]
pub fn set_instance_url(
    raw_url: String,
    state: State<'_, DesktopState>,
) -> Result<String, String> {
    let normalized = normalize_instance_url(&raw_url)?;
    let mut cfg = state
        .config
        .lock()
        .map_err(|_| "Falha ao acessar configuração local.".to_string())?;
    cfg.instance_url = Some(normalized.clone());
    cfg.save()?;
    Ok(normalized)
}

#[tauri::command]
pub fn clear_instance_url(state: State<'_, DesktopState>) -> Result<(), String> {
    let mut cfg = state
        .config
        .lock()
        .map_err(|_| "Falha ao acessar configuração local.".to_string())?;
    cfg.instance_url = None;
    cfg.save()
}

#[tauri::command]
pub fn set_autostart(enabled: bool) -> Result<bool, String> {
    autostart::set_enabled(enabled)?;
    Ok(autostart::is_enabled())
}

#[tauri::command]
pub fn send_native_notification(title: String, body: String) {
    send_desktop_notification(title, body);
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(url.trim()).map_err(|e| format!("URL inválida: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => open::that(parsed.as_str())
            .map_err(|e| format!("Falha ao abrir navegador padrão: {e}")),
        other => Err(format!("Esquema não permitido para abertura externa: {other}")),
    }
}

#[tauri::command]
pub async fn check_updates_now(
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> Result<UpdateCheckState, String> {
    if let Ok(mut guard) = state.update_state.lock() {
        *guard = UpdateCheckState::Checking;
    }
    let _ = app.emit("balacopapo://update-status", UpdateCheckState::Checking);

    let result = updater::check_and_stage_update().await;
    if let Ok(mut guard) = state.update_state.lock() {
        *guard = result.clone();
    }
    let _ = app.emit("balacopapo://update-status", result.clone());
    Ok(result)
}

#[tauri::command]
pub fn apply_update_and_restart(state: State<'_, DesktopState>) -> Result<(), String> {
    let staged = state
        .update_state
        .lock()
        .ok()
        .and_then(|s| match &*s {
            UpdateCheckState::ReadyToRestart { staged_path, .. } => Some(staged_path.clone()),
            _ => None,
        })
        .ok_or_else(|| "Nenhuma atualização pronta para instalar.".to_string())?;

    updater::install_and_restart(&staged)
}

#[tauri::command]
pub fn scan_active_game(ignored: Option<Vec<String>>) -> Option<DetectedGameDto> {
    let list = ignored.unwrap_or_default();
    scan_running_game(&list).map(Into::into)
}
