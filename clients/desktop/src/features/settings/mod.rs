use iced::widget::{button, column, container, horizontal_space, row, scrollable, text, text_input};
use iced::{Alignment, Element, Length};

use crate::core::i18n::{format_clock, AppLanguage, ClockFormat};
use crate::core::models::{RoleSummary, SpaceApiKeySummary};
use crate::ui::aether_drift::{self, AppThemeId};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettingsTab {
    Account,
    Appearance,
    Group,
    Instance,
}

#[derive(Debug, Clone)]
pub struct SettingsState {
    pub active_tab: SettingsTab,
    // Conta & Perfil
    pub profile_display_name: String,
    pub profile_bio: String,
    pub profile_saving: bool,
    pub profile_note: Option<String>,
    pub profile_error: Option<String>,
    // Criar Grupo
    pub new_group_name: String,
    pub group_create_note: Option<String>,
    // Grupo (Vote-Skip, Canais, API Keys, Retenção)
    /// Campo livre (sem presets) para a porcentagem de Vote-Skip do Grupo (`1` a `100`).
    pub vote_skip_input: String,
    pub vote_skip_saved_note: Option<String>,
    pub vote_skip_error: Option<String>,
    pub new_channel_name: String,
    pub new_channel_is_voice: bool,
    pub channel_create_note: Option<String>,
    pub api_keys: Vec<SpaceApiKeySummary>,
    pub new_api_key_name: String,
    pub created_api_key_secret: Option<String>,
    pub loading_keys: bool,
    pub api_keys_error: Option<String>,
    pub retention_enabled: bool,
    // Desktop & Aparência
    pub low_interrupt_mode: bool,
    pub theme: AppThemeId,
    pub language: AppLanguage,
    pub clock_format: ClockFormat,
}

impl Default for SettingsState {
    fn default() -> Self {
        Self {
            active_tab: SettingsTab::Account,
            profile_display_name: String::new(),
            profile_bio: String::new(),
            profile_saving: false,
            profile_note: None,
            profile_error: None,
            new_group_name: String::new(),
            group_create_note: None,
            vote_skip_input: "50".to_string(),
            vote_skip_saved_note: None,
            vote_skip_error: None,
            new_channel_name: String::new(),
            new_channel_is_voice: false,
            channel_create_note: None,
            api_keys: Vec::new(),
            new_api_key_name: String::new(),
            created_api_key_secret: None,
            loading_keys: false,
            api_keys_error: None,
            retention_enabled: false,
            low_interrupt_mode: true,
            theme: AppThemeId::AetherDrift,
            language: AppLanguage::Pt,
            clock_format: ClockFormat::Auto,
        }
    }
}

/// Valida o campo livre de Vote-Skip (`1` a `100`).
pub fn parse_vote_skip_percent(raw: &str) -> Result<u32, String> {
    let trimmed = raw.trim().trim_end_matches('%');
    let value = trimmed
        .parse::<u32>()
        .map_err(|_| "Digite um número inteiro entre 1 e 100.".to_string())?;
    if !(1..=100).contains(&value) {
        return Err("A porcentagem deve ficar entre 1 e 100.".to_string());
    }
    Ok(value)
}

#[derive(Debug, Clone)]
pub enum SettingsAction {
    SelectTab(SettingsTab),
    ProfileDisplayNameChanged(String),
    ProfileBioChanged(String),
    SaveProfile,
    NewGroupNameChanged(String),
    CreateGroup,
    VoteSkipInputChanged(String),
    SaveVoteSkip,
    NewChannelNameChanged(String),
    ToggleNewChannelVoice,
    CreateChannel,
    NewApiKeyNameChanged(String),
    CreateApiKey,
    RevokeApiKey(String),
    RefreshApiKeys,
    ToggleRetention,
    ToggleLowInterrupt,
    SelectTheme(AppThemeId),
    SelectLanguage(AppLanguage),
    SelectClockFormat(ClockFormat),
    OpenFeedUrl(String),
}

