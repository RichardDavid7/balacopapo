mod commands;
mod config;
mod tray;
mod updater;

use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;

use crate::config::ConfigState;
use crate::tray::RuntimeState;
use crate::updater::UpdaterState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let raw_args: Vec<String> = std::env::args().collect();
    let start_hidden_arg = raw_args.iter().any(|a| a == "--hidden");
    let initial_deep_link = tray::extract_deep_link(&raw_args);

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(url) = tray::extract_deep_link(&args) {
                tray::handle_deep_link(app, url);
            } else {
                let _ = tray::open_or_focus_main_window(app, false);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            let handle = app.handle();

            let cfg_state = ConfigState::load(handle);
            let cfg_snapshot = cfg_state.snapshot();
            let updater_state = UpdaterState::new(cfg_snapshot.dismissed_update_version.clone());

            let runtime = RuntimeState::default();
            if let Some(url) = initial_deep_link.clone() {
                if let Ok(mut slot) = runtime.pending_deep_link.lock() {
                    *slot = Some(url);
                }
            }

            app.manage(cfg_state);
            app.manage(updater_state);
            app.manage(runtime);

            tray::setup_tray(handle)?;

            let should_start_hidden =
                start_hidden_arg && cfg_snapshot.start_minimized && initial_deep_link.is_none();
            if !should_start_hidden {
                tray::open_or_focus_main_window(handle, false)?;
            }

            // Verifica atualizações silenciosamente após o boot (sem travar a abertura).
            let handle_for_update = handle.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(6)).await;
                updater::spawn_check_for_updates(handle_for_update);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::window_minimize,
            commands::window_toggle_maximize,
            commands::window_close_to_tray,
            commands::get_standby_mode,
            commands::set_standby_mode,
            commands::hibernate_now,
            commands::get_instance_url,
            commands::set_instance_url,
            commands::clear_instance_url,
            commands::set_connected_origins,
            commands::show_notification,
            commands::set_badge_count,
            commands::set_language,
            commands::get_auto_launch_settings,
            commands::set_auto_launch_settings,
            commands::get_app_version,
            commands::get_update_status,
            commands::is_sandboxed,
            commands::check_for_updates,
            commands::install_update,
            commands::dismiss_update,
            commands::open_release_page,
            commands::renderer_ready,
            commands::get_recovery_state,
            commands::recovery_action,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao executar Balacopapo Desktop");
}
