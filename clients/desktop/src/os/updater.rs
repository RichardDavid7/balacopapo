use serde::Deserialize;
use std::time::Duration;

use crate::core::config::{DEFAULT_RELEASES_API, DEFAULT_RELEASES_PAGE};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateCheckState {
    #[allow(dead_code)]
    Idle,
    Checking,
    UpToDate,
    Available {
        version: String,
        release_url: String,
    },
    Failed(String),
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: Option<String>,
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

pub async fn check_github_updates() -> UpdateCheckState {
    let client = match reqwest::Client::builder()
        .user_agent(format!("Balacopapo-Desktop/{}", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return UpdateCheckState::Failed(format!("Cliente HTTP indisponível: {e}")),
    };

    let resp = match client.get(DEFAULT_RELEASES_API).send().await {
        Ok(r) => r,
        Err(e) => return UpdateCheckState::Failed(format!("Sem acesso ao GitHub: {e}")),
    };

    if !resp.status().is_success() {
        return UpdateCheckState::Failed(format!("GitHub HTTP {}", resp.status().as_u16()));
    }

    let release = match resp.json::<GithubRelease>().await {
        Ok(r) => r,
        Err(e) => return UpdateCheckState::Failed(format!("Resposta inválida: {e}")),
    };

    let current = env!("CARGO_PKG_VERSION");
    if is_newer_version(current, &release.tag_name) {
        UpdateCheckState::Available {
            version: release.tag_name,
            release_url: release
                .html_url
                .unwrap_or_else(|| DEFAULT_RELEASES_PAGE.to_string()),
        }
    } else {
        UpdateCheckState::UpToDate
    }
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
}
