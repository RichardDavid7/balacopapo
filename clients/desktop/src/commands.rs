use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use crate::core::config::{normalize_instance_url, AppConfig};
use crate::media::isolated_audio::{
    list_audio_targets as enumerate_audio_targets, AudioTarget, IsolatedAudioController,
    IsolatedAudioMode, IsolatedAudioStatus,
};
use crate::media::native_capture::{
    self, CaptureSource, HardwareEncoderInfo, NativeScreenShareConfig, NativeScreenShareController,
    NativeScreenShareStatus,
};
use crate::os::activity::{scan_running_game, DetectedGame};
use crate::os::autostart;
use crate::os::keybinds::{default_keybinds, find_shortcut_conflicts, KeybindEntry};
use crate::os::notifications::send_desktop_notification;
use crate::os::overlay::{
    self, OverlayConfig, OverlayPointerPayload, OverlaySpeaker, OverlayToastPayload,
};
use crate::os::remote_control::{self, RemoteControlState, RemoteInputEvent, PANIC_HOTKEY};
use crate::os::updater::{self, UpdateCheckState};

pub struct DesktopState {
    pub config: Mutex<AppConfig>,
    pub update_state: Mutex<UpdateCheckState>,
    pub isolated_audio: IsolatedAudioController,
    pub overlay_config: Mutex<OverlayConfig>,
    pub native_screen_share: NativeScreenShareController,
    pub keybinds: Mutex<Vec<KeybindEntry>>,
    pub remote_control: Mutex<RemoteControlState>,
    pub last_detected_game: Mutex<Option<DetectedGameDto>>,
}

impl DesktopState {
    pub fn new(config: AppConfig) -> Self {
        let initial_overlay = OverlayConfig {
            enabled: config.overlay_enabled,
            show_pointers: config.overlay_show_pointers,
            show_speakers: config.overlay_show_speakers,
            show_toasts: config.overlay_show_toasts,
            corner: match config.overlay_corner.as_str() {
                "top-right" => overlay::OverlayCorner::TopRight,
                "bottom-left" => overlay::OverlayCorner::BottomLeft,
                "bottom-right" => overlay::OverlayCorner::BottomRight,
                _ => overlay::OverlayCorner::TopLeft,
            },
            opacity: config.overlay_opacity.clamp(0.3, 1.0),
            monitor_index: None,
        };
        Self {
            config: Mutex::new(config),
            update_state: Mutex::new(UpdateCheckState::Idle),
            isolated_audio: IsolatedAudioController::new(),
            overlay_config: Mutex::new(initial_overlay),
            native_screen_share: NativeScreenShareController::new(),
            keybinds: Mutex::new(default_keybinds()),
            remote_control: Mutex::new(RemoteControlState::Idle),
            last_detected_game: Mutex::new(None),
        }
    }
}

