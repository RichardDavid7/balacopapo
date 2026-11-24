use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use url::Url;

pub const DEFAULT_RELEASES_URL: &str =
    "https://github.com/RichardDavid7/balacopapo/releases/latest";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub instance_url: Option<String>,
    /// Quando true, fechar a janela para a bandeja descarrega a WebView (~10–15 MB RAM).
    #[serde(default = "default_true")]
    pub standby_mode: bool,
    #[serde(default)]
    pub start_minimized: bool,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default)]
    pub dismissed_update_version: Option<String>,
}

fn default_true() -> bool {
    true
}

fn default_language() -> String {
    "pt".to_string()
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            instance_url: None,
            standby_mode: true,
            start_minimized: false,
            language: default_language(),
            dismissed_update_version: None,
        }
    }
}

pub struct ConfigState {
    pub path: PathBuf,
    pub inner: Mutex<AppConfig>,
}

impl ConfigState {
    pub fn load(app: &AppHandle) -> Self {
        let dir = app
            .path()
            .app_config_dir()
            .unwrap_or_else(|_| PathBuf::from("."));
        let path = dir.join("config.json");
        let config = fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<AppConfig>(&raw).ok())
            .unwrap_or_default();

        Self {
            path,
            inner: Mutex::new(config),
        }
    }

    pub fn snapshot(&self) -> AppConfig {
        self.inner.lock().map(|g| g.clone()).unwrap_or_default()
    }

    pub fn update<F>(&self, mutate: F) -> Result<AppConfig, String>
    where
        F: FnOnce(&mut AppConfig),
    {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "Falha ao travar estado de configuração".to_string())?;
        mutate(&mut guard);
        let cloned = guard.clone();
        drop(guard);
        self.persist(&cloned)?;
        Ok(cloned)
    }

    fn persist(&self, cfg: &AppConfig) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Não foi possível criar pasta de config: {e}"))?;
        }
        let json = serde_json::to_string_pretty(cfg)
            .map_err(|e| format!("Falha ao serializar config: {e}"))?;
        fs::write(&self.path, json).map_err(|e| format!("Falha ao salvar config: {e}"))
    }
}

/// Normaliza e valida a URL de uma instância Backspace (aceita http/https).
pub fn normalize_instance_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("URL da instância não pode estar vazia.".to_string());
    }

    let with_scheme = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };

    let parsed = Url::parse(&with_scheme).map_err(|e| format!("URL inválida: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => {}
        other => return Err(format!("Protocolo não suportado: {other}")),
    }

    if parsed.host_str().is_none() {
        return Err("URL precisa conter um domínio ou IP válido.".to_string());
    }

    let mut normalized = parsed.to_string();
    if normalized.ends_with('/') && parsed.path() == "/" {
        normalized.pop();
    }
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_urls_cleanly() {
        assert_eq!(
            normalize_instance_url("https://chat.exemplo.com/").unwrap(),
            "https://chat.exemplo.com"
        );
        assert_eq!(
            normalize_instance_url("chat.exemplo.com").unwrap(),
            "https://chat.exemplo.com"
        );
        assert_eq!(
            normalize_instance_url("http://192.168.1.50:3000/").unwrap(),
            "http://192.168.1.50:3000"
        );
    }

    #[test]
    fn rejects_invalid_schemes_and_empty() {
        assert!(normalize_instance_url("").is_err());
        assert!(normalize_instance_url("ftp://chat.exemplo.com").is_err());
    }
}
