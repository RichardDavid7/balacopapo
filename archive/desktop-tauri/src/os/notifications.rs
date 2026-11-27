//! Notificações nativas do Sistema Operacional (Windows Toast / Linux freedesktop D-Bus).
//! Executadas em thread separada para nunca travar a thread de UI (Zero-Stutter).

pub fn send_desktop_notification(title: String, body: String) {
    std::thread::spawn(move || {
        let _ = notify_rust::Notification::new()
            .appname("Balacopapo")
            .summary(&title)
            .body(&body)
            .show();
    });
}