fn persist_overlay_config(state: &DesktopState, cfg: &OverlayConfig) {
    if let Ok(mut app_cfg) = state.config.lock() {
        app_cfg.overlay_enabled = cfg.enabled;
        app_cfg.overlay_show_pointers = cfg.show_pointers;
        app_cfg.overlay_show_speakers = cfg.show_speakers;
        app_cfg.overlay_show_toasts = cfg.show_toasts;
        app_cfg.overlay_corner = match cfg.corner {
            overlay::OverlayCorner::TopLeft => "top-left",
            overlay::OverlayCorner::TopRight => "top-right",
            overlay::OverlayCorner::BottomLeft => "bottom-left",
            overlay::OverlayCorner::BottomRight => "bottom-right",
        }
        .to_string();
        app_cfg.overlay_opacity = cfg.opacity.clamp(0.3, 1.0);
        let _ = app_cfg.save();
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
    pub overlay_active: bool,
    pub isolated_audio: IsolatedAudioStatus,
    pub native_screen_share: NativeScreenShareStatus,
    pub remote_control: RemoteControlState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GamePresenceConfig {
    pub enabled: bool,
    pub ignored_games: Vec<String>,
    pub manual_override: Option<String>,
}

/// Registra todos os atalhos globais ativos + o atalho de pânico do Controle Remoto.
pub fn sync_global_shortcuts(app: &AppHandle, entries: &[KeybindEntry]) {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();

    // Atalho de pânico sempre reservado para cortar Controle Remoto instantaneamente.
    let _ = gs.register(PANIC_HOTKEY);

    for entry in entries.iter().filter(|e| e.enabled) {
        let trimmed = entry.shortcut.trim();
        if !trimmed.is_empty() && !trimmed.eq_ignore_ascii_case("mouse4") && !trimmed.eq_ignore_ascii_case("mouse5") {
            let _ = gs.register(trimmed);
        }
    }
}

#[tauri::command]
pub fn get_desktop_info(app: AppHandle, state: State<'_, DesktopState>) -> DesktopInfo {
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

    let remote_control = if let Ok(guard) = state.remote_control.lock() {
        guard.clone()
    } else {
        RemoteControlState::Idle
    };

    DesktopInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        build_sha: option_env!("BALACOPAPO_BUILD_SHA").map(ToString::to_string),
        platform: std::env::consts::OS,
        instance_url,
        autostart_enabled: autostart::is_enabled(),
        update_status,
        overlay_active: overlay::is_overlay_active(&app),
        isolated_audio: state.isolated_audio.status(),
        native_screen_share: state.native_screen_share.status(),
        remote_control,
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

// ---------------------------------------------------------------------------
// Etapa 2: Áudio Isolado por Janela / Processo (WASAPI Process Loopback / PipeWire)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_audio_targets() -> Vec<AudioTarget> {
    enumerate_audio_targets()
}

#[tauri::command]
pub fn start_isolated_audio(
    mode: IsolatedAudioMode,
    state: State<'_, DesktopState>,
) -> Result<IsolatedAudioStatus, String> {
    state.isolated_audio.start(mode)
}

#[tauri::command]
pub fn stop_isolated_audio(state: State<'_, DesktopState>) -> IsolatedAudioStatus {
    state.isolated_audio.stop();
    state.isolated_audio.status()
}

#[tauri::command]
pub fn get_isolated_audio_status(state: State<'_, DesktopState>) -> IsolatedAudioStatus {
    state.isolated_audio.status()
}

// ---------------------------------------------------------------------------
// Etapa 2: Overlay In-Game Click-Through & Anti-Captura (3 Camadas)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_overlay_config(state: State<'_, DesktopState>) -> OverlayConfig {
    if let Ok(guard) = state.overlay_config.lock() {
        guard.clone()
    } else {
        OverlayConfig::default()
    }
}

#[tauri::command]
pub async fn show_overlay(
    app: AppHandle,
    config: Option<OverlayConfig>,
    state: State<'_, DesktopState>,
) -> Result<OverlayConfig, String> {
    let mut next = if let Some(cfg) = config {
        cfg
    } else if let Ok(guard) = state.overlay_config.lock() {
        guard.clone()
    } else {
        OverlayConfig::default()
    };
    next.enabled = true;

    overlay::ensure_overlay_window(&app, &next)?;
    if let Ok(mut guard) = state.overlay_config.lock() {
        *guard = next.clone();
    }
    Ok(next)
}

#[tauri::command]
pub fn hide_overlay(app: AppHandle, state: State<'_, DesktopState>) -> OverlayConfig {
    overlay::destroy_overlay_window(&app);
    let mut next = if let Ok(guard) = state.overlay_config.lock() {
        guard.clone()
    } else {
        OverlayConfig::default()
    };
    next.enabled = false;
    if let Ok(mut guard) = state.overlay_config.lock() {
        *guard = next.clone();
    }
    next
}

#[tauri::command]
pub async fn update_overlay_config(
    app: AppHandle,
    config: OverlayConfig,
    state: State<'_, DesktopState>,
) -> Result<OverlayConfig, String> {
    if config.enabled {
        overlay::ensure_overlay_window(&app, &config)?;
    } else {
        overlay::destroy_overlay_window(&app);
    }

    if let Ok(mut guard) = state.overlay_config.lock() {
        *guard = config.clone();
    }
    persist_overlay_config(&state, &config);
    Ok(config)
}

#[tauri::command]
pub fn push_overlay_pointer(app: AppHandle, pointer: OverlayPointerPayload) {
    if overlay::is_overlay_active(&app) {
        overlay::emit_pointer(&app, pointer);
    }
}

#[tauri::command]
pub fn set_overlay_speakers(app: AppHandle, speakers: Vec<OverlaySpeaker>) {
    if overlay::is_overlay_active(&app) {
        overlay::emit_speakers(&app, &speakers);
    }
}

#[tauri::command]
pub fn push_overlay_toast(app: AppHandle, toast: OverlayToastPayload) {
    if overlay::is_overlay_active(&app) {
        overlay::emit_toast(&app, toast);
    }
}

// ---------------------------------------------------------------------------
// Etapa 3: Captura & Transmissão Pixel-Perfect 1080p 120fps (até 150 Mbps)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_capture_sources(app: AppHandle) -> Vec<CaptureSource> {
    native_capture::list_capture_sources(&app)
}

