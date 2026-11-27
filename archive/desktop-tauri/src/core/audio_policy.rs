//! Política determinística de áudio Opus em 5 níveis:
//! `Instância → Grupo → Categoria → Canal → Usuário`.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpusMode {
    Voice,
    Music,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpusOverride {
    pub bitrate_kbps: Option<u32>,
    pub mode: Option<OpusMode>,
    pub stereo: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EffectiveOpusConfig {
    pub bitrate_kbps: u32,
    pub mode: OpusMode,
    pub stereo: bool,
}

impl Default for EffectiveOpusConfig {
    fn default() -> Self {
        Self {
            bitrate_kbps: 64,
            mode: OpusMode::Voice,
            stereo: false,
        }
    }
}

/// Resolve a configuração efetiva de Opus respeitando o teto máximo da instância.
pub fn resolve_opus_policy(
    instance_max_kbps: u32,
    layers: &[&OpusOverride],
) -> EffectiveOpusConfig {
    let mut resolved = EffectiveOpusConfig::default();

    for layer in layers {
        if let Some(br) = layer.bitrate_kbps {
            resolved.bitrate_kbps = br;
        }
        if let Some(mode) = layer.mode {
            resolved.mode = mode;
        }
        if let Some(stereo) = layer.stereo {
            resolved.stereo = stereo;
        }
    }

    let floor = 16;
    let ceiling = instance_max_kbps.max(floor);
    resolved.bitrate_kbps = resolved.bitrate_kbps.clamp(floor, ceiling);
    resolved
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hierarchy_overrides_and_respects_instance_ceiling() {
        let instance = OpusOverride {
            bitrate_kbps: Some(64),
            mode: Some(OpusMode::Voice),
            stereo: Some(false),
        };
        let channel = OpusOverride {
            bitrate_kbps: Some(256),
            mode: Some(OpusMode::Music),
            stereo: Some(true),
        };
        let user = OpusOverride {
            bitrate_kbps: Some(192),
            mode: None,
            stereo: None,
        };

        let eff = resolve_opus_policy(128, &[&instance, &channel, &user]);
        assert_eq!(eff.bitrate_kbps, 128);
        assert_eq!(eff.mode, OpusMode::Music);
        assert!(eff.stereo);
    }
}
