#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
#[allow(dead_code)]
mod core;
#[allow(dead_code)]
mod media;
mod os;

use std::time::Duration;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WindowEvent};
use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};

use crate::commands::{sync_global_shortcuts, DesktopState, DetectedGameDto};
use crate::core::config::AppConfig;
use crate::core::deep_link::{parse_deep_link, DeepLinkTarget};
use crate::os::autostart;
use crate::os::keybinds::KeybindActionKind;
use crate::os::remote_control::{RemoteControlState, PANIC_HOTKEY};
use crate::os::updater::{self, UpdateCheckState};

const MENU_OPEN: &str = "open";
const MENU_TOGGLE_OVERLAY: &str = "toggle_overlay";
const MENU_SWITCH_INSTANCE: &str = "switch_instance";
const MENU_RELOAD: &str = "reload";
const MENU_AUTOSTART: &str = "autostart";
const MENU_CHECK_UPDATES: &str = "check_updates";
const MENU_QUIT: &str = "quit";

fn launcher_switch_url() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "http://tauri.localhost/?switch=1"
    }
    #[cfg(not(target_os = "windows"))]
    {
        "tauri://localhost/?switch=1"
    }
}

fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = app.emit("balacopapo://window-visibility", true);
    }
}

fn resolve_deep_link_url(target: &DeepLinkTarget, configured_instance: Option<&str>) -> Option<String> {
    match target {
        DeepLinkTarget::OidcCallback { token, instance } => {
            let base = instance.as_deref().or(configured_instance)?;
            let base = base.trim_end_matches('/');
            Some(format!("{base}/auth/callback?token={token}"))
        }
        DeepLinkTarget::Invite { code, instance } => {
            let base = instance.as_deref().or(configured_instance)?;
            let base = base.trim_end_matches('/');
            Some(format!("{base}/invite/{code}"))
        }
        DeepLinkTarget::InternalRoute { path } => {
            let base = configured_instance?.trim_end_matches('/');
            let normalized_path = if path.starts_with('/') {
                path.clone()
            } else {
                format!("/{path}")
            };
            Some(format!("{base}{normalized_path}"))
        }
    }
}

fn handle_deep_link_args(app: &AppHandle, args: &[String]) {
    let Some(target) = args.iter().skip(1).find_map(|arg| parse_deep_link(arg)) else {
        return;
    };

    let configured = app
        .state::<DesktopState>()
        .config
        .lock()
        .ok()
        .and_then(|c| c.instance_url.clone());

    if let Some(dest) = resolve_deep_link_url(&target, configured.as_deref()) {
        if let (Some(window), Ok(parsed)) = (app.get_webview_window("main"), tauri::Url::parse(&dest)) {
            let _ = window.navigate(parsed);
        }
    }
    focus_main_window(app);
}

fn navigate_window(window: &WebviewWindow, raw_url: &str) {
    if let Ok(parsed) = tauri::Url::parse(raw_url) {
        let _ = window.navigate(parsed);
    }
}

fn build_init_script() -> String {
    let version = env!("CARGO_PKG_VERSION");
    let sha = option_env!("BALACOPAPO_BUILD_SHA").unwrap_or("");
    let platform = std::env::consts::OS;

    format!(
        r#"
        (function() {{
          window.__BALACOPAPO_DESKTOP__ = {{
            version: "{version}",
            buildSha: "{sha}",
            platform: "{platform}",
            architecture: "tauri-v2-hybrid",
            capabilities: {{
              isolatedAudio: true,
              inGameOverlay: true,
              nativeScreenShare: true,
              globalKeybinds: true,
              safeRemoteControl: true,
              gamePresence: true,
              nativeNotifications: true,
              silentUpdater: true
            }}
          }};

          const style = document.createElement("style");
          style.textContent = "html.bp-bg-paused *, html.bp-bg-paused *::before, html.bp-bg-paused *::after {{ animation-play-state: paused !important; transition: none !important; }}";
          (document.head || document.documentElement).appendChild(style);

          if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.listen) {{
            window.__TAURI__.event.listen("balacopapo://window-visibility", function(ev) {{
              document.documentElement.classList.toggle("bp-bg-paused", ev.payload === false);
            }});
          }}
        }})();
        "#
    )
}