#[tauri::command]
pub fn detect_hardware_encoders() -> Vec<HardwareEncoderInfo> {
    native_capture::detect_hardware_encoders()
}

#[tauri::command]
pub fn start_native_screen_share(
    config: NativeScreenShareConfig,
    state: State<'_, DesktopState>,
) -> Result<NativeScreenShareStatus, String> {
    state.native_screen_share.start(config)
}

#[tauri::command]
pub fn stop_native_screen_share(state: State<'_, DesktopState>) -> NativeScreenShareStatus {
    state.native_screen_share.stop();
    state.native_screen_share.status()
}

#[tauri::command]
pub fn get_native_screen_share_status(state: State<'_, DesktopState>) -> NativeScreenShareStatus {
    state.native_screen_share.status()
}

// ---------------------------------------------------------------------------
// Etapa 4: Atalhos Globais em Jogos, Presença Contínua & Controle Remoto Seguro
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_keybinds(state: State<'_, DesktopState>) -> Vec<KeybindEntry> {
    if let Ok(guard) = state.keybinds.lock() {
        guard.clone()
    } else {
        default_keybinds()
    }
}

#[tauri::command]
pub fn set_keybinds(
    app: AppHandle,
    entries: Vec<KeybindEntry>,
    state: State<'_, DesktopState>,
) -> Result<Vec<KeybindEntry>, String> {
    let conflicts = find_shortcut_conflicts(&entries);
    if !conflicts.is_empty() {
        return Err(format!(
            "Conflito de atalhos duplicados: {}",
            conflicts.join(", ")
        ));
    }

    sync_global_shortcuts(&app, &entries);
    if let Ok(mut guard) = state.keybinds.lock() {
        *guard = entries.clone();
    }
    Ok(entries)
}

#[tauri::command]
pub fn get_game_presence_config(state: State<'_, DesktopState>) -> GamePresenceConfig {
    if let Ok(cfg) = state.config.lock() {
        GamePresenceConfig {
            enabled: cfg.game_presence_enabled,
            ignored_games: cfg.ignored_games.clone(),
            manual_override: cfg.manual_game_override.clone(),
        }
    } else {
        GamePresenceConfig {
            enabled: true,
            ignored_games: Vec::new(),
            manual_override: None,
        }
    }
}

#[tauri::command]
pub fn set_game_presence_config(
    config: GamePresenceConfig,
    state: State<'_, DesktopState>,
) -> Result<GamePresenceConfig, String> {
    let mut cfg = state
        .config
        .lock()
        .map_err(|_| "Falha ao acessar configuração local.".to_string())?;
    cfg.game_presence_enabled = config.enabled;
    cfg.ignored_games = config.ignored_games.clone();
    cfg.manual_game_override = config
        .manual_override
        .clone()
        .filter(|s| !s.trim().is_empty());
    cfg.save()?;
    Ok(GamePresenceConfig {
        enabled: cfg.game_presence_enabled,
        ignored_games: cfg.ignored_games.clone(),
        manual_override: cfg.manual_game_override.clone(),
    })
}

