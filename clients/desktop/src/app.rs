use iced::{Element, Subscription, Task, Theme};

use crate::core::config::{normalize_instance_url, AppConfig};
use crate::core::deep_link::{parse_deep_link, DeepLinkTarget};
use crate::core::models::{AuthUser, GroupSummary, InstanceInfo, LoginResponse};
use crate::features::auth::{self, AuthMessage, AuthState};
use crate::features::shell::{self, ShellMessage, ShellState};
use crate::net::client::ApiClient;
use crate::os::updater::{self, UpdateCheckState};
use crate::ui::aether_drift;

pub enum Screen {
    Auth(AuthState),
    Shell(ShellState),
}

pub struct BalacopapoApp {
    config: AppConfig,
    screen: Screen,
    update_state: UpdateCheckState,
}

#[derive(Debug, Clone)]
pub enum Message {
    Auth(AuthMessage),
    Shell(ShellMessage),
    InstanceProbed(Result<(String, InstanceInfo), String>),
    LoginCompleted(Result<(String, LoginResponse), String>),
    SessionRestored(Result<(String, AuthUser), String>),
    GroupsLoaded(Result<Vec<GroupSummary>, String>),
    UpdateChecked(UpdateCheckState),
}

impl BalacopapoApp {
    pub fn new() -> (Self, Task<Message>) {
        let mut config = AppConfig::load();
        let raw_args: Vec<String> = std::env::args().collect();

        // Suporte cold-start para `balacopapo://auth/callback?token=...`
        let mut initial_note: Option<String> = None;
        for arg in &raw_args {
            if let Some(target) = parse_deep_link(arg) {
                match target {
                    DeepLinkTarget::OidcCallback { token, instance } => {
                        if let Some(url) = instance.and_then(|u| normalize_instance_url(&u).ok()) {
                            config.instance_url = Some(url);
                        }
                        config.auth_token = Some(token);
                        let _ = config.save();
                    }
                    DeepLinkTarget::Invite { code, instance } => {
                        if let Some(url) = instance.and_then(|u| normalize_instance_url(&u).ok()) {
                            config.instance_url = Some(url);
                        }
                        initial_note = Some(format!("Convite detectado: {code}"));
                    }
                    DeepLinkTarget::InternalRoute { path } => {
                        initial_note = Some(format!("Rota solicitada: {path}"));
                    }
                }
            }
        }

        let mut auth_state = AuthState::new(config.instance_url.clone());
        auth_state.status_note = initial_note;

        let mut tasks = vec![Task::perform(
            updater::check_github_updates(),
            Message::UpdateChecked,
        )];

        if let (Some(url), Some(token)) = (config.instance_url.clone(), config.auth_token.clone()) {
            auth_state.busy = true;
            auth_state.status_note = Some("Restaurando sessão salva...".to_string());
            tasks.push(Task::perform(
                async move {
                    let client = ApiClient::new(url.clone(), Some(token))?;
                    let user = client.fetch_me().await?;
                    Ok((url, user))
                },
                Message::SessionRestored,
            ));
        }

        let app = Self {
            config,
            screen: Screen::Auth(auth_state),
            update_state: UpdateCheckState::Checking,
        };

        (app, Task::batch(tasks))
    }

    pub fn title(&self) -> String {
        match &self.screen {
            Screen::Auth(_) => "Balacopapo".to_string(),
            Screen::Shell(shell) => format!("Balacopapo — {}", shell.user.label()),
        }
    }

    pub fn theme(&self) -> Theme {
        aether_drift::theme()
    }

    /// 100% Event-Driven: zero timers/polling em segundo plano (Zero-Stutter Budget).
    pub fn subscription(&self) -> Subscription<Message> {
        Subscription::none()
    }