pub fn view<'a>(
    state: &'a SettingsState,
    instance_url: &'a str,
    group_name: Option<&'a str>,
    group_roles: &'a [RoleSummary],
) -> Element<'a, SettingsAction> {
    let tabs = row![
        tab_btn("Conta & Perfil", SettingsTab::Account, state.active_tab),
        tab_btn("Aparência", SettingsTab::Appearance, state.active_tab),
        tab_btn("Grupo (Espaço)", SettingsTab::Group, state.active_tab),
        tab_btn("Instância (Admin)", SettingsTab::Instance, state.active_tab),
    ]
    .spacing(8);

    let panel: Element<'a, SettingsAction> = match state.active_tab {
        SettingsTab::Account => {
            let mut profile_col = column![
                text("Perfil da Conta").size(16),
                text("Nome de Exibição")
                    .size(12)
                    .color(aether_drift::TEXT_MUTED),
                text_input("Seu nome exibido nos canais...", &state.profile_display_name)
                    .on_input(SettingsAction::ProfileDisplayNameChanged)
                    .padding(9)
                    .style(aether_drift::input_style),
                text("Bio / Sobre mim")
                    .size(12)
                    .color(aether_drift::TEXT_MUTED),
                text_input("Conte um pouco sobre você...", &state.profile_bio)
                    .on_input(SettingsAction::ProfileBioChanged)
                    .padding(9)
                    .style(aether_drift::input_style),
                row![
                    button(
                        text(if state.profile_saving {
                            "Salvando..."
                        } else {
                            "Salvar Perfil"
                        })
                        .size(12),
                    )
                    .on_press_maybe((!state.profile_saving).then_some(SettingsAction::SaveProfile))
                    .padding([8, 16])
                    .style(aether_drift::primary_button_style),
                ],
            ]
            .spacing(8);

            if let Some(note) = &state.profile_note {
                profile_col =
                    profile_col.push(text(note).size(12).color(aether_drift::SUCCESS_GREEN));
            }
            if let Some(err) = &state.profile_error {
                profile_col = profile_col.push(text(err).size(12).color(aether_drift::DANGER_RED));
            }

            let mut create_group_col = column![
                text("Criar Novo Grupo").size(15),
                row![
                    text_input("Nome do novo Grupo...", &state.new_group_name)
                        .on_input(SettingsAction::NewGroupNameChanged)
                        .on_submit(SettingsAction::CreateGroup)
                        .padding(9)
                        .style(aether_drift::input_style),
                    button(text("Criar Grupo").size(12))
                        .on_press_maybe(
                            (!state.new_group_name.trim().is_empty())
                                .then_some(SettingsAction::CreateGroup)
                        )
                        .padding([9, 14])
                        .style(aether_drift::primary_button_style),
                ]
                .spacing(8)
                .align_y(Alignment::Center),
            ]
            .spacing(8);

            if let Some(note) = &state.group_create_note {
                create_group_col =
                    create_group_col.push(text(note).size(12).color(aether_drift::SUCCESS_GREEN));
            }

            let desktop_card = container(
                row![
                    column![
                        text("Modo Zero-Stutter (Low CPU Interrupt Budget)").size(14),
                        text("Event-driven puro sem WebView: 0% GPU em segundo plano durante jogos.")
                            .size(12)
                            .color(aether_drift::TEXT_MUTED),
                    ]
                    .spacing(2),
                    horizontal_space(),
                    button(
                        text(if state.low_interrupt_mode {
                            "Ativo"
                        } else {
                            "Desativado"
                        })
                        .size(12),
                    )
                    .on_press(SettingsAction::ToggleLowInterrupt)
                    .padding([6, 12])
                    .style(if state.low_interrupt_mode {
                        aether_drift::primary_button_style
                    } else {
                        aether_drift::ghost_button_style
                    }),
                ]
                .align_y(Alignment::Center),
            )
            .width(Length::Fill)
            .padding(16)
            .style(aether_drift::card_style);

            column![
                container(profile_col)
                    .width(Length::Fill)
                    .padding(16)
                    .style(aether_drift::card_style),
                container(create_group_col)
                    .width(Length::Fill)
                    .padding(16)
                    .style(aether_drift::card_style),
                desktop_card,
            ]
            .spacing(12)
            .into()
        }

        SettingsTab::Appearance => {
            let mut theme_row = row![].spacing(6);
            for &t in AppThemeId::ALL {
                let active = state.theme == t;
                theme_row = theme_row.push(
                    button(text(t.label_pt()).size(12))
                        .on_press(SettingsAction::SelectTheme(t))
                        .padding([6, 12])
                        .style(if active {
                            aether_drift::primary_button_style
                        } else {
                            aether_drift::ghost_button_style
                        }),
                );
            }

            let mut lang_row = row![].spacing(6);
            for &l in AppLanguage::ALL {
                let active = state.language == l;
                lang_row = lang_row.push(
                    button(text(l.label()).size(11))
                        .on_press(SettingsAction::SelectLanguage(l))
                        .padding([5, 10])
                        .style(if active {
                            aether_drift::primary_button_style
                        } else {
                            aether_drift::ghost_button_style
                        }),
                );
            }

            let clock_row = row![
                clock_btn("Auto", ClockFormat::Auto, state.clock_format),
                clock_btn("24h", ClockFormat::H24, state.clock_format),
                clock_btn("12h (AM/PM)", ClockFormat::H12, state.clock_format),
                horizontal_space(),
                text(format!(
                    "Exemplo: {}",
                    format_clock(21, 45, state.clock_format)
                ))
                .size(12)
                .color(aether_drift::TEXT_MUTED),
            ]
            .spacing(6)
            .align_y(Alignment::Center);

            container(
                column![
                    text("Aparência, Idioma e Região").size(16),
                    text("Tema (Aether Drift)")
                        .size(12)
                        .color(aether_drift::TEXT_MUTED),
                    theme_row,
                    text("Idioma da Interface (6 idiomas)")
                        .size(12)
                        .color(aether_drift::TEXT_MUTED),
                    lang_row,
                    text("Formato de Relógio (independente do idioma)")
                        .size(12)
                        .color(aether_drift::TEXT_MUTED),
                    clock_row,
                ]
                .spacing(10),
            )
            .width(Length::Fill)
            .padding(16)
            .style(aether_drift::card_style)
            .into()
        }

        SettingsTab::Group => {
            let group_label = group_name.unwrap_or("Nenhum grupo selecionado");

            // 1. Vote-Skip (campo livre 1-100%, sem presets)
            let mut vote_col = column![
                text(format!("Configurações do Grupo — {group_label}")).size(16),
                text("Vote-Skip de Música (% necessária de ouvintes na call — campo livre de 1 a 100)")
                    .size(12)
                    .color(aether_drift::TEXT_MUTED),
                row![
                    text_input("1 a 100", &state.vote_skip_input)
                        .on_input(SettingsAction::VoteSkipInputChanged)
                        .on_submit(SettingsAction::SaveVoteSkip)
                        .width(Length::Fixed(120.0))
                        .padding(8)
                        .style(aether_drift::input_style),
                    text("%").size(14).color(aether_drift::TEXT_MUTED),
                    button(text("Salvar").size(12))
                        .on_press(SettingsAction::SaveVoteSkip)
                        .padding([8, 14])
                        .style(aether_drift::primary_button_style),
                ]
                .spacing(8)
                .align_y(Alignment::Center),
            ]
            .spacing(8);

            if let Some(note) = &state.vote_skip_saved_note {
                vote_col = vote_col.push(text(note).size(12).color(aether_drift::SUCCESS_GREEN));
            }
            if let Some(err) = &state.vote_skip_error {
                vote_col = vote_col.push(text(err).size(12).color(aether_drift::DANGER_RED));
            }

            // 2. Criar Canal no Grupo
            let mut ch_col = column![
                text("Criar Canal no Grupo").size(14),
                row![
                    text_input("Nome do canal (ex.: jogatina)", &state.new_channel_name)
                        .on_input(SettingsAction::NewChannelNameChanged)
                        .on_submit(SettingsAction::CreateChannel)
                        .padding(8)
                        .style(aether_drift::input_style),
                    button(
                        text(if state.new_channel_is_voice {
                            "Tipo: Voz"
                        } else {
                            "Tipo: Texto"
                        })
                        .size(12),
                    )
                    .on_press(SettingsAction::ToggleNewChannelVoice)
                    .padding([8, 12])
                    .style(aether_drift::ghost_button_style),
                    button(text("Criar").size(12))
                        .on_press_maybe(
                            (!state.new_channel_name.trim().is_empty())
                                .then_some(SettingsAction::CreateChannel)
                        )
                        .padding([8, 14])
                        .style(aether_drift::primary_button_style),
                ]
                .spacing(8)
                .align_y(Alignment::Center),
            ]
            .spacing(8);

            if let Some(note) = &state.channel_create_note {
                ch_col = ch_col.push(text(note).size(12).color(aether_drift::SUCCESS_GREEN));
            }

            // 3. API Keys (CRUD completo)
            let mut keys_col = column![
                row![
                    text("Chaves de API do Grupo (bp_... · Bot de Música & Apps)").size(14),
                    horizontal_space(),
                    button(text(if state.loading_keys { "..." } else { "Recarregar" }).size(11))
                        .on_press_maybe(
                            (!state.loading_keys).then_some(SettingsAction::RefreshApiKeys)
                        )
                        .padding([4, 10])
                        .style(aether_drift::ghost_button_style),
                ]
                .align_y(Alignment::Center),
                row![
                    text_input(
                        "Nome da nova chave (ex.: Bot de Música)",
                        &state.new_api_key_name,
                    )
                    .on_input(SettingsAction::NewApiKeyNameChanged)
                    .on_submit(SettingsAction::CreateApiKey)
                    .padding(8)
                    .style(aether_drift::input_style),
                    button(text("Gerar Chave").size(12))
                        .on_press_maybe(
                            (!state.new_api_key_name.trim().is_empty())
                                .then_some(SettingsAction::CreateApiKey)
                        )
                        .padding([8, 14])
                        .style(aether_drift::primary_button_style),
                ]
                .spacing(8)
                .align_y(Alignment::Center),
            ]
            .spacing(8);

            if let Some(secret) = &state.created_api_key_secret {
                keys_col = keys_col.push(
                    container(
                        column![
                            text("Chave gerada (copie agora — só é exibida uma vez):")
                                .size(11)
                                .color(aether_drift::SUCCESS_GREEN),
                            text(secret).size(12).color(aether_drift::TEXT_PRIMARY),
                        ]
                        .spacing(3),
                    )
                    .width(Length::Fill)
                    .padding(10)
                    .style(aether_drift::pill_style),
                );
            }

            if state.api_keys.is_empty() {
                keys_col = keys_col.push(
                    text("Nenhuma chave de API encontrada para este grupo.")
                        .size(12)
                        .color(aether_drift::TEXT_MUTED),
                );
            } else {
                for key in &state.api_keys {
                    keys_col = keys_col.push(
                        row![
                            text(&key.name).size(13),
                            text(format!("({}...)", key.key_prefix))
                                .size(11)
                                .color(aether_drift::TEXT_MUTED),
                            horizontal_space(),
                            text(key.scopes.join(", "))
                                .size(11)
                                .color(aether_drift::TEXT_MUTED),
                            button(text("Revogar").size(11).color(aether_drift::DANGER_RED))
                                .on_press(SettingsAction::RevokeApiKey(key.id.clone()))
                                .padding([3, 8])
                                .style(aether_drift::ghost_button_style),
                        ]
                        .spacing(8)
                        .align_y(Alignment::Center),
                    );
                }
            }

            if let Some(err) = &state.api_keys_error {
                keys_col = keys_col.push(text(err).size(12).color(aether_drift::DANGER_RED));
            }

            // 4. Cargos do Grupo
            let mut roles_col = column![text(format!("Cargos do Grupo ({})", group_roles.len())).size(14)]
                .spacing(6);
            if group_roles.is_empty() {
                roles_col = roles_col.push(
                    text("Nenhum cargo carregado.")
                        .size(12)
                        .color(aether_drift::TEXT_MUTED),
                );
            } else {
                let mut rrow = row![].spacing(6);
                for role in group_roles.iter().take(10) {
                    rrow = rrow.push(
                        container(text(&role.name).size(11))
                            .padding([3, 8])
                            .style(aether_drift::pill_style),
                    );
                }
                roles_col = roles_col.push(rrow);
            }

            let retention_row = row![
                column![
                    text("Retenção de Arquivos no Chat (4 níveis)").size(14),
                    text("Protege anexos do grupo contra expiração automática.")
                        .size(12)
                        .color(aether_drift::TEXT_MUTED),
                ]
                .spacing(2),
                horizontal_space(),
                button(
                    text(if state.retention_enabled {
                        "Ativada"
                    } else {
                        "Desativada"
                    })
                    .size(12),
                )
                .on_press(SettingsAction::ToggleRetention)
                .padding([6, 12])
                .style(if state.retention_enabled {
                    aether_drift::primary_button_style
                } else {
                    aether_drift::ghost_button_style
                }),
            ]
            .align_y(Alignment::Center);

            column![
                container(vote_col)
                    .width(Length::Fill)
                    .padding(16)
                    .style(aether_drift::card_style),
                container(ch_col)
                    .width(Length::Fill)
                    .padding(16)
                    .style(aether_drift::card_style),
                container(keys_col)
                    .width(Length::Fill)
                    .padding(16)
                    .style(aether_drift::card_style),
                container(roles_col)
                    .width(Length::Fill)
                    .padding(16)
                    .style(aether_drift::card_style),
                container(retention_row)
                    .width(Length::Fill)
                    .padding(16)
                    .style(aether_drift::card_style),
            ]
            .spacing(12)
            .into()
        }

        SettingsTab::Instance => {
            let base = instance_url.trim_end_matches('/');
            let opnsense_url = format!("{base}/api/admin/ip-bans/feed?format=opnsense");
            let nginx_url = format!("{base}/api/admin/ip-bans/feed?format=nginx");

            container(
                column![
                    text("Administração da Instância").size(16),
                    text(format!("Instância conectada: {base}"))
                        .size(12)
                        .color(aether_drift::TEXT_MUTED),
                    text("Ban IP · Feeds de Firewall (OPNsense URL Table / Nginx deny)").size(14),
                    row![
                        button(text("Abrir Feed OPNsense").size(12))
                            .on_press(SettingsAction::OpenFeedUrl(opnsense_url))
                            .padding([7, 12])
                            .style(aether_drift::ghost_button_style),
                        button(text("Abrir Feed Nginx").size(12))
                            .on_press(SettingsAction::OpenFeedUrl(nginx_url))
                            .padding([7, 12])
                            .style(aether_drift::ghost_button_style),
                        button(text("Abrir Painel Web da Instância").size(12))
                            .on_press(SettingsAction::OpenFeedUrl(base.to_string()))
                            .padding([7, 12])
                            .style(aether_drift::primary_button_style),
                    ]
                    .spacing(8),
                    text(format!(
                        "Versão do Cliente Desktop: v{} (Rust Nativo · Iced + wgpu)",
                        env!("CARGO_PKG_VERSION")
                    ))
                    .size(12)
                    .color(aether_drift::TEXT_MUTED),
                ]
                .spacing(10),
            )
            .width(Length::Fill)
            .padding(16)
            .style(aether_drift::card_style)
            .into()
        }
    };

    scrollable(column![tabs, panel].spacing(14))
        .height(Length::Fill)
        .into()
}

