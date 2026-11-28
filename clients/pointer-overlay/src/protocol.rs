//! Contrato NDJSON (1 JSON por linha via `stdin`) entre o processo pai (Electron Main)
//! e o binário nativo de overlay (`balacopapo-pointer-overlay`).

#![allow(dead_code)]

use serde::Deserialize;

pub const DEFAULT_TTL_MS: u64 = 2500;
pub const MIN_TTL_MS: u64 = 400;
pub const MAX_TTL_MS: u64 = 8000;
pub const MAX_ACTIVE_MARKERS: usize = 5;

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum OverlayCommand {
    #[serde(rename = "pointer:ping")]
    PointerPing {
        x: f32,
        y: f32,
        #[serde(default)]
        from: String,
        #[serde(default = "default_color")]
        color: String,
        #[serde(default = "default_ttl_ms", rename = "ttlMs")]
        ttl_ms: u64,
    },
    #[serde(rename = "pointer:clear")]
    PointerClear,
    #[serde(rename = "overlay:state")]
    OverlayState {
        #[serde(default = "default_true")]
        enabled: bool,
        #[serde(default)]
        x: i32,
        #[serde(default)]
        y: i32,
        #[serde(default)]
        width: i32,
        #[serde(default)]
        height: i32,
        #[serde(default = "default_scale", rename = "scaleFactor")]
        scale_factor: f32,
    },
}

fn default_color() -> String {
    "#86EFAC".to_string()
}

fn default_ttl_ms() -> u64 {
    DEFAULT_TTL_MS
}

fn default_true() -> bool {
    true
}

