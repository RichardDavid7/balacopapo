use iced::widget::{button, column, container, horizontal_space, row, scrollable, text, text_input};
use iced::{Alignment, Element, Length};

use crate::core::i18n::{format_clock, AppLanguage, ClockFormat};
use crate::core::models::SpaceApiKeySummary;
use crate::ui::aether_drift::{self, AppThemeId};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettingsTab {
    User,
    Group,
    Instance,
}

#[derive(Debug, Clone)]
pub struct SettingsState {
    pub active_tab: SettingsTab,
    /// Campo livre (sem presets) para a porcentagem de Vote-Skip do Grupo (`1` a `100`).
    pub vote_skip_input: String,
    pub vote_skip_saved_note: Option<String>,
    pub vote_skip_error: Option<String>,
    pub api_keys: Vec<SpaceApiKeySummary>,
    pub loading_keys: bool,
    pub retention_enabled: bool,
    pub low_interrupt_mode: bool,
    pub theme: AppThemeId,
    pub language: AppLanguage,
    pub clock_format: ClockFormat,
}

impl Default for SettingsState {
    fn default() -> Self {
        Self {
            active_tab: SettingsTab::Group,
            vote_skip_input: "50".to_string(),
            vote_skip_saved_note: None,
            vote_skip_error: None,
            api_keys: Vec::new(),
            loading_keys: false,
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
    VoteSkipInputChanged(String),
    SaveVoteSkip,
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
) -> Element<'a, SettingsAction> {
    let tabs = row![
        tab_btn("Usuário", SettingsTab::User, state.active_tab),
        tab_btn("Grupo (Espaço)", SettingsTab::Group, state.active_tab),
        tab_btn("Instância (Admin)", SettingsTab::Instance, state.active_tab),
    ]
    .spacing(8);

    let panel: Element<'a, SettingsAction> = match state.active_tab {
        SettingsTab::User => {
            let mut theme_row = row![].spacing(6);
            for &t in AppThemeId::ALL {
                let style = if t == state.theme {
                    aether_drift::primary_button_style
                } else {
                    aether_drift::ghost_button_style
                };
                theme_row = theme_row.push(
                    button(text(t.label_pt()).size(11))
                        .on_press(SettingsAction::SelectTheme(t))
                        .padding([6, 10])
                        .style(style),
                );
            }

            let mut lang_row = row![].spacing(6);
            for &lang in AppLanguage::ALL {
                let style = if lang == state.language {
                    aether_drift::primary_button_style
                } else {
                    aether_drift::ghost_button_style
                };
                lang_row = lang_row.push(
                    button(text(lang.label()).size(11))
                        .on_press(SettingsAction::SelectLanguage(lang))
                        .padding([5, 9])
                        .style(style),
                );
            }

            let clock_row = row![
                clock_btn(ClockFormat::Auto, state.clock_format),
                clock_btn(ClockFormat::H24, state.clock_format),
                clock_btn(ClockFormat::H12, state.clock_format),
            ]
            .spacing(6);

            container(
                column![
                    text("Configurações do Usuário").size(16),
                    row![
                        column![
                            text("Modo Baixa Interrupção (Zero-Stutter)").size(13),
                            text("Prioriza 0% de GPU quando ocioso e mínima interrupção de CPU em jogos.")
                                .size(12)
                                .color(aether_drift::TEXT_MUTED),
                        ]
                        .spacing(2),
                        horizontal_space(),
                        button(text(if state.low_interrupt_mode { "Ativo" } else { "Desligado" }).size(12))
                            .on_press(SettingsAction::ToggleLowInterrupt)
                            .padding([6, 12])
                            .style(if state.low_interrupt_mode {
                                aether_drift::primary_button_style
                            } else {
                                aether_drift::ghost_button_style
                            }),
                    ]
                    .align_y(Alignment::Center),
                    text("Tema de Interface (sobre Aether Drift)").size(13),
                    theme_row,
                    text("Idioma da Interface (6 idiomas)").size(13),
                    lang_row,
                    text(format!(
                        "Formato do Relógio (independente do idioma · exemplo: {})",
                        format_clock(18, 5, state.clock_format)
                    ))
                    .size(13),
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
            let mut vote_col = column![
                text(format!("Configurações do Grupo — {group_label}")).size(16),
                text("Vote-Skip de Música (% necessária de ouvintes na call — campo livre de 1 a 100)")
                    .size(12)
                    .color(aether_drift::TEXT_MUTED),
                row![
                    text_input("Ex: 50", &state.vote_skip_input)
                        .on_input(SettingsAction::VoteSkipInputChanged)
                        .on_submit(SettingsAction::SaveVoteSkip)
                        .padding(9)
                        .width(Length::Fixed(120.0))
                        .style(aether_drift::input_style),
                    text("%").size(14).color(aether_drift::TEXT_MUTED),
                    button(text("Salvar Vote-Skip").size(12))
                        .on_press(SettingsAction::SaveVoteSkip)
                        .padding([9, 14])
                        .style(aether_drift::primary_button_style),
                ]
                .spacing(8)
                .align_y(Alignment::Center),
            ]
            .spacing(8);

            if let Some(ok) = &state.vote_skip_saved_note {
                vote_col = vote_col.push(text(ok).size(12).color(aether_drift::SUCCESS_GREEN));
            }
            if let Some(err) = &state.vote_skip_error {
                vote_col = vote_col.push(text(err).size(12).color(aether_drift::DANGER_RED));
            }

            let mut keys_col = column![row![
                text("Chaves de API do Grupo (bp_... · Utilidades / Bots)").size(14),
                horizontal_space(),
                button(text(if state.loading_keys { "..." } else { "Recarregar Chaves" }).size(11))
                    .on_press(SettingsAction::RefreshApiKeys)
                    .padding([5, 10])
                    .style(aether_drift::ghost_button_style),
            ]
            .align_y(Alignment::Center)]
            .spacing(6);

            if state.api_keys.is_empty() {
                keys_col = keys_col.push(
                    text("Nenhuma chave listada (ou clique em Recarregar Chaves).")
                        .size(12)
                        .color(aether_drift::TEXT_MUTED),
                );
            } else {
                for k in &state.api_keys {
                    keys_col = keys_col.push(
                        row![
                            text(&k.name).size(13),
                            text(format!("({}...)", k.key_prefix))
                                .size(11)
                                .color(aether_drift::TEXT_MUTED),
                            horizontal_space(),
                            text(k.scopes.join(", "))
                                .size(11)
                                .color(aether_drift::ACCENT_VIOLET),
                        ]
                        .spacing(8)
                        .align_y(Alignment::Center),
                    );
                }
            }

            let retention_row = row![
                column![
                    text("Retenção de Arquivos no Chat (4 níveis)").size(14),
                    text("Protege anexos do grupo contra expiração automática (requer autorização da instância).")
                        .size(12)
                        .color(aether_drift::TEXT_MUTED),
                ]
                .spacing(2),
                horizontal_space(),
                button(text(if state.retention_enabled { "Ativada" } else { "Desativada" }).size(12))
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
                container(keys_col)
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
                    ]
                    .spacing(8),
                    text("OIDC (SSO): callback nativo registrado em balacopapo://auth/callback.")
                        .size(12)
                        .color(aether_drift::SUCCESS_GREEN),
                ]
                .spacing(10),
            )
            .width(Length::Fill)
            .padding(16)
            .style(aether_drift::card_style)
            .into()
        }
    };

