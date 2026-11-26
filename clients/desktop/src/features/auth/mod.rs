use iced::widget::{button, column, container, horizontal_space, row, text, text_input};
use iced::{Alignment, Element, Length};

use crate::core::models::InstanceInfo;
use crate::os::updater::UpdateCheckState;
use crate::ui::aether_drift;

#[derive(Debug, Clone)]
pub struct AuthState {
    pub instance_url_input: String,
    pub username_input: String,
    pub password_input: String,
    pub instance_info: Option<InstanceInfo>,
    pub busy: bool,
    pub error: Option<String>,
    pub status_note: Option<String>,
}

impl AuthState {
    pub fn new(saved_url: Option<String>) -> Self {
        Self {
            instance_url_input: saved_url.unwrap_or_default(),
            username_input: String::new(),
            password_input: String::new(),
            instance_info: None,
            busy: false,
            error: None,
            status_note: None,
        }
    }
}

#[derive(Debug, Clone)]
pub enum AuthMessage {
    InstanceUrlChanged(String),
    UsernameChanged(String),
    PasswordChanged(String),
    ProbeInstance,
    SubmitLogin,
    StartOidc,
    CheckUpdates,
    ApplyStagedUpdate(std::path::PathBuf),
    OpenReleasePage(String),
}

pub fn view<'a>(
    state: &'a AuthState,
    update_state: &'a UpdateCheckState,
) -> Element<'a, AuthMessage> {
    let header = row![
        container(text("B").size(20).color(iced::Color::WHITE))
            .width(42)
            .height(42)
            .center(Length::Fixed(42.0))
            .style(|_t| container::Style {
                background: Some(iced::Background::Color(aether_drift::ACCENT_VIOLET)),
                border: iced::Border {
                    radius: 12.0.into(),
                    ..Default::default()
                },
                ..Default::default()
            }),
        column![
            text("Balacopapo Desktop").size(20),
            text("100% Nativo Rust · Iced + wgpu · Zero WebView")
                .size(12)
                .color(aether_drift::TEXT_MUTED),
        ]
        .spacing(2),
    ]
    .spacing(12)
    .align_y(Alignment::Center);

    let url_input = text_input(
        "https://balacopapo.seudominio.com",
        &state.instance_url_input,
    )
    .on_input(AuthMessage::InstanceUrlChanged)
    .on_submit(AuthMessage::ProbeInstance)
    .padding(11)
    .style(aether_drift::input_style);

    let probe_btn = button(text(if state.busy { "..." } else { "Verificar" }).size(13))
        .on_press_maybe((!state.busy).then_some(AuthMessage::ProbeInstance))
        .padding([11, 14])
        .style(aether_drift::ghost_button_style);

    let instance_row = row![url_input, probe_btn]
        .spacing(8)
        .align_y(Alignment::Center);

    let mut form = column![
        header,
        text("URL da instância").size(13).color(aether_drift::TEXT_MUTED),
        instance_row,
    ]
    .spacing(10);

    if let Some(info) = &state.instance_info {
        let label = match &info.version {
            Some(v) => format!("Instância: {} (v{v})", info.name),
            None => format!("Instância: {}", info.name),
        };
        form = form.push(
            container(text(label).size(12).color(aether_drift::SUCCESS_GREEN))
                .padding([6, 10])
                .style(aether_drift::pill_style),
        );
    }

    let user_input = text_input("Usuário ou e-mail", &state.username_input)
        .on_input(AuthMessage::UsernameChanged)
        .on_submit(AuthMessage::SubmitLogin)
        .padding(11)
        .style(aether_drift::input_style);

    let pass_input = text_input("Senha", &state.password_input)
        .on_input(AuthMessage::PasswordChanged)
        .on_submit(AuthMessage::SubmitLogin)
        .secure(true)
        .padding(11)
        .style(aether_drift::input_style);

    let login_btn = button(
        text(if state.busy {
            "Conectando..."
        } else {
            "Entrar"
        })
        .size(14),
    )
    .width(Length::Fill)
    .padding([11, 16])
    .on_press_maybe((!state.busy).then_some(AuthMessage::SubmitLogin))
    .style(aether_drift::primary_button_style);

    form = form
        .push(text("Conta").size(13).color(aether_drift::TEXT_MUTED))
        .push(user_input)
        .push(pass_input)
        .push(login_btn);

    let oidc_label = state
        .instance_info
        .as_ref()
        .and_then(|i| i.oidc.display_name.as_deref())
        .filter(|s| !s.trim().is_empty())
        .map(|name| format!("Entrar com {name} (Navegador / OIDC)"))
        .unwrap_or_else(|| "Entrar com SSO / OIDC (Navegador)".to_string());

    let show_oidc = state
        .instance_info
        .as_ref()
        .map(|i| i.oidc.enabled)
        .unwrap_or(true);

    if show_oidc {
        let oidc_btn = button(text(oidc_label).size(13))
            .width(Length::Fill)
            .padding([10, 14])
            .on_press_maybe((!state.busy).then_some(AuthMessage::StartOidc))
            .style(aether_drift::ghost_button_style);
        form = form.push(oidc_btn);
    }

    if let Some(err) = &state.error {
        form = form.push(text(err).size(12).color(aether_drift::DANGER_RED));
    }
    if let Some(note) = &state.status_note {
        form = form.push(text(note).size(12).color(aether_drift::TEXT_MUTED));
    }

    let update_widget: Element<'a, AuthMessage> = match update_state {
        UpdateCheckState::Idle => button(text("Verificar atualizações").size(12))
            .on_press(AuthMessage::CheckUpdates)
            .padding([4, 8])
            .style(aether_drift::ghost_button_style)
            .into(),
        UpdateCheckState::Checking => text("Verificando...")
            .size(12)
            .color(aether_drift::TEXT_MUTED)
            .into(),
        UpdateCheckState::UpToDate => text("Atualizado")
            .size(12)
            .color(aether_drift::SUCCESS_GREEN)
            .into(),
        UpdateCheckState::Downloading { version } => text(format!("Baixando {version}..."))
            .size(11)
            .color(aether_drift::TEXT_MUTED)
            .into(),
        UpdateCheckState::ReadyToRestart {
            version,
            staged_path,
        } => button(text(format!("Atualizar {version}")).size(11))
            .on_press(AuthMessage::ApplyStagedUpdate(staged_path.clone()))
            .padding([3, 8])
            .style(aether_drift::primary_button_style)
            .into(),
        UpdateCheckState::AvailableManual {
            version,
            release_url,
        } => button(text(format!("Nova {version}")).size(11))
            .on_press(AuthMessage::OpenReleasePage(release_url.clone()))
            .padding([3, 8])
            .style(aether_drift::ghost_button_style)
            .into(),
        UpdateCheckState::Failed(msg) => text(format!("Update: {msg}"))
            .size(11)
            .color(aether_drift::TEXT_MUTED)
            .into(),
    };

    let footer = row![
        text(format!("v{}", env!("CARGO_PKG_VERSION")))
            .size(12)
            .color(aether_drift::TEXT_MUTED),
        horizontal_space(),
        update_widget,
    ]
    .align_y(Alignment::Center);

    form = form.push(footer);

    let card = container(form)
        .width(Length::Fixed(440.0))
        .padding(26)
        .style(aether_drift::card_style);

    container(card).center(Length::Fill).into()
}