#[tauri::command]
pub fn get_current_game_presence(state: State<'_, DesktopState>) -> Option<DetectedGameDto> {
    state
        .last_detected_game
        .lock()
        .ok()
        .and_then(|g| g.clone())
}

#[tauri::command]
pub fn get_remote_control_state(state: State<'_, DesktopState>) -> RemoteControlState {
    if let Ok(guard) = state.remote_control.lock() {
        guard.clone()
    } else {
        RemoteControlState::Idle
    }
}

#[tauri::command]
pub fn request_remote_control(
    app: AppHandle,
    requester: String,
    state: State<'_, DesktopState>,
) -> RemoteControlState {
    let next = if let Ok(mut guard) = state.remote_control.lock() {
        guard.request_from(requester);
        guard.clone()
    } else {
        RemoteControlState::Idle
    };
    let _ = app.emit("balacopapo://remote-control-state", next.clone());
    next
}

#[tauri::command]
pub async fn approve_remote_control(
    app: AppHandle,
    allow_mouse: bool,
    allow_keyboard: bool,
    state: State<'_, DesktopState>,
) -> Result<RemoteControlState, String> {
    let next = if let Ok(mut guard) = state.remote_control.lock() {
        guard.approve(allow_mouse, allow_keyboard);
        guard.clone()
    } else {
        RemoteControlState::Idle
    };

    if matches!(next, RemoteControlState::Active { .. }) {
        let mut ov_cfg = if let Ok(guard) = state.overlay_config.lock() {
            guard.clone()
        } else {
            OverlayConfig::default()
        };
        ov_cfg.enabled = true;
        let _ = overlay::ensure_overlay_window(&app, &ov_cfg);
        overlay::emit_toast(
            &app,
            OverlayToastPayload {
                title: "Controle Remoto ATIVO".to_string(),
                body: format!("Pressione {PANIC_HOTKEY} a qualquer momento para cortar."),
                kind: "warning".to_string(),
                duration_ms: 5_000,
            },
        );
    }

    let _ = app.emit("balacopapo://remote-control-state", next.clone());
    Ok(next)
}

#[tauri::command]
pub fn revoke_remote_control(
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> RemoteControlState {
    if let Ok(mut guard) = state.remote_control.lock() {
        guard.panic_revoke();
    }
    if overlay::is_overlay_active(&app) {
        overlay::emit_toast(
            &app,
            OverlayToastPayload {
                title: "Controle Remoto encerrado".to_string(),
                body: "Acesso remoto revogado com segurança.".to_string(),
                kind: "info".to_string(),
                duration_ms: 2_800,
            },
        );
    }
    let _ = app.emit("balacopapo://remote-control-state", RemoteControlState::Idle);
    RemoteControlState::Idle
}

#[cfg(target_os = "windows")]
pub const WINDOWS_WEBVIEW_ARGS: &str = "--use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required --disable-features=HardwareMediaKeyHandling";

#[tauri::command]
pub async fn open_desktop_settings(app: AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("settings") {
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(());
    }

    #[cfg_attr(not(target_os = "windows"), allow(unused_mut))]
    let mut builder =
        tauri::WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App("settings.html".into()))
            .title("Configurações do Balacopapo Desktop")
            .inner_size(940.0, 640.0)
            .min_inner_size(760.0, 520.0)
            .resizable(true)
            .background_color(tauri::window::Color(14, 16, 21, 255));

    #[cfg(target_os = "windows")]
    {
        builder = builder.additional_browser_args(WINDOWS_WEBVIEW_ARGS);
    }

    builder
        .build()
        .map_err(|e| format!("Falha ao abrir configurações do desktop: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn inject_remote_input(
    event: RemoteInputEvent,
    state: State<'_, DesktopState>,
) -> Result<(), String> {
    let allowed = state
        .remote_control
        .lock()
        .ok()
        .is_some_and(|st| st.accepts_event(&event));

    if !allowed {
        return Err("Controle remoto não autorizado para este evento.".to_string());
    }
    remote_control::inject_os_input(&event)
}