    scrollable(column![text("Configurações").size(18), tabs, panel].spacing(12))
        .height(Length::Fill)
        .into()
}

fn tab_btn<'a>(label: &'a str, tab: SettingsTab, current: SettingsTab) -> Element<'a, SettingsAction> {
    let style = if tab == current {
        aether_drift::primary_button_style
    } else {
        aether_drift::ghost_button_style
    };
    button(text(label).size(12))
        .on_press(SettingsAction::SelectTab(tab))
        .padding([7, 14])
        .style(style)
        .into()
}

fn clock_btn<'a>(fmt: ClockFormat, current: ClockFormat) -> Element<'a, SettingsAction> {
    let style = if fmt == current {
        aether_drift::primary_button_style
    } else {
        aether_drift::ghost_button_style
    };
    button(text(fmt.label_pt()).size(11))
        .on_press(SettingsAction::SelectClockFormat(fmt))
        .padding([5, 10])
        .style(style)
        .into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_freeform_vote_skip_percent() {
        assert_eq!(parse_vote_skip_percent("63").unwrap(), 63);
        assert_eq!(parse_vote_skip_percent("75%").unwrap(), 75);
        assert!(parse_vote_skip_percent("0").is_err());
        assert!(parse_vote_skip_percent("101").is_err());
        assert!(parse_vote_skip_percent("abc").is_err());
    }
}
