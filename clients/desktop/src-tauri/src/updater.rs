use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

use crate::config::ConfigState;

/// Contrato idêntico ao `packages/desktop/src/updateStatus.ts` do Backspace.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "phase", rename_all = "kebab-case")]
pub enum UpdateStatus {
    Idle,
    Checking,
    Available {
        version: String,
    },
    Downloading {
        version: String,
        percent: f64,
        #[serde(rename = "bytesPerSecond")]
        bytes_per_second: u64,
    },
    Ready {
        version: String,
    },
    Failed {
        version: Option<String>,
        message: String,
    },
    UpToDate {
        #[serde(rename = "checkedAt")]
        checked_at: u64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSnapshot {
    /// "auto" | "manual" | "external"
    pub capability: String,
    pub dismissed_version: Option<String>,
    pub status: UpdateStatus,
}

pub struct UpdaterState {
    inner: Mutex<UpdateSnapshot>,
}

impl UpdaterState {
    pub fn new(dismissed_version: Option<String>) -> Self {
        let capability = detect_update_capability();
        Self {
            inner: Mutex::new(UpdateSnapshot {
                capability,
                dismissed_version,
                status: UpdateStatus::Idle,
            }),
        }
    }

    pub fn snapshot(&self) -> UpdateSnapshot {
        self.inner
            .lock()
            .map(|g| g.clone())
            .unwrap_or(UpdateSnapshot {
                capability: "manual".to_string(),
                dismissed_version: None,
                status: UpdateStatus::Idle,
            })
    }

    pub fn set_status(&self, app: &AppHandle, status: UpdateStatus) {
        let snap = {
            let mut guard = match self.inner.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            guard.status = status;
            guard.clone()
        };
        let _ = app.emit("update-status-changed", &snap);
    }

    pub fn set_dismissed(&self, app: &AppHandle, version: Option<String>) {
        let snap = {
            let mut guard = match self.inner.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            guard.dismissed_version = version;
            guard.clone()
        };
        let _ = app.emit("update-status-changed", &snap);
    }
}

/// Flatpak/Snap no Linux são gerenciados externamente; builds normais Win/Linux usam auto-update.
pub fn detect_update_capability() -> String {
    if std::env::var_os("FLATPAK_ID").is_some() || std::env::var_os("SNAP").is_some() {
        return "external".to_string();
    }
    "auto".to_string()
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Dispara verificação + download automático em segundo plano (Windows e Linux).
pub fn spawn_check_for_updates(app: AppHandle) {
    let updater_state = app.state::<UpdaterState>();
    if updater_state.snapshot().capability == "external" {
        return;
    }

    tauri::async_runtime::spawn(async move {
        let state = app.state::<UpdaterState>();
        state.set_status(&app, UpdateStatus::Checking);

        let updater = match app.updater() {
            Ok(u) => u,
            Err(err) => {
                state.set_status(
                    &app,
                    UpdateStatus::Failed {
                        version: None,
                        message: format!("Updater indisponível: {err}"),
                    },
                );
                return;
            }
        };

        match updater.check().await {
            Ok(Some(update)) => {
                let version = update.version.clone();
                state.set_status(
                    &app,
                    UpdateStatus::Available {
                        version: version.clone(),
                    },
                );

                let app_for_progress = app.clone();
                let version_for_progress = version.clone();
                let mut downloaded: u64 = 0;

                let download_res = update
                    .download(
                        move |chunk_len, content_len| {
                            downloaded = downloaded.saturating_add(chunk_len as u64);
                            let percent = content_len
                                .filter(|&total| total > 0)
                                .map(|total| (downloaded as f64 / total as f64) * 100.0)
                                .unwrap_or(0.0);
                            let st = app_for_progress.state::<UpdaterState>();
                            st.set_status(
                                &app_for_progress,
                                UpdateStatus::Downloading {
                                    version: version_for_progress.clone(),
                                    percent,
                                    bytes_per_second: 0,
                                },
                            );
                        },
                        || {},
                    )
                    .await;

                match download_res {
                    Ok(_bytes) => {
                        state.set_status(&app, UpdateStatus::Ready { version });
                    }
                    Err(err) => {
                        state.set_status(
                            &app,
                            UpdateStatus::Failed {
                                version: Some(version),
                                message: format!("Falha ao baixar atualização: {err}"),
                            },
                        );
                    }
                }
            }
            Ok(None) => {
                state.set_status(
                    &app,
                    UpdateStatus::UpToDate {
                        checked_at: now_millis(),
                    },
                );
            }
            Err(err) => {
                state.set_status(
                    &app,
                    UpdateStatus::Failed {
                        version: None,
                        message: format!("Falha ao verificar atualizações: {err}"),
                    },
                );
            }
        }
    });
}

/// Baixa (se necessário) e instala a atualização imediatamente, reiniciando o app.
pub fn spawn_install_update(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<UpdaterState>();
        let updater = match app.updater() {
            Ok(u) => u,
            Err(err) => {
                state.set_status(
                    &app,
                    UpdateStatus::Failed {
                        version: None,
                        message: format!("Updater indisponível: {err}"),
                    },
                );
                return;
            }
        };

        match updater.check().await {
            Ok(Some(update)) => {
                let version = update.version.clone();
                if let Err(err) = update.download_and_install(|_, _| {}, || {}).await {
                    state.set_status(
                        &app,
                        UpdateStatus::Failed {
                            version: Some(version),
                            message: format!("Falha ao instalar atualização: {err}"),
                        },
                    );
                    return;
                }
                app.restart();
            }
            Ok(None) => {
                state.set_status(
                    &app,
                    UpdateStatus::UpToDate {
                        checked_at: now_millis(),
                    },
                );
            }
            Err(err) => {
                state.set_status(
                    &app,
                    UpdateStatus::Failed {
                        version: None,
                        message: format!("Falha ao instalar atualização: {err}"),
                    },
                );
            }
        }
    });
}

pub fn dismiss_update_version(app: &AppHandle, version: String) {
    let trimmed = version.trim().to_string();
    let value = if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    };
    let _ = app
        .state::<ConfigState>()
        .update(|cfg| cfg.dismissed_update_version = value.clone());
    app.state::<UpdaterState>().set_dismissed(app, value);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_update_snapshot_matching_desktop_contract() {
        let snap = UpdateSnapshot {
            capability: "auto".to_string(),
            dismissed_version: None,
            status: UpdateStatus::Downloading {
                version: "0.2.0".to_string(),
                percent: 42.5,
                bytes_per_second: 1024,
            },
        };
        let json = serde_json::to_value(&snap).unwrap();
        assert_eq!(json["capability"], "auto");
        assert_eq!(json["status"]["phase"], "downloading");
        assert_eq!(json["status"]["version"], "0.2.0");
        assert_eq!(json["status"]["bytesPerSecond"], 1024);
    }
}
