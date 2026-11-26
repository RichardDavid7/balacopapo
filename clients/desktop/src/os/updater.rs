//! Auto-Updater silencioso e nativo (Windows & Linux — Fedora / CachyOS):
//! - Ao abrir o app, limpa qualquer `.old` anterior e aplica imediatamente se já houver
//!   uma atualização baixada em segundo plano na sessão anterior (zero interação).
//! - Com o app aberto, verifica e baixa a nova versão silenciosamente em background.
//!   Quando pronta, exibe apenas um botãozinho discreto (`↑ vX.Y.Z`) para reiniciar e aplicar.

use futures_util::SinkExt;
use iced::Subscription;
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use crate::core::config::{DEFAULT_RELEASES_API, DEFAULT_RELEASES_PAGE};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateCheckState {
    #[allow(dead_code)]
    Idle,
    Checking,
    UpToDate,
    #[allow(dead_code)]
    Downloading {
        version: String,
    },
    /// Atualização já baixada e validada no disco — botãozinho discreto para reiniciar e aplicar.
    ReadyToRestart {
        version: String,
        staged_path: PathBuf,
    },
    /// Fallback quando a release ainda não tem binário direto para este SO.
    AvailableManual {
        version: String,
        release_url: String,
    },
    Failed(String),
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    #[serde(default)]
    name: String,
    html_url: Option<String>,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

fn is_update_candidate(release: &GithubRelease) -> Option<String> {
    let current = env!("CARGO_PKG_VERSION");
    if is_newer_version(current, &release.tag_name) {
        return Some(release.tag_name.clone());
    }
    if release.tag_name == "desktop-edge" {
        if let Some(build_sha) = option_env!("BALACOPAPO_BUILD_SHA") {
            let trimmed = build_sha.trim();
            if !trimmed.is_empty() && !release.name.contains(trimmed) {
                return Some(release.name.clone());
            }
        }
    }
    None
}

pub fn parse_semver(raw: &str) -> Option<(u64, u64, u64)> {
    let cleaned = raw.trim().trim_start_matches('v');
    let core = cleaned.split('-').next()?;
    let mut parts = core.split('.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next()?.parse::<u64>().ok()?;
    let patch = parts.next()?.parse::<u64>().ok()?;
    Some((major, minor, patch))
}

pub fn is_newer_version(current: &str, candidate: &str) -> bool {
    match (parse_semver(current), parse_semver(candidate)) {
        (Some(cur), Some(cand)) => cand > cur,
        _ => false,
    }
}

fn staged_update_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let mut name = exe.file_name()?.to_os_string();
    name.push(".update");
    Some(exe.with_file_name(name))
}

fn old_backup_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let mut name = exe.file_name()?.to_os_string();
    name.push(".old");
    Some(exe.with_file_name(name))
}

/// Remove silenciosamente o binário `.old` deixado por uma atualização anterior.
pub fn cleanup_old_binary() {
    if let Some(old) = old_backup_path() {
        let _ = fs::remove_file(old);
    }
}

/// Se uma atualização já foi baixada silenciosamente na sessão anterior, aplica antes de abrir a janela.
pub fn apply_staged_on_startup() {
    cleanup_old_binary();
    let Some(staged) = staged_update_path() else {
        return;
    };
    if !staged.exists() {
        return;
    }
    if install_and_restart(&staged).is_err() {
        let _ = fs::remove_file(staged);
    }
}

/// Verifica se os bytes baixados possuem cabeçalho executável válido (PE `MZ` no Windows, `\x7fELF` no Linux).
pub fn has_valid_executable_magic(bytes: &[u8]) -> bool {
    #[cfg(target_os = "windows")]
    {
        bytes.len() > 64 && bytes.starts_with(b"MZ")
    }
    #[cfg(target_os = "linux")]
    {
        bytes.len() > 64 && bytes.starts_with(b"\x7fELF")
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        bytes.len() > 64
    }
}

fn select_platform_asset(assets: &[GithubAsset]) -> Option<&GithubAsset> {
    #[cfg(target_os = "windows")]
    let suffix = "-windows-x64.exe";
    #[cfg(target_os = "linux")]
    let suffix = "-linux-x64";
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    let suffix = "-macos";

    assets
        .iter()
        .find(|a| a.name.ends_with(suffix) && !a.name.ends_with(".tar.gz") && !a.name.ends_with(".zip"))
}

