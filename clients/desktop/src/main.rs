#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod core;
mod features;
mod media;
mod net;
mod os;
mod ui;

use iced::{window, Size};

fn main() -> iced::Result {
    // Aplica silenciosamente qualquer atualização já baixada na sessão anterior (zero interação).
    os::updater::apply_staged_on_startup();

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
        ..Default::default()
    })
    .run_with(app::BalacopapoApp::new)
}
