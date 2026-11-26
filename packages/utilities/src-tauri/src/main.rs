#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

struct WorkerState(Mutex<Option<Child>>);

impl WorkerState {
    fn kill(&self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn spawn_worker() -> Option<Child> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();

    #[cfg(target_os = "windows")]
    let bundled_node = exe_dir.join("runtime").join("node.exe");
    #[cfg(not(target_os = "windows"))]
    let bundled_node = exe_dir.join("runtime").join("bin").join("node");

    let bundled_entry = exe_dir.join("app").join("dist").join("index.js");

    let (node_bin, entry, workdir): (PathBuf, PathBuf, PathBuf) =
        if bundled_node.exists() && bundled_entry.exists() {
            (bundled_node, bundled_entry, exe_dir.join("app"))
        } else {
            // Modo desenvolvimento local (`cargo run` dentro de packages/utilities/src-tauri)
            let dev_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or(exe_dir);
            (
                PathBuf::from("node"),
                dev_root.join("dist").join("index.js"),
                dev_root,
            )
        };

    let mut cmd = Command::new(&node_bin);
    cmd.arg(&entry)
        .arg("--no-browser")
        .current_dir(&workdir);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.spawn().ok()
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

fn main() {
    let worker = spawn_worker();

    tauri::Builder::default()
        .manage(WorkerState(Mutex::new(worker)))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .setup(|app| {
            // Bandeja do sistema (System Tray)
            let open_i = MenuItem::with_id(app, "open", "Abrir Balacopapo Utilidades", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &quit_i])?;

            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Balacopapo Utilidades — Bot de Música")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => {
                        app.state::<WorkerState>().kill();
                        app.exit(0);
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
                        show_main(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon().cloned() {
                tray = tray.icon(icon);
            }
            tray.build(app)?;

            // Aguarda o servidor local na porta 47821 ficar pronto e navega a janela principal
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                for _ in 0..80 {
                    if TcpStream::connect("127.0.0.1:47821").is_ok() {
                        if let Some(win) = handle.get_webview_window("main") {
                            if let Ok(url) = "http://127.0.0.1:47821/".parse() {
                                let _ = win.navigate(url);
                            }
                        }
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(200));
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Fecha para a bandeja para o bot continuar tocando música
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("erro ao iniciar Balacopapo Utilidades")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<WorkerState>().kill();
            }
        });
}
