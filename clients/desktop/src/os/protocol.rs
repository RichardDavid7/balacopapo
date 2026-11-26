//! Registro automático do esquema `balacopapo://` ("Abrir com Balacopapo") sem precisar de Admin.
//! - Windows: grava `HKCU\Software\Classes\balacopapo` apontando para o executável atual.
//! - Linux (Fedora / CachyOS): cria `~/.local/share/applications/balacopapo-desktop.desktop`.

pub fn register_url_scheme() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let exe_str = exe.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    register_windows_hkcu(&exe_str);

    #[cfg(target_os = "linux")]
    register_linux_desktop_entry(&exe_str);

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    let _ = exe_str;
}

#[cfg(target_os = "windows")]
fn register_windows_hkcu(exe_path: &str) {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let cmd_value = format!("\"{exe_path}\" \"%1\"");
    let icon_value = format!("\"{exe_path}\",0");

    let ops: &[&[&str]] = &[
        &[
            "add",
            r"HKCU\Software\Classes\balacopapo",
            "/ve",
            "/d",
            "URL:Balacopapo Protocol",
            "/f",
        ],
        &[
            "add",
            r"HKCU\Software\Classes\balacopapo",
            "/v",
            "URL Protocol",
            "/d",
            "",
            "/f",
        ],
        &[
            "add",
            r"HKCU\Software\Classes\balacopapo\DefaultIcon",
            "/ve",
            "/d",
            &icon_value,
            "/f",
        ],
        &[
            "add",
            r"HKCU\Software\Classes\balacopapo\shell\open\command",
            "/ve",
            "/d",
            &cmd_value,
            "/f",
        ],
    ];

    for args in ops {
        let _ = Command::new("reg.exe")
            .args(*args)
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
}

#[cfg(target_os = "linux")]
fn register_linux_desktop_entry(exe_path: &str) {
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;

    let Some(home) = std::env::var_os("HOME") else {
        return;
    };
    let apps_dir = PathBuf::from(home).join(".local/share/applications");
    let _ = fs::create_dir_all(&apps_dir);
    let desktop_file = apps_dir.join("balacopapo-desktop.desktop");
    let content = format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=Balacopapo\n\
         Comment=Cliente desktop nativo do Balacopapo\n\
         Exec=\"{exe_path}\" %u\n\
         Terminal=false\n\
         Categories=Network;Chat;\n\
         MimeType=x-scheme-handler/balacopapo;\n"
    );
    if fs::write(&desktop_file, content).is_ok() {
        let _ = Command::new("xdg-mime")
            .args([
                "default",
                "balacopapo-desktop.desktop",
                "x-scheme-handler/balacopapo",
            ])
            .output();
    }
}