#[cfg(target_os = "linux")]
fn apply_linux_graphics_guardrails() {
    // Evita tela branca/preta no WebKitGTK com GPUs NVIDIA sob Wayland (Fedora / CachyOS).
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
        && std::path::Path::new("/proc/driver/nvidia/version").exists()
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

fn spawn_game_presence_scanner(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Espera inicial para não competir com o boot; depois escaneia a cada 12s (0% CPU dormindo).
        tokio::time::sleep(Duration::from_secs(8)).await;
        loop {
            let (enabled, ignored, manual_override) = {
                let state = app.state::<DesktopState>();
                let res = if let Ok(cfg) = state.config.lock() {
                    (
                        cfg.game_presence_enabled,
                        cfg.ignored_games.clone(),
                        cfg.manual_game_override.clone(),
                    )
                } else {
                    (false, Vec::new(), None)
                };
                res
            };

            let detected = if !enabled {
                None
            } else if let Some(manual) = manual_override {
                Some(DetectedGameDto {
                    process_name: "manual".to_string(),
                    display_name: manual,
                })
            } else {
                os::activity::scan_running_game(&ignored).map(Into::into)
            };

            let changed = {
                let state = app.state::<DesktopState>();
                let res = if let Ok(mut guard) = state.last_detected_game.lock() {
                    if *guard != detected {
                        *guard = detected.clone();
                        true
                    } else {
                        false
                    }
                } else {
                    false
                };
                res
            };

            if changed {
                let _ = app.emit("balacopapo://game-presence", detected);
            }

            tokio::time::sleep(Duration::from_secs(12)).await;
        }
    });
}

fn handle_global_shortcut_pressed(app: &AppHandle, shortcut: &Shortcut) {
    // 1. Atalho de pânico (Ctrl+Alt+Escape) tem prioridade absoluta para cortar Controle Remoto.
    if PANIC_HOTKEY.parse::<Shortcut>().ok().as_ref() == Some(shortcut) {
        let was_active = {
            let state = app.state::<DesktopState>();
            let res = if let Ok(mut guard) = state.remote_control.lock() {
                let active = !matches!(*guard, RemoteControlState::Idle);
                guard.panic_revoke();
                active
            } else {
                false
            };
            res
        };
        if was_active {
            let _ = app.emit("balacopapo://remote-control-state", RemoteControlState::Idle);
            if os::overlay::is_overlay_active(app) {
                os::overlay::emit_toast(
                    app,
                    os::overlay::OverlayToastPayload {
                        title: "Controle Remoto CORTADO".to_string(),
                        body: "Atalho de pânico acionado com sucesso.".to_string(),
                        kind: "warning".to_string(),
                        duration_ms: 3_000,
                    },
                );
            }
        }
        return;
    }

    // 2. Verifica atalhos de voz / overlay / soundboard configurados pelo usuário.
    let matched = {
        let state = app.state::<DesktopState>();
        state.keybinds.lock().ok().and_then(|list| {
            list.iter()
                .filter(|e| e.enabled)
                .find(|e| e.shortcut.trim().parse::<Shortcut>().ok().as_ref() == Some(shortcut))
                .map(|e| e.action.clone())
        })
    };

    let Some(action) = matched else {
        return;
    };

    if matches!(action, KeybindActionKind::ToggleOverlay) {
        if os::overlay::is_overlay_active(app) {
            os::overlay::destroy_overlay_window(app);
            if let Ok(mut guard) = app.state::<DesktopState>().overlay_config.lock() {
                guard.enabled = false;
            }
        } else {
            let mut cfg = if let Ok(guard) = app.state::<DesktopState>().overlay_config.lock() {
                guard.clone()
            } else {
                os::overlay::OverlayConfig::default()
            };
            cfg.enabled = true;
            if os::overlay::ensure_overlay_window(app, &cfg).is_ok() {
                if let Ok(mut guard) = app.state::<DesktopState>().overlay_config.lock() {
                    *guard = cfg;
                }
            }
        }
    }

    let _ = app.emit("balacopapo://keybind-triggered", action);
}

