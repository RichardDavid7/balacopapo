#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod core;
mod features;
mod media;
mod net;
mod os;
mod ui;

use iced::{window, Size};

const APP_ICON_ICO: &[u8] = include_bytes!("../icons/snafuonda.ico");

fn load_window_icon() -> Option<window::Icon> {
    let img = image::load_from_memory_with_format(APP_ICON_ICO, image::ImageFormat::Ico)
        .ok()?
        .to_rgba8();
    let (w, h) = img.dimensions();
    window::icon::from_rgba(img.into_raw(), w, h).ok()
}

fn main() -> iced::Result {
    // Aplica silenciosamente qualquer atualização já baixada na sessão anterior (zero interação).
    os::updater::apply_staged_on_startup();
    // Registra o protocolo `balacopapo://` ("Abrir com Balacopapo") sem precisar de Admin.
    os::protocol::register_url_scheme();

    iced::application(
        app::BalacopapoApp::title,
        app::BalacopapoApp::update,
        app::BalacopapoApp::view,
    )
    .subscription(app::BalacopapoApp::subscription)
    .theme(app::BalacopapoApp::theme)
    .window(window::Settings {
        size: Size::new(1180.0, 760.0),
        min_size: Some(Size::new(820.0, 540.0)),
        icon: load_window_icon(),
        ..Default::default()
    })
    .run_with(app::BalacopapoApp::new)
}
