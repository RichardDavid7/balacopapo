use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use url::Url;

pub const DEFAULT_RELEASES_API: &str =
    "https://api.github.com/repos/RichardDavid7/balacopapo/releases?per_page=10";
pub const DEFAULT_RELEASES_PAGE: &str =
    "https://github.com/RichardDavid7/balacopapo/releases";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub instance_url: Option<String>,
    /// Token JWT salvo localmente para reconexão automática.
    #[serde(default)]
    pub auth_token: Option<String>,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_clock_format")]
    pub clock_format: String,
    #[serde(default = "default_true")]
    pub low_interrupt_mode: bool,
    #[serde(default = "default_true")]
    pub desktop_notifications: bool,
    #[serde(default = "default_true")]
    pub game_presence_enabled: bool,
    #[serde(default)]
    pub ignored_games: Vec<String>,
    #[serde(default)]
    pub manual_game_override: Option<String>,
}

fn default_language() -> String {
    "pt".to_string()
}

fn default_theme() -> String {
    "aether_drift".to_string()
}

fn default_clock_format() -> String {
    "auto".to_string()
}

fn default_true() -> bool {
    true
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            instance_url: None,
            auth_token: None,
            language: default_language(),
            theme: default_theme(),
            clock_format: default_clock_format(),
            low_interrupt_mode: true,
            desktop_notifications: true,
            game_presence_enabled: true,
            ignored_games: Vec::new(),
            manual_game_override: None,
        }
    }
}

impl AppConfig {
    pub fn config_path() -> PathBuf {
        if let Some(dirs) = ProjectDirs::from("io.github.richarddavid7", "Balacopapo", "Balacopapo")
        {
            dirs.config_dir().join("config.json")
        } else {
            PathBuf::from("balacopapo-config.json")
        }
    }

    pub fn load() -> Self {
        let path = Self::config_path();
        fs::read_to_string(path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Self>(&raw).ok())
            .unwrap_or_default()
    }

    pub fn save(&self) -> Result<(), String> {
        let path = Self::config_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Falha ao criar pasta de configuração: {e}"))?;
        }
        let body = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Falha ao serializar configuração: {e}"))?;
        fs::write(path, body).map_err(|e| format!("Falha ao salvar configuração: {e}"))
    }
}

/// Normaliza e valida a URL de uma instância Balacopapo (aceita http/https).
pub fn normalize_instance_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Informe o endereço da sua instância Balacopapo.".to_string());
    }

    let with_scheme = if trimmed.contains("://") {
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
    fn normalizes_valid_urls() {
        assert_eq!(
            normalize_instance_url("chat.balacopapo.com").unwrap(),
            "https://chat.balacopapo.com"
        );
        assert_eq!(
            normalize_instance_url("https://chat.balacopapo.com/").unwrap(),
            "https://chat.balacopapo.com"
        );
        assert_eq!(
            normalize_instance_url("http://192.168.1.50:3000/").unwrap(),
            "http://192.168.1.50:3000"
        );
    }

    #[test]
    fn rejects_empty_or_non_http() {
        assert!(normalize_instance_url("").is_err());
        assert!(normalize_instance_url("ftp://chat.balacopapo.com").is_err());
    }
}
