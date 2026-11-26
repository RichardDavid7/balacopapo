#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod core;
mod features;
mod net;
mod os;
mod ui;

use iced::{window, Size};

fn main() -> iced::Result {
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