fn default_scale() -> f32 {
    1.0
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MonitorRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl Default for MonitorRect {
    fn default() -> Self {
        Self {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

pub fn parse_hex_rgb(raw: &str) -> Rgb {
    let clean = raw.trim().trim_start_matches('#');
    if clean.len() == 6 {
        if let (Ok(r), Ok(g), Ok(b)) = (
            u8::from_str_radix(&clean[0..2], 16),
            u8::from_str_radix(&clean[2..4], 16),
            u8::from_str_radix(&clean[4..6], 16),
        ) {
            return Rgb { r, g, b };
        }
    }
    Rgb {
        r: 134,
        g: 239,
        b: 172,
    }
}

#[derive(Debug, Clone)]
pub struct ActiveMarker {
    pub id: u64,
    pub x: f32,
    pub y: f32,
    pub from: String,
    pub color: Rgb,
    pub created_ms: u64,
    pub ttl_ms: u64,
}

impl ActiveMarker {
    /// Progresso normalizado `[0.0..1.0]` ao longo do tempo de vida (`ttl_ms`).
    pub fn progress(&self, now_ms: u64) -> f32 {
        let elapsed = now_ms.saturating_sub(self.created_ms);
        (elapsed as f32 / self.ttl_ms.max(1) as f32).clamp(0.0, 1.0)
    }

    /// Opacidade suave: entrada rápida (100 ms), platô legível e fade-out nos últimos 35%.
    pub fn opacity(&self, now_ms: u64) -> f32 {
        let p = self.progress(now_ms);
        if p >= 1.0 {
            return 0.0;
        }
        if p < 0.06 {
            p / 0.06
        } else if p > 0.65 {
            ((1.0 - p) / 0.35).clamp(0.0, 1.0)
        } else {
            1.0
        }
    }
}

#[derive(Debug, Default)]
pub struct OverlayWorld {
    pub enabled: bool,
    pub bounds: MonitorRect,
    pub scale_factor: f32,
    pub markers: Vec<ActiveMarker>,
    next_id: u64,
}

impl OverlayWorld {
    pub fn new(bounds: MonitorRect) -> Self {
        Self {
            enabled: true,
            bounds,
            scale_factor: 1.0,
            markers: Vec::new(),
            next_id: 1,
        }
    }

    pub fn apply_command(&mut self, cmd: OverlayCommand, now_ms: u64) -> bool {
        match cmd {
            OverlayCommand::OverlayState {
                enabled,
                x,
                y,
                width,
                height,
                scale_factor,
            } => {
                self.enabled = enabled;
                if width > 0 && height > 0 {
                    self.bounds = MonitorRect {
                        x,
                        y,
                        width,
                        height,
                    };
                }
                if scale_factor.is_finite() && scale_factor > 0.25 && scale_factor <= 6.0 {
                    self.scale_factor = scale_factor;
                }
                if !self.enabled {
                    self.markers.clear();
                }
                true
            }
            OverlayCommand::PointerClear => {
                let had = !self.markers.is_empty();
                self.markers.clear();
                had
            }
            OverlayCommand::PointerPing {
                x,
                y,
                from,
                color,
                ttl_ms,
            } => {
                if !self.enabled || !x.is_finite() || !y.is_finite() {
                    return false;
                }
                let nx = x.clamp(0.0, 1.0);
                let ny = y.clamp(0.0, 1.0);
                let safe_ttl = ttl_ms.clamp(MIN_TTL_MS, MAX_TTL_MS);
                let safe_from: String = from.trim().chars().take(24).collect();
                let rgb = parse_hex_rgb(&color);

                // Se o mesmo remetente já possui marcador recente, substitui para evitar poluição
                if !safe_from.is_empty() {
                    self.markers.retain(|m| m.from != safe_from);
                }

                let id = self.next_id;
                self.next_id += 1;

                self.markers.push(ActiveMarker {
                    id,
                    x: nx,
                    y: ny,
                    from: safe_from,
                    color: rgb,
                    created_ms: now_ms,
                    ttl_ms: safe_ttl,
                });

                // Limita marcadores simultâneos para não poluir o HUD do jogo
                if self.markers.len() > MAX_ACTIVE_MARKERS {
                    let excess = self.markers.len() - MAX_ACTIVE_MARKERS;
                    self.markers.drain(0..excess);
                }
                true
            }
        }
    }

    pub fn prune_expired(&mut self, now_ms: u64) -> bool {
        let before = self.markers.len();
        self.markers
            .retain(|m| now_ms.saturating_sub(m.created_ms) < m.ttl_ms);
        self.markers.len() != before
    }
}

pub fn parse_command_line(line: &str) -> Option<OverlayCommand> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    serde_json::from_str::<OverlayCommand>(trimmed).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ping_clear_and_state() {
        let ping = parse_command_line(
            r##"{"type":"pointer:ping","x":0.42,"y":0.75,"from":"Biel","color":"#34d399","ttlMs":2500}"##,
        )
        .expect("ping válido");
        assert!(matches!(ping, OverlayCommand::PointerPing { .. }));

        let clear = parse_command_line(r#"{"type":"pointer:clear"}"#).expect("clear válido");
        assert_eq!(clear, OverlayCommand::PointerClear);

        let st = parse_command_line(
            r#"{"type":"overlay:state","enabled":true,"x":1920,"y":0,"width":2560,"height":1440,"scaleFactor":1.25}"#,
        )
        .expect("state válido");
        assert!(matches!(st, OverlayCommand::OverlayState { width: 2560, .. }));
    }

    #[test]
    fn caps_simultaneous_markers_and_expires_after_ttl() {
        let mut world = OverlayWorld::new(MonitorRect::default());
        for i in 0..8 {
            world.apply_command(
                OverlayCommand::PointerPing {
                    x: 0.1 * i as f32,
                    y: 0.5,
                    from: format!("user-{i}"),
                    color: "#86EFAC".to_string(),
                    ttl_ms: 2500,
                },
                1000,
            );
        }
        assert_eq!(world.markers.len(), MAX_ACTIVE_MARKERS);
        assert!(world.markers[0].opacity(1500) > 0.99);
        assert!(world.markers[0].opacity(3400) < 0.2);

        world.prune_expired(3600);
        assert!(world.markers.is_empty());
    }
}