fn tab_btn<'a>(
    label: &'a str,
    tab: SettingsTab,
    current: SettingsTab,
) -> Element<'a, SettingsAction> {
    button(text(label).size(12))
        .on_press(SettingsAction::SelectTab(tab))
        .padding([7, 14])
        .style(if tab == current {
            aether_drift::primary_button_style
        } else {
            aether_drift::ghost_button_style
        })
        .into()
}

fn clock_btn<'a>(
    label: &'a str,
    fmt: ClockFormat,
    current: ClockFormat,
) -> Element<'a, SettingsAction> {
    button(text(label).size(12))
        .on_press(SettingsAction::SelectClockFormat(fmt))
        .padding([5, 10])
        .style(if fmt == current {
            aether_drift::primary_button_style
        } else {
            aether_drift::ghost_button_style
        })
        .into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_free_form_vote_skip_percent() {
        assert_eq!(parse_vote_skip_percent("60"), Ok(60));
        assert_eq!(parse_vote_skip_percent("1%"), Ok(1));
        assert_eq!(parse_vote_skip_percent("100"), Ok(100));
        assert!(parse_vote_skip_percent("0").is_err());
        assert!(parse_vote_skip_percent("101").is_err());
        assert!(parse_vote_skip_percent("abc").is_err());
    }
}