fn spawn_background_updater(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Aguarda 15s após o boot para não competir com o carregamento inicial nem com jogos.
        tokio::time::sleep(Duration::from_secs(15)).await;
        loop {
            let state = updater::check_and_stage_update().await;
            if let Ok(mut guard) = app.state::<DesktopState>().update_state.lock() {
                *guard = state.clone();
            }
            if matches!(
                state,
                UpdateCheckState::ReadyToRestart { .. }
                    | UpdateCheckState::AvailableManual { .. }
            ) {
                let _ = app.emit("balacopapo://update-status", state);
            }
            tokio::time::sleep(Duration::from_secs(30 * 60)).await;
        }
    });
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let open_item = MenuItem::with_id(app, MENU_OPEN, "Abrir Balacopapo", true, None::<&str>)?;
    let overlay_item = MenuItem::with_id(
        app,
        MENU_TOGGLE_OVERLAY,
        "Alternar Overlay In-Game",
        true,
        None::<&str>,
    )?;
    let switch_item = MenuItem::with_id(
        app,
        MENU_SWITCH_INSTANCE,
        "Trocar instância...",
        true,
        None::<&str>,
    )?;
    let reload_item = MenuItem::with_id(app, MENU_RELOAD, "Recarregar página", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let autostart_item = CheckMenuItem::with_id(
        app,
        MENU_AUTOSTART,
        "Iniciar com o sistema",
        true,
        autostart::is_enabled(),
        None::<&str>,
    )?;
    let update_item = MenuItem::with_id(
        app,
        MENU_CHECK_UPDATES,
        "Verificar atualizações",
        true,
        None::<&str>,
    )?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, MENU_QUIT, "Sair do Balacopapo", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &open_item,
            &overlay_item,
            &switch_item,
            &reload_item,
            &sep1,
            &autostart_item,
            &update_item,
            &sep2,
            &quit_item,
        ],
    )?;

    let mut builder = TrayIconBuilder::new()
        .tooltip("Balacopapo Desktop")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                focus_main_window(tray.app_handle());
            }
        })
        .on_menu_event(move |app, event| match event.id.as_ref() {
            MENU_OPEN => focus_main_window(app),
            MENU_TOGGLE_OVERLAY => {
                if os::overlay::is_overlay_active(app) {
                    os::overlay::destroy_overlay_window(app);
                    if let Ok(mut guard) = app.state::<DesktopState>().overlay_config.lock() {
                        guard.enabled = false;
                    }
                } else {
                    let mut cfg = if let Ok(guard) = app.state::<DesktopState>().overlay_config.lock() {
                        guard.clone()
                    } else {
                        os::overlay::OverlayConfig::default()
                    };
                    cfg.enabled = true;
                    if os::overlay::ensure_overlay_window(app, &cfg).is_ok() {
                        if let Ok(mut guard) = app.state::<DesktopState>().overlay_config.lock() {
                            *guard = cfg;
                        }
                        os::overlay::emit_toast(
                            app,
                            os::overlay::OverlayToastPayload {
                                title: "Overlay In-Game ativado".to_string(),
                                body: "Click-through ativo e invisível na transmissão.".to_string(),
                                kind: "info".to_string(),
                                duration_ms: 2_800,
                            },
                        );
                    }
                }
            }
            MENU_SWITCH_INSTANCE => {
                if let Some(window) = app.get_webview_window("main") {
                    navigate_window(&window, launcher_switch_url());
                }
                focus_main_window(app);
            }
            MENU_RELOAD => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.eval("window.location.reload()");
                }
            }
            MENU_AUTOSTART => {
                let next = !autostart::is_enabled();
                if autostart::set_enabled(next).is_ok() {
                    let _ = autostart_item.set_checked(autostart::is_enabled());
                }
            }
            MENU_CHECK_UPDATES => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let result = updater::check_and_stage_update().await;
                    if let Ok(mut guard) = handle.state::<DesktopState>().update_state.lock() {
                        *guard = result.clone();
                    }
                    let _ = handle.emit("balacopapo://update-status", result.clone());
                    if let UpdateCheckState::ReadyToRestart { version, .. } = result {
                        os::notifications::send_desktop_notification(
                            "Atualização pronta".to_string(),
                            format!(
                                "Balacopapo {version} foi baixado em segundo plano e será aplicado ao reiniciar."
                            ),
                        );
                    }
                });
            }
            MENU_QUIT => {
                app.state::<DesktopState>().isolated_audio.stop();
                app.state::<DesktopState>().native_screen_share.stop();
                os::overlay::destroy_overlay_window(app);
                app.exit(0);
            }
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

