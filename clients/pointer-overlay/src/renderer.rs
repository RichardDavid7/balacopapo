//! Rasterizador vetorial ultra-leve (`tiny-skia`) para os marcadores de apontar.
//! Gera um buffer BGRA com alpha pré-multiplicado pronto para `UpdateLayeredWindow` (0% GPU 3D).

use tiny_skia::{Color, FillRule, Paint, PathBuilder, Pixmap, Stroke, Transform};

use crate::protocol::{ActiveMarker, Rgb};

/// Rasteriza todos os marcadores ativos em um `Pixmap` RGBA (pré-multiplicado) do tamanho do monitor.
pub fn render_markers_rgba(
    width: u32,
    height: u32,
    scale_factor: f32,
    markers: &[ActiveMarker],
    now_ms: u64,
) -> Option<Pixmap> {
    if width == 0 || height == 0 {
        return None;
    }
    let mut pixmap = Pixmap::new(width, height)?;
    let scale = scale_factor.clamp(0.75, 3.0);

    for marker in markers {
        let alpha = marker.opacity(now_ms);
        if alpha <= 0.005 {
            continue;
        }
        let cx = (marker.x * width as f32).clamp(24.0, (width as f32 - 24.0).max(24.0));
        let cy = (marker.y * height as f32).clamp(24.0, (height as f32 - 24.0).max(24.0));
        let progress = marker.progress(now_ms);

        draw_single_marker(&mut pixmap, cx, cy, scale, marker.color, progress, alpha);
    }

    Some(pixmap)
}

fn draw_single_marker(
    pixmap: &mut Pixmap,
    cx: f32,
    cy: f32,
    scale: f32,
    rgb: Rgb,
    progress: f32,
    alpha: f32,
) {
    // 1. Onda expansiva pulsante (até 2 pulsos ao longo do TTL)
    let wave_cycle = (progress * 2.2) % 1.0;
    let wave_radius = (14.0 + wave_cycle * 34.0) * scale;
    let wave_alpha = ((1.0 - wave_cycle) * 0.72 * alpha).clamp(0.0, 1.0);
    if wave_alpha > 0.01 {
        stroke_circle(
            pixmap,
            cx,
            cy,
            wave_radius,
            Color::from_rgba(0.0, 0.0, 0.0, wave_alpha * 0.65).unwrap(),
            4.5 * scale,
        );
        stroke_circle(
            pixmap,
            cx,
            cy,
            wave_radius,
            Color::from_rgba(
                rgb.r as f32 / 255.0,
                rgb.g as f32 / 255.0,
                rgb.b as f32 / 255.0,
                wave_alpha,
            )
            .unwrap(),
            2.4 * scale,
        );
    }

    // 2. Retículo central de alto contraste (borda preta externa + anel colorido + ponto branco/cor)
    let outer_r = 14.0 * scale;
    fill_circle(
        pixmap,
        cx,
        cy,
        outer_r,
        Color::from_rgba(
            rgb.r as f32 / 255.0,
            rgb.g as f32 / 255.0,
            rgb.b as f32 / 255.0,
            0.22 * alpha,
        )
        .unwrap(),
    );
    stroke_circle(
        pixmap,
        cx,
        cy,
        outer_r,
        Color::from_rgba(0.0, 0.0, 0.0, 0.85 * alpha).unwrap(),
        5.0 * scale,
    );
    stroke_circle(
        pixmap,
        cx,
        cy,
        outer_r,
        Color::from_rgba(
            rgb.r as f32 / 255.0,
            rgb.g as f32 / 255.0,
            rgb.b as f32 / 255.0,
            alpha,
        )
        .unwrap(),
        2.6 * scale,
    );

    // 3. Mira em cruz discreta para leitura rápida tanto em cenas escuras quanto brancas (neve/flash)
    let tick_inner = 17.0 * scale;
    let tick_outer = 24.0 * scale;
    let dirs = [(1.0, 0.0), (-1.0, 0.0), (0.0, 1.0), (0.0, -1.0)];
    for (dx, dy) in dirs {
        stroke_line(
            pixmap,
            cx + dx * tick_inner,
            cy + dy * tick_inner,
            cx + dx * tick_outer,
            cy + dy * tick_outer,
            Color::from_rgba(0.0, 0.0, 0.0, 0.85 * alpha).unwrap(),
            4.2 * scale,
        );
        stroke_line(
            pixmap,
            cx + dx * tick_inner,
            cy + dy * tick_inner,
            cx + dx * tick_outer,
            cy + dy * tick_outer,
            Color::from_rgba(1.0, 1.0, 1.0, 0.95 * alpha).unwrap(),
            2.0 * scale,
        );
    }

    // 4. Ponto central de precisão
    fill_circle(
        pixmap,
        cx,
        cy,
        4.4 * scale,
        Color::from_rgba(0.0, 0.0, 0.0, 0.9 * alpha).unwrap(),
    );
    fill_circle(
        pixmap,
        cx,
        cy,
        3.0 * scale,
        Color::from_rgba(
            rgb.r as f32 / 255.0,
            rgb.g as f32 / 255.0,
            rgb.b as f32 / 255.0,
            alpha,
        )
        .unwrap(),
    );
}

fn fill_circle(pixmap: &mut Pixmap, cx: f32, cy: f32, radius: f32, color: Color) {
    let Some(path) = PathBuilder::from_circle(cx, cy, radius) else {
        return;
    };
    let mut paint = Paint::default();
    paint.set_color(color);
    paint.anti_alias = true;
    pixmap.fill_path(&path, &paint, FillRule::Winding, Transform::identity(), None);
}

fn stroke_circle(pixmap: &mut Pixmap, cx: f32, cy: f32, radius: f32, color: Color, width: f32) {
    let Some(path) = PathBuilder::from_circle(cx, cy, radius) else {
        return;
    };
    let mut paint = Paint::default();
    paint.set_color(color);
    paint.anti_alias = true;
    let stroke = Stroke {
        width,
        ..Stroke::default()
    };
    pixmap.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
}

fn stroke_line(
    pixmap: &mut Pixmap,
    x1: f32,
    y1: f32,
    x2: f32,
    y2: f32,
    color: Color,
    width: f32,
) {
    let mut pb = PathBuilder::new();
    pb.move_to(x1, y1);
    pb.line_to(x2, y2);
    let Some(path) = pb.finish() else {
        return;
    };
    let mut paint = Paint::default();
    paint.set_color(color);
    paint.anti_alias = true;
    let stroke = Stroke {
        width,
        ..Stroke::default()
    };
    pixmap.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
}

/// Converte pixels RGBA pré-multiplicados do `tiny-skia` para BGRA (ordem esperada pelo Win32 DIB).
#[cfg(windows)]
pub fn rgba_to_bgra_into(rgba: &[u8], bgra_out: &mut [u8]) {
    let (src_chunks, _) = rgba.as_chunks::<4>();
    let (dst_chunks, _) = bgra_out.as_chunks_mut::<4>();
    for (src, dst) in src_chunks.iter().zip(dst_chunks.iter_mut()) {
        dst[0] = src[2]; // B
        dst[1] = src[1]; // G
        dst[2] = src[0]; // R
        dst[3] = src[3]; // A
    }
}
