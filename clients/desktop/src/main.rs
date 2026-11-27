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

use crate::commands::DesktopState;
use crate::core::config::AppConfig;
use crate::core::deep_link::{parse_deep_link, DeepLinkTarget};
use crate::os::autostart;
use crate::os::updater::{self, UpdateCheckState};

const MENU_OPEN: &str = "open";
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
              isolatedAudio: false,
              inGameOverlay: false,
              nativeScreenShare: false,
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