    pub fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::Auth(msg) => self.handle_auth(msg),
            Message::Shell(msg) => self.handle_shell(msg),
            Message::InstanceProbed(result) => {
                if let Screen::Auth(state) = &mut self.screen {
                    state.busy = false;
                    match result {
                        Ok((url, info)) => {
                            state.instance_url_input = url.clone();
                            state.instance_info = Some(info);
                            state.error = None;
                            self.config.instance_url = Some(url);
                            let _ = self.config.save();
                        }
                        Err(err) => {
                            state.error = Some(err);
                        }
                    }
                }
                Task::none()
            }
            Message::LoginCompleted(result) => match result {
                Ok((url, resp)) => {
                    self.config.instance_url = Some(url.clone());
                    self.config.auth_token = Some(resp.token.clone());
                    let _ = self.config.save();
                    self.screen = Screen::Shell(ShellState::new(url.clone(), resp.user));
                    Self::load_groups_task(url, resp.token)
                }
                Err(err) => {
                    if let Screen::Auth(state) = &mut self.screen {
                        state.busy = false;
                        state.error = Some(err);
                    }
                    Task::none()
                }
            },
            Message::SessionRestored(result) => match result {
                Ok((url, user)) => {
                    let token = self.config.auth_token.clone().unwrap_or_default();
                    self.screen = Screen::Shell(ShellState::new(url.clone(), user));
                    Self::load_groups_task(url, token)
                }
                Err(_) => {
                    self.config.auth_token = None;
                    let _ = self.config.save();
                    if let Screen::Auth(state) = &mut self.screen {
                        state.busy = false;
                        state.status_note = Some("Sessão expirada. Faça login novamente.".to_string());
                    }
                    Task::none()
                }
            },
            Message::GroupsLoaded(result) => {
                if let Screen::Shell(shell) = &mut self.screen {
                    shell.loading_groups = false;
                    match result {
                        Ok(groups) => {
                            shell.error = None;
                            if shell.selected_group_id.is_none() {
                                shell.selected_group_id = groups.first().map(|g| g.id.clone());
                            }
                            shell.groups = groups;
                        }
                        Err(err) => {
                            shell.error = Some(err);
                        }
                    }
                }
                Task::none()
            }
            Message::UpdateChecked(status) => {
                self.update_state = status;
                Task::none()
            }
        }
    }

    pub fn view(&self) -> Element<'_, Message> {
        match &self.screen {
            Screen::Auth(state) => auth::view(state, &self.update_state).map(Message::Auth),
            Screen::Shell(state) => shell::view(state, &self.update_state).map(Message::Shell),
        }
    }

    fn handle_auth(&mut self, msg: AuthMessage) -> Task<Message> {
        let Screen::Auth(state) = &mut self.screen else {
            return Task::none();
        };

        match msg {
            AuthMessage::InstanceUrlChanged(v) => {
                state.instance_url_input = v;
                state.error = None;
                Task::none()
            }
            AuthMessage::UsernameChanged(v) => {
                state.username_input = v;
                state.error = None;
                Task::none()
            }
            AuthMessage::PasswordChanged(v) => {
                state.password_input = v;
                state.error = None;
                Task::none()
            }
            AuthMessage::ProbeInstance => match normalize_instance_url(&state.instance_url_input) {
                Ok(url) => {
                    state.busy = true;
                    state.error = None;
                    Task::perform(
                        async move {
                            let client = ApiClient::new(url.clone(), None)?;
                            let info = client.fetch_instance_info().await?;
                            Ok((url, info))
                        },
                        Message::InstanceProbed,
                    )
                }
                Err(err) => {
                    state.error = Some(err);
                    Task::none()
                }
            },
            AuthMessage::SubmitLogin => {
                let url = match normalize_instance_url(&state.instance_url_input) {
                    Ok(u) => u,
                    Err(err) => {
                        state.error = Some(err);
                        return Task::none();
                    }
                };
                if state.username_input.trim().is_empty() || state.password_input.is_empty() {
                    state.error = Some("Preencha usuário e senha.".to_string());
                    return Task::none();
                }
                let username = state.username_input.clone();
                let password = state.password_input.clone();
                state.busy = true;
                state.error = None;

                Task::perform(
                    async move {
                        let client = ApiClient::new(url.clone(), None)?;
                        let resp = client.login(&username, &password).await?;
                        Ok((url, resp))
                    },
                    Message::LoginCompleted,
                )
            }
            AuthMessage::StartOidc => match normalize_instance_url(&state.instance_url_input) {
                Ok(url) => {
                    if let Ok(client) = ApiClient::new(url, None) {
                        let _ = open::that(client.oidc_start_url());
                        state.status_note = Some(
                            "Navegador aberto para autenticação OIDC (balacopapo://auth/callback)."
                                .to_string(),
                        );
                    }
                    Task::none()
                }
                Err(err) => {
                    state.error = Some(err);
                    Task::none()
                }
            },
            AuthMessage::CheckUpdates => {
                self.update_state = UpdateCheckState::Checking;
                Task::perform(updater::check_github_updates(), Message::UpdateChecked)
            }
            AuthMessage::OpenReleasePage(url) => {
                let _ = open::that(url);
                Task::none()
            }
        }
    }

    fn handle_shell(&mut self, msg: ShellMessage) -> Task<Message> {
        let Screen::Shell(shell) = &mut self.screen else {
            return Task::none();
        };

        match msg {
            ShellMessage::SelectGroup(id) => {
                shell.selected_group_id = Some(id);
                shell.selected_channel_id = None;
                Task::none()
            }
            ShellMessage::SelectChannel(id) => {
                shell.selected_channel_id = Some(id);
                Task::none()
            }
            ShellMessage::RefreshGroups => {
                shell.loading_groups = true;
                let url = shell.instance_url.clone();
                let token = self.config.auth_token.clone().unwrap_or_default();
                Self::load_groups_task(url, token)
            }
            ShellMessage::OpenReleasePage(url) => {
                let _ = open::that(url);
                Task::none()
            }
            ShellMessage::Logout => {
                self.config.auth_token = None;
                let _ = self.config.save();
                self.screen = Screen::Auth(AuthState::new(self.config.instance_url.clone()));
                Task::none()
            }
        }
    }

    fn load_groups_task(url: String, token: String) -> Task<Message> {
        Task::perform(
            async move {
                let client = ApiClient::new(url, Some(token))?;
                client.fetch_groups().await
            },
            Message::GroupsLoaded,
        )
    }
}