fn main() {
    // 1. Aplica atualização já baixada na sessão anterior antes de abrir qualquer janela.
    os::updater::apply_staged_on_startup();
    // 2. Registra protocolo balacopapo:// sem precisar de permissão de administrador.
    os::protocol::register_url_scheme();

    #[cfg(target_os = "linux")]
    apply_linux_graphics_guardrails();

    let config = AppConfig::load();
    let initial_args: Vec<String> = std::env::args().collect();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            handle_deep_link_args(app, &args);
            focus_main_window(app);
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        handle_global_shortcut_pressed(app, shortcut);
                    }
                })
                .build(),
        )
        .manage(DesktopState::new(config.clone()))
        .invoke_handler(tauri::generate_handler![
            commands::get_desktop_info,
            commands::set_instance_url,
            commands::clear_instance_url,
            commands::set_autostart,
            commands::send_native_notification,
            commands::open_external_url,
            commands::check_updates_now,
            commands::apply_update_and_restart,
            commands::scan_active_game,
            commands::list_audio_targets,
            commands::start_isolated_audio,
            commands::stop_isolated_audio,
            commands::get_isolated_audio_status,
            commands::get_overlay_config,
            commands::show_overlay,
            commands::hide_overlay,
            commands::update_overlay_config,
            commands::push_overlay_pointer,
            commands::set_overlay_speakers,
            commands::push_overlay_toast,
            commands::list_capture_sources,
            commands::detect_hardware_encoders,
            commands::start_native_screen_share,
            commands::stop_native_screen_share,
            commands::get_native_screen_share_status,
            commands::get_keybinds,
            commands::set_keybinds,
            commands::get_game_presence_config,
            commands::set_game_presence_config,
            commands::get_current_game_presence,
            commands::get_remote_control_state,
            commands::request_remote_control,
            commands::approve_remote_control,
            commands::revoke_remote_control,
            commands::inject_remote_input,
        ])
        .setup(move |app| {
            setup_tray(app.handle())?;

            let initial_url = initial_args
                .iter()
                .skip(1)
                .find_map(|arg| parse_deep_link(arg))
                .and_then(|target| resolve_deep_link_url(&target, config.instance_url.as_deref()))
                .or_else(|| config.instance_url.clone());

            let webview_url = match initial_url.as_deref().and_then(|u| tauri::Url::parse(u).ok()) {
                Some(external) => WebviewUrl::External(external),
                None => WebviewUrl::App("index.html".into()),
            };

            let main_window = tauri::WebviewWindowBuilder::new(app.handle(), "main", webview_url)
                .title("Balacopapo")
                .inner_size(1280.0, 820.0)
                .min_inner_size(960.0, 620.0)
                .resizable(true)
                .background_color(tauri::window::Color(14, 16, 21, 255))
                .initialization_script(build_init_script())
                .build()?;

            let handle_for_events = app.handle().clone();
            main_window.on_window_event(move |event| match event {
                WindowEvent::CloseRequested { api, .. } => {
                    // Fecha para a bandeja (0% UI em jogos) em vez de matar a chamada.
                    api.prevent_close();
                    if let Some(win) = handle_for_events.get_webview_window("main") {
                        let _ = win.hide();
                    }
                    let _ = handle_for_events.emit("balacopapo://window-visibility", false);
                }
                WindowEvent::Focused(focused) => {
                    let _ = handle_for_events.emit("balacopapo://window-visibility", *focused);
                }
                _ => {}
            });

            if let Ok(entries) = app.state::<DesktopState>().keybinds.lock() {
                sync_global_shortcuts(app.handle(), &entries);
            }
            spawn_game_presence_scanner(app.handle().clone());
            spawn_background_updater(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Falha fatal ao iniciar o Balacopapo Desktop");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_deep_links_for_configured_instance() {
        let base = Some("https://chat.balacopapo.com/");
        assert_eq!(
            resolve_deep_link_url(
                &DeepLinkTarget::Invite {
                    code: "abc123".to_string(),
                    instance: None,
                },
                base
            ),
            Some("https://chat.balacopapo.com/invite/abc123".to_string())
        );
        assert_eq!(
            resolve_deep_link_url(
                &DeepLinkTarget::OidcCallback {
                    token: "tok".to_string(),
                    instance: Some("https://other.example.com".to_string()),
                },
                base
            ),
            Some("https://other.example.com/auth/callback?token=tok".to_string())
        );
    }
}
