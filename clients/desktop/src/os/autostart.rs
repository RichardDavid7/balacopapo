//! Auto-start nativo com o Sistema Operacional (Windows HKCU Run / Linux XDG Autostart).

#[cfg(target_os = "windows")]
pub fn is_enabled() -> bool {
    std::process::Command::new("reg")
        .args([
            "query",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
            "/v",
            "Balacopapo",
        ])
        .output()
        .is_ok_and(|o| o.status.success())
}

#[cfg(target_os = "windows")]
pub fn set_enabled(enable: bool) -> Result<(), String> {
    if enable {
        let exe = std::env::current_exe()
            .map_err(|e| format!("Não foi possível localizar executável: {e}"))?;
        let val = format!("\"{}\"", exe.display());
        let status = std::process::Command::new("reg")
            .args([
                "add",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v",
                "Balacopapo",
                "/t",
                "REG_SZ",
                "/d",
                &val,
                "/f",
            ])
            .status()
            .map_err(|e| format!("Falha ao registrar auto-start: {e}"))?;
        if status.success() {
            Ok(())
        } else {
            Err("Registro do Windows recusou a chave de auto-start.".to_string())
        }
    } else {
        let _ = std::process::Command::new("reg")
            .args([
                "delete",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v",
                "Balacopapo",
                "/f",
            ])
            .status();
        Ok(())
    }
}

#[cfg(target_os = "linux")]
fn linux_autostart_path() -> Option<std::path::PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(std::path::PathBuf::from(home).join(".config/autostart/balacopapo.desktop"))
}

#[cfg(target_os = "linux")]
pub fn is_enabled() -> bool {
    linux_autostart_path().is_some_and(|p| p.exists())
}

#[cfg(target_os = "linux")]
pub fn set_enabled(enable: bool) -> Result<(), String> {
    let Some(path) = linux_autostart_path() else {
        return Err("Variável HOME não definida.".to_string());
    };
    if enable {
        let exe = std::env::current_exe()
            .map_err(|e| format!("Não foi possível localizar executável: {e}"))?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let desktop = format!(
            "[Desktop Entry]\nType=Application\nName=Balacopapo\nExec=\"{}\"\nX-GNOME-Autostart-enabled=true\n",
            exe.display()
        );
        std::fs::write(&path, desktop).map_err(|e| format!("Erro ao criar autostart: {e}"))
    } else {
        let _ = std::fs::remove_file(&path);
        Ok(())
    }
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
pub fn is_enabled() -> bool {
    false
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
pub fn set_enabled(_enable: bool) -> Result<(), String> {
    Ok(())
}
