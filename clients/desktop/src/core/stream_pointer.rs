//! Protocolo 1-para-1 com `packages/web/src/utils/streamPointerProtocol.ts`
//! + matemática de **Zoom & Pan (1x–6x)** ancorada no ponteiro com `object-contain`.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StreamPointerMode {
    Ping,
    Drag,
    Clear,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamPointerMessage {
    #[serde(rename = "type")]
    pub kind: String,
    pub stream_identity: String,
    pub x: f32,
    pub y: f32,
    pub mode: StreamPointerMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

impl StreamPointerMessage {
    pub fn ping(stream_identity: String, x: f32, y: f32, color: Option<String>) -> Self {
        Self {
            kind: "stream_pointer".to_string(),
            stream_identity,
            x: x.clamp(0.0, 1.0),
            y: y.clamp(0.0, 1.0),
            mode: StreamPointerMode::Ping,
            color,
        }
    }

    pub fn parse_json(payload: &[u8]) -> Option<Self> {
        let msg: Self = serde_json::from_slice(payload).ok()?;
        if msg.kind != "stream_pointer" || msg.stream_identity.is_empty() {
            return None;
        }
        if !msg.x.is_finite() || !msg.y.is_finite() {
            return None;
        }
        if !(0.0..=1.0).contains(&msg.x) || !(0.0..=1.0).contains(&msg.y) {
            return None;
        }
        Some(msg)
    }

    pub fn to_json_bytes(&self) -> Result<Vec<u8>, String> {
        serde_json::to_vec(self).map_err(|e| format!("Falha ao serializar stream_pointer: {e}"))
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VideoContentBox {
    pub left: f32,
    pub top: f32,
    pub width: f32,
    pub height: f32,
}

/// Calcula o retângulo real de um vídeo `object-contain` (com letterbox/pillarbox).
pub fn compute_video_content_box(
    elem_w: f32,
    elem_h: f32,
    vid_w: f32,
    vid_h: f32,
) -> VideoContentBox {
    if elem_w <= 0.0 || elem_h <= 0.0 {
        return VideoContentBox {
            left: 0.0,
            top: 0.0,
            width: 0.0,
            height: 0.0,
        };
    }
    if vid_w <= 0.0 || vid_h <= 0.0 {
        return VideoContentBox {
            left: 0.0,
            top: 0.0,
            width: elem_w,
            height: elem_h,
        };
    }
    let elem_ratio = elem_w / elem_h;
    let vid_ratio = vid_w / vid_h;
    if vid_ratio > elem_ratio {
        let width = elem_w;
        let height = elem_w / vid_ratio;
        VideoContentBox {
            left: 0.0,
            top: (elem_h - height) * 0.5,
            width,
            height,
        }
    } else {
        let height = elem_h;
        let width = elem_h * vid_ratio;
        VideoContentBox {
            left: (elem_w - width) * 0.5,
            top: 0.0,
            width,
            height,
        }
    }
}

/// Estado de Zoom (1.0x–6.0x) e Pan ancorado no ponteiro.
#[derive(Debug, Clone, Copy)]
pub struct ZoomPanViewport {
    pub scale: f32,
    pub pan_x: f32,
    pub pan_y: f32,
}

impl Default for ZoomPanViewport {
    fn default() -> Self {
        Self {
            scale: 1.0,
            pan_x: 0.0,
            pan_y: 0.0,
        }
    }
}

impl ZoomPanViewport {
    pub fn reset(&mut self) {
        *self = Self::default();
    }

    pub fn zoom_at(&mut self, cursor_x: f32, cursor_y: f32, width: f32, height: f32, factor: f32) {
        let old_scale = self.scale;
        let new_scale = (old_scale * factor).clamp(1.0, 6.0);
        if (new_scale - old_scale).abs() < 1e-4 {
            return;
        }
        if new_scale <= 1.001 {
            self.reset();
            return;
        }
        let ratio = new_scale / old_scale;
        self.pan_x = cursor_x - (cursor_x - self.pan_x) * ratio;
        self.pan_y = cursor_y - (cursor_y - self.pan_y) * ratio;
        self.scale = new_scale;
        self.clamp_pan(width, height);
    }

    pub fn pan_by(&mut self, dx: f32, dy: f32, width: f32, height: f32) {
        if self.scale <= 1.001 {
            return;
        }
        self.pan_x += dx;
        self.pan_y += dy;
        self.clamp_pan(width, height);
    }

    fn clamp_pan(&mut self, width: f32, height: f32) {
        let min_x = width * (1.0 - self.scale);
        let min_y = height * (1.0 - self.scale);
        self.pan_x = self.pan_x.clamp(min_x, 0.0);
        self.pan_y = self.pan_y.clamp(min_y, 0.0);
    }

    /// Converte coordenadas locais do canvas em `[0..1]` do frame de vídeo real.
    pub fn canvas_to_normalized(
        &self,
        local_x: f32,
        local_y: f32,
        canvas_w: f32,
        canvas_h: f32,
        vid_w: f32,
        vid_h: f32,
    ) -> Option<(f32, f32)> {
        let base_x = (local_x - self.pan_x) / self.scale;
        let base_y = (local_y - self.pan_y) / self.scale;
        let box_rect = compute_video_content_box(canvas_w, canvas_h, vid_w, vid_h);
        if box_rect.width <= 0.0 || box_rect.height <= 0.0 {
            return None;
        }
        let nx = (base_x - box_rect.left) / box_rect.width;
        let ny = (base_y - box_rect.top) / box_rect.height;
        if (0.0..=1.0).contains(&nx) && (0.0..=1.0).contains(&ny) {
            Some((nx, ny))
        } else {
            None
        }
    }

    /// Converte `[0..1]` do vídeo em coordenada de desenho no canvas com zoom/pan aplicado.
    pub fn normalized_to_canvas(
        &self,
        nx: f32,
        ny: f32,
        canvas_w: f32,
        canvas_h: f32,
        vid_w: f32,
        vid_h: f32,
    ) -> (f32, f32) {
        let box_rect = compute_video_content_box(canvas_w, canvas_h, vid_w, vid_h);
        let base_x = box_rect.left + nx * box_rect.width;
        let base_y = box_rect.top + ny * box_rect.height;
        (
            base_x * self.scale + self.pan_x,
            base_y * self.scale + self.pan_y,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrips_stream_pointer_json_matching_web() {
        let msg = StreamPointerMessage::ping(
            "u1:richard".to_string(),
            0.25,
            0.75,
            Some("#8b5cf6".to_string()),
        );
        let bytes = msg.to_json_bytes().unwrap();
        let decoded = StreamPointerMessage::parse_json(&bytes).unwrap();
        assert_eq!(decoded, msg);
    }

    #[test]
    fn zoom_and_normalized_roundtrip() {
        let mut vp = ZoomPanViewport::default();
        vp.zoom_at(320.0, 180.0, 640.0, 360.0, 2.0);
        assert!((vp.scale - 2.0).abs() < 1e-4);
        let (cx, cy) = vp.normalized_to_canvas(0.5, 0.5, 640.0, 360.0, 1920.0, 1080.0);
        let (nx, ny) = vp
            .canvas_to_normalized(cx, cy, 640.0, 360.0, 1920.0, 1080.0)
            .unwrap();
        assert!((nx - 0.5).abs() < 1e-3);
        assert!((ny - 0.5).abs() < 1e-3);
    }
}
