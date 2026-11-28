//! `balacopapo-pointer-overlay` — Overlay nativo externo, transparente e click-through.
//!
//! Uso:
//! - Produção (lançado pelo Electron Main): lê comandos NDJSON do `stdin` e encerra em `EOF`.
//! - Teste local em Borderless: `balacopapo-pointer-overlay --demo` dispara 3 pings de teste.

mod protocol;
mod renderer;

#[cfg(windows)]
mod win32_overlay;

fn main() {
    let demo_mode = std::env::args().any(|a| a == "--demo");

    #[cfg(windows)]
    {
        if let Err(err) = win32_overlay::run(demo_mode) {
            eprintln!("[pointer-overlay] {err}");
            std::process::exit(1);
        }
    }

    #[cfg(not(windows))]
    {
        run_non_windows_stdin_loop(demo_mode);
    }
}

#[cfg(not(windows))]
fn run_non_windows_stdin_loop(demo_mode: bool) {
    use std::io::{self, BufRead};
    use std::time::Instant;

    let started = Instant::now();
    let mut world = protocol::OverlayWorld::new(protocol::MonitorRect::default());
    if demo_mode {
        let _ = world.apply_command(
            protocol::OverlayCommand::PointerPing {
                x: 0.5,
                y: 0.5,
                from: "Demo".to_string(),
                color: "#86EFAC".to_string(),
                ttl_ms: protocol::DEFAULT_TTL_MS,
            },
            0,
        );
        let _ = renderer::render_markers_rgba(640, 360, 1.0, &world.markers, 100);
        return;
    }

    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let Ok(text) = line else {
            break;
        };
        if let Some(cmd) = protocol::parse_command_line(&text) {
            let t = started.elapsed().as_millis() as u64;
            world.apply_command(cmd, t);
        }
    }
}
