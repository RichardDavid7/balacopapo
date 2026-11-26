use url::Url;

/// Destinos suportados pelo esquema `balacopapo://` (e legado `backspace://`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeepLinkTarget {
    /// Callback de autenticação OIDC (`balacopapo://auth/callback?token=...`).
    OidcCallback { token: String, instance: Option<String> },
    /// Convite de Grupo (`balacopapo://invite/<code>` ou `balacopapo://join/<code>`).
    Invite { code: String, instance: Option<String> },
    /// Rota interna genérica (ex.: `/spaces/<id>/channels/<id>`).
    InternalRoute { path: String },
}

pub fn parse_deep_link(raw: &str) -> Option<DeepLinkTarget> {
    let trimmed = raw.trim();
    if !trimmed.starts_with("balacopapo://") && !trimmed.starts_with("backspace://") {
        return None;
    }

    let parsed = Url::parse(trimmed).ok()?;
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    let path_segments: Vec<&str> = parsed
        .path_segments()
        .map(|s| s.filter(|seg| !seg.is_empty()).collect())
        .unwrap_or_default();

    let query_param = |key: &str| -> Option<String> {
        parsed
            .query_pairs()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.into_owned())
            .filter(|v| !v.is_empty())
    };

    if host == "auth" && path_segments.first().copied() == Some("callback") {
        let token = query_param("token")?;
        return Some(DeepLinkTarget::OidcCallback {
            token,
            instance: query_param("instance"),
        });
    }

    if host == "invite" || host == "join" {
        let code = path_segments.first()?.to_string();
        return Some(DeepLinkTarget::Invite {
            code,
            instance: query_param("instance"),
        });
    }

    let full_path = if host.is_empty() {
        parsed.path().to_string()
    } else if path_segments.is_empty() {
        format!("/{host}")
    } else {
        format!("/{host}/{}", path_segments.join("/"))
    };

    Some(DeepLinkTarget::InternalRoute { path: full_path })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_oidc_callback() {
        let parsed = parse_deep_link(
            "balacopapo://auth/callback?token=jwt123&instance=https%3A%2F%2Fchat.exemplo.com",
        );
        assert_eq!(
            parsed,
            Some(DeepLinkTarget::OidcCallback {
                token: "jwt123".to_string(),
                instance: Some("https://chat.exemplo.com".to_string()),
            })
        );
    }

    #[test]
    fn parses_invite_link() {
        let parsed = parse_deep_link("balacopapo://invite/abcDEF12");
        assert_eq!(
            parsed,
            Some(DeepLinkTarget::Invite {
                code: "abcDEF12".to_string(),
                instance: None,
            })
        );
    }

    #[test]
    fn ignores_unknown_schemes() {
        assert_eq!(parse_deep_link("https://example.com"), None);
    }
}