/// Verifica e já baixa silenciosamente a nova versão em segundo plano (sem interromper o usuário).
pub async fn check_and_stage_update() -> UpdateCheckState {
    let client = match reqwest::Client::builder()
        .user_agent(format!("Balacopapo-Desktop/{}", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(60))
        .build()
    {
        Ok(c) => c,
        Err(e) => return UpdateCheckState::Failed(format!("HTTP indisponível: {e}")),
    };

    let resp = match client.get(DEFAULT_RELEASES_API).send().await {
        Ok(r) => r,
        Err(e) => return UpdateCheckState::Failed(format!("Sem acesso ao GitHub: {e}")),
    };

    if !resp.status().is_success() {
        return UpdateCheckState::Failed(format!("GitHub HTTP {}", resp.status().as_u16()));
    }

    let releases = match resp.json::<Vec<GithubRelease>>().await {
        Ok(r) => r,
        Err(e) => return UpdateCheckState::Failed(format!("Resposta inválida: {e}")),
    };

    // Encontra a release mais recente que tenha artefato do Balacopapo Desktop (estável v* ou desktop-edge).
    let candidate = releases.into_iter().find_map(|rel| {
        let has_desktop_asset = select_platform_asset(&rel.assets).is_some()
            || rel.tag_name == "desktop-edge"
            || rel.tag_name.starts_with('v');
        if !has_desktop_asset {
            return None;
        }
        is_update_candidate(&rel).map(|label| (rel, label))
    });

    let Some((release, version_label)) = candidate else {
        return UpdateCheckState::UpToDate;
    };

    let release_url = release
        .html_url
        .unwrap_or_else(|| DEFAULT_RELEASES_PAGE.to_string());

    let Some(asset) = select_platform_asset(&release.assets) else {
        return UpdateCheckState::AvailableManual {
            version: version_label,
            release_url,
        };
    };

    let Some(staged_path) = staged_update_path() else {
        return UpdateCheckState::AvailableManual {
            version: version_label,
            release_url,
        };
    };

    // Baixa silenciosamente em segundo plano
    let bin_resp = match client.get(&asset.browser_download_url).send().await {
        Ok(r) if r.status().is_success() => r,
        _ => {
            return UpdateCheckState::AvailableManual {
                version: version_label,
                release_url,
            };
        }
    };

    let Ok(bytes) = bin_resp.bytes().await else {
        return UpdateCheckState::AvailableManual {
            version: version_label,
            release_url,
        };
    };

    if !has_valid_executable_magic(&bytes) {
        return UpdateCheckState::AvailableManual {
            version: version_label,
            release_url,
        };
    }

    if fs::write(&staged_path, &bytes).is_err() {
        return UpdateCheckState::AvailableManual {
            version: version_label,
            release_url,
        };
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&staged_path, fs::Permissions::from_mode(0o755));
    }

    UpdateCheckState::ReadyToRestart {
        version: version_label,
        staged_path,
    }
}

/// Substitui atomicamente o executável em uso pelo binário baixado e reinicia o app.
pub fn install_and_restart(staged_path: &Path) -> Result<(), String> {
    let current_exe =
        std::env::current_exe().map_err(|e| format!("Não foi possível localizar executável: {e}"))?;
    let backup = old_backup_path().ok_or_else(|| "Caminho de backup inválido.".to_string())?;

    let _ = fs::remove_file(&backup);
    fs::rename(&current_exe, &backup)
        .map_err(|e| format!("Falha ao preparar troca do binário: {e}"))?;

    if let Err(err) = fs::rename(staged_path, &current_exe) {
        // Reverte se a segunda troca falhar
        let _ = fs::rename(&backup, &current_exe);
        return Err(format!("Falha ao aplicar atualização: {err}"));
    }

    Command::new(&current_exe)
        .spawn()
        .map_err(|e| format!("Falha ao reiniciar versão atualizada: {e}"))?;

    std::process::exit(0);
}

/// Verifica e baixa atualizações silenciosamente a cada 30 min enquanto o app estiver aberto
/// (0% CPU dormindo no timer assíncrono do Tokio).
pub fn periodic_check_subscription() -> Subscription<UpdateCheckState> {
    Subscription::run_with_id(
        "balacopapo-silent-updater",
        iced::stream::channel(4, |mut output| async move {
            loop {
                tokio::time::sleep(Duration::from_secs(30 * 60)).await;
                let state = check_and_stage_update().await;
                if matches!(
                    state,
                    UpdateCheckState::ReadyToRestart { .. }
                        | UpdateCheckState::AvailableManual { .. }
                ) {
                    let _ = output.send(state).await;
                }
            }
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_semver_correctly() {
        assert!(is_newer_version("0.2.0", "v0.3.0"));
        assert!(is_newer_version("0.2.0", "v0.2.1"));
        assert!(!is_newer_version("0.2.0", "v0.2.0"));
        assert!(!is_newer_version("0.2.0", "v0.1.9"));
        assert!(is_newer_version("0.2.0", "v1.0.0-alpha.1"));
    }

    #[test]
    fn rejects_corrupt_or_empty_binary_magic() {
        assert!(!has_valid_executable_magic(b"<html>not a binary</html>"));
        assert!(!has_valid_executable_magic(b""));
    }
}
