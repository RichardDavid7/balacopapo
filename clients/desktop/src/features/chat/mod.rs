use iced::widget::{
    button, column, container, horizontal_space, image, row, scrollable, text, text_input,
};
use iced::{Alignment, Background, Border, Color, ContentFit, Element, Length, Padding};
use std::collections::HashMap;

use crate::core::models::ChatMessage;
use crate::ui::aether_drift;

#[derive(Debug, Clone, Default)]
pub struct ChatState {
    pub messages_by_channel: HashMap<String, Vec<ChatMessage>>,
    pub draft: String,
    pub search_query: String,
    pub show_search: bool,
    pub replying_to: Option<(String, String)>,
    pub editing_message_id: Option<String>,
    pub edit_draft: String,
    pub typing_users: HashMap<String, String>,
    pub loading_history: bool,
    pub sending: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub enum ChatMessageAction {
    DraftChanged(String),
    SearchChanged(String),
    ToggleSearch,
    Send,
    LoadOlder,
    StartReply { message_id: String, author: String },
    CancelReply,
    StartEdit { message_id: String, current_text: String },
    EditDraftChanged(String),
    CommitEdit,
    CancelEdit,
    OpenUrl(String),
    DeleteMessage(String),
}

impl ChatState {
    pub fn upsert_message(&mut self, msg: ChatMessage) {
        let entry = self
            .messages_by_channel
            .entry(msg.channel_id.clone())
            .or_default();
        if let Some(existing) = entry.iter_mut().find(|m| m.id == msg.id) {
            *existing = msg;
        } else {
            entry.push(msg);
        }
    }

    pub fn prepend_history(&mut self, channel_id: &str, older: Vec<ChatMessage>) {
        let entry = self
            .messages_by_channel
            .entry(channel_id.to_string())
            .or_default();
        let mut combined = Vec::with_capacity(older.len() + entry.len());
        for m in older {
            if !entry.iter().any(|e| e.id == m.id) {
                combined.push(m);
            }
        }
        combined.append(entry);
        *entry = combined;
    }

    pub fn remove_message(&mut self, channel_id: &str, message_id: &str) {
        if let Some(list) = self.messages_by_channel.get_mut(channel_id) {
            list.retain(|m| m.id != message_id);
        }
    }

    pub fn oldest_message_id(&self, channel_id: &str) -> Option<String> {
        self.messages_by_channel
            .get(channel_id)
            .and_then(|list| list.first())
            .map(|m| m.id.clone())
    }
}

fn initials_of(name: &str) -> String {
    let mut out = String::new();
    for part in name.split_whitespace().take(2) {
        if let Some(ch) = part.chars().next() {
            out.push(ch.to_ascii_uppercase());
        }
    }
    if out.is_empty() {
        "U".to_string()
    } else {
        out
    }
}

fn extract_urls(body: &str) -> Vec<String> {
    body.split_whitespace()
        .filter(|w| w.starts_with("https://") || w.starts_with("http://"))
        .map(|w| {
            w.trim_end_matches([')', ']', ',', '.', ';', '!', '?'])
                .to_string()
        })
        .take(3)
        .collect()
}

fn resolve_instance_url(base_url: &str, path: &str) -> String {
    if path.starts_with("http://") || path.starts_with("https://") {
        path.to_string()
    } else {
        format!(
            "{}/{}",
            base_url.trim_end_matches('/'),
            path.trim_start_matches('/')
        )
    }
}

pub fn view<'a>(
    state: &'a ChatState,
    channel_id: &'a str,
    channel_label: &'a str,
    current_user_id: &'a str,
    instance_url: &'a str,
    image_cache: &'a HashMap<String, image::Handle>,
) -> Element<'a, ChatMessageAction> {
    let messages = state
        .messages_by_channel
        .get(channel_id)
        .map(Vec::as_slice)
        .unwrap_or(&[]);

    let query = state.search_query.trim().to_ascii_lowercase();
    let mut feed = column![].spacing(2).padding([12, 18]);

    // Barra discreta de busca no canal
    let search_bar: Element<'a, ChatMessageAction> = if state.show_search {
        container(
            row![
                text_input("Buscar mensagens ou autor neste canal...", &state.search_query)
                    .on_input(ChatMessageAction::SearchChanged)
                    .padding(7)
                    .style(aether_drift::input_style),
                button(text("Fechar").size(11))
                    .on_press(ChatMessageAction::ToggleSearch)
                    .padding([6, 10])
                    .style(aether_drift::ghost_button_style),
            ]
            .spacing(8)
            .align_y(Alignment::Center),
        )
        .padding([8, 18])
        .into()
    } else {
        container(
            row![
                horizontal_space(),
                button(text("Buscar no canal").size(11).color(aether_drift::TEXT_MUTED))
                    .on_press(ChatMessageAction::ToggleSearch)
                    .padding([3, 8])
                    .style(aether_drift::icon_button_style(false)),
            ]
            .align_y(Alignment::Center),
        )
        .padding([4, 14])
        .into()
    };

    if !messages.is_empty() {
        let load_btn = button(
            text(if state.loading_history {
                "Carregando..."
            } else {
                "Carregar mensagens anteriores"
            })
            .size(12),
        )
        .on_press_maybe((!state.loading_history).then_some(ChatMessageAction::LoadOlder))
        .padding([6, 12])
        .style(aether_drift::ghost_button_style);
        feed = feed.push(
            container(load_btn)
                .padding(Padding {
                    top: 0.0,
                    right: 0.0,
                    bottom: 10.0,
                    left: 0.0,
                })
                .center_x(Length::Fill),
        );
    }

    if state.loading_history && messages.is_empty() {
        feed = feed.push(
            text("Carregando histórico...")
                .size(13)
                .color(aether_drift::TEXT_MUTED),
        );
    } else if messages.is_empty() {
        feed = feed.push(
            column![
                text(format!("Início de {channel_label}")).size(18),
                text("Nenhuma mensagem por aqui ainda. Envie a primeira abaixo.")
                    .size(13)
                    .color(aether_drift::TEXT_MUTED),
            ]
            .spacing(4),
        );
    } else {
        let mut last_author: Option<&str> = None;
        for msg in messages {
            let body = msg.body_text();
            if !query.is_empty()
                && !body.to_ascii_lowercase().contains(&query)
                && !msg.author_label().to_ascii_lowercase().contains(&query)
            {
                continue;
            }

            let author = msg.author_label();
            let has_reply = msg.reply_to.is_some();
            let is_editing = state.editing_message_id.as_deref() == Some(msg.id.as_str());
            let grouped = last_author == Some(author) && !has_reply && !is_editing;
            last_author = Some(author);

            let is_mine = msg.user_id.as_deref() == Some(current_user_id);
            let time_str = msg.short_time();
            let edited_tag = if msg.is_edited() { " (editada)" } else { "" };

            let mut msg_body_col = column![].spacing(4);

            // Citação de resposta (Reply)
            if let Some(rep) = &msg.reply_to {
                let rep_author = rep
                    .user
                    .as_ref()
                    .map(|u| u.label())
                    .unwrap_or("Mensagem anterior");
                let rep_snippet = rep
                    .content
                    .as_deref()
                    .unwrap_or("[anexo]")
                    .chars()
                    .take(80)
                    .collect::<String>();
                msg_body_col = msg_body_col.push(
                    container(
                        text(format!("Respondendo a @{rep_author}: {rep_snippet}"))
                            .size(11)
                            .color(aether_drift::TEXT_MUTED),
                    )
                    .padding([3, 8])
                    .style(aether_drift::pill_style),
                );
            }

            // Corpo da mensagem ou editor inline
            if is_editing {
                msg_body_col = msg_body_col.push(
                    row![
                        text_input("Editar mensagem...", &state.edit_draft)
                            .on_input(ChatMessageAction::EditDraftChanged)
                            .on_submit(ChatMessageAction::CommitEdit)
                            .padding(8)
                            .style(aether_drift::input_style),
                        button(text("Salvar").size(11))
                            .on_press(ChatMessageAction::CommitEdit)
                            .padding([7, 12])
                            .style(aether_drift::primary_button_style),
                        button(text("Cancelar").size(11))
                            .on_press(ChatMessageAction::CancelEdit)
                            .padding([7, 10])
                            .style(aether_drift::ghost_button_style),
                    ]
                    .spacing(6)
                    .align_y(Alignment::Center),
                );
            } else if !body.is_empty() {
                msg_body_col =
                    msg_body_col.push(text(body).size(14).color(aether_drift::TEXT_PRIMARY));
            }

            // Links clicáveis detectados no texto
            let urls = extract_urls(body);
            if !urls.is_empty() {
                let mut links_row = row![].spacing(6);
                for u in urls {
                    let label = if u.len() > 54 {
                        format!("{}...", &u[..51])
                    } else {
                        u.clone()
                    };
                    links_row = links_row.push(
                        button(text(label).size(11).color(aether_drift::ACCENT_VIOLET))
                            .on_press(ChatMessageAction::OpenUrl(u))
                            .padding([3, 8])
                            .style(aether_drift::ghost_button_style),
                    );
                }
                msg_body_col = msg_body_col.push(links_row);
            }

            // Anexos (Imagens inline + arquivos clicáveis)
            for att in &msg.attachments {
                let full_url = resolve_instance_url(instance_url, &att.full_path());
                if att.is_image() {
                    let preview_key = att.preview_path();
                    if let Some(handle) = image_cache.get(&preview_key) {
                        msg_body_col = msg_body_col.push(
                            button(
                                container(
                                    image(handle.clone())
                                        .width(Length::Shrink)
                                        .height(Length::Fixed(210.0))
                                        .content_fit(ContentFit::Contain),
                                )
                                .clip(true)
                                .style(|_t| container::Style {
                                    border: Border {
                                        color: aether_drift::BORDER_SUBTLE,
                                        width: 1.0,
                                        radius: 10.0.into(),
                                    },
                                    ..Default::default()
                                }),
                            )
                            .padding(0)
                            .on_press(ChatMessageAction::OpenUrl(full_url))
                            .style(aether_drift::icon_button_style(false)),
                        );
                    } else {
                        msg_body_col = msg_body_col.push(
                            button(
                                text(format!(
                                    "Imagem: {} ({})",
                                    att.original_name,
                                    att.size_label()
                                ))
                                .size(12),
                            )
                            .on_press(ChatMessageAction::OpenUrl(full_url))
                            .padding([5, 10])
                            .style(aether_drift::ghost_button_style),
                        );
                    }
                } else {
                    msg_body_col = msg_body_col.push(
                        button(
                            row![
                                text(&att.original_name).size(12),
                                text(format!("({})", att.size_label()))
                                    .size(11)
                                    .color(aether_drift::TEXT_MUTED),
                            ]
                            .spacing(6)
                            .align_y(Alignment::Center),
                        )
                        .on_press(ChatMessageAction::OpenUrl(full_url))
                        .padding([6, 10])
                        .style(aether_drift::ghost_button_style),
                    );
                }
            }

            // Reações agrupadas
            if !msg.reactions.is_empty() {
                let mut counts: Vec<(&str, usize)> = Vec::new();
                for r in &msg.reactions {
                    if let Some(entry) = counts.iter_mut().find(|(em, _)| *em == r.emoji.as_str()) {
                        entry.1 += 1;
                    } else {
                        counts.push((r.emoji.as_str(), 1));
                    }
                }
                let mut react_row = row![].spacing(6);
                for (emoji, cnt) in counts {
                    let display = if emoji.is_ascii() {
                        format!("{emoji} {cnt}")
                    } else {
                        format!("Reação ({cnt})")
                    };
                    react_row = react_row.push(
                        container(text(display).size(11).color(aether_drift::TEXT_PRIMARY))
                            .padding([2, 8])
                            .style(aether_drift::pill_style),
                    );
                }
                msg_body_col = msg_body_col.push(react_row);
            }

            if grouped {
                let line = row![
                    container(text("")).width(Length::Fixed(46.0)),
                    msg_body_col,
                ]
                .spacing(0);
                feed = feed.push(container(line).padding([2, 0]));
            } else {
                let avatar_handle = msg
                    .user
                    .as_ref()
                    .and_then(|u| u.avatar_url.as_deref())
                    .and_then(|url| image_cache.get(url));
                let avatar: Element<'a, ChatMessageAction> = if let Some(handle) = avatar_handle {
                    container(
                        image(handle.clone())
                            .width(Length::Fixed(34.0))
                            .height(Length::Fixed(34.0))
                            .content_fit(ContentFit::Cover),
                    )
                    .width(Length::Fixed(34.0))
                    .height(Length::Fixed(34.0))
                    .clip(true)
                    .style(|_t| container::Style {
                        border: Border {
                            radius: 17.0.into(),
                            ..Default::default()
                        },
                        ..Default::default()
                    })
                    .into()
                } else {
                    container(text(initials_of(author)).size(12).color(Color::WHITE))
                        .width(Length::Fixed(34.0))
                        .height(Length::Fixed(34.0))
                        .center(Length::Fixed(34.0))
                        .style(|_t| container::Style {
                            background: Some(Background::Color(aether_drift::SURFACE_ELEVATED)),
                            border: Border {
                                color: aether_drift::BORDER_SUBTLE,
                                width: 1.0,
                                radius: 17.0.into(),
                            },
                            ..Default::default()
                        })
                        .into()
                };

                let mut head = row![
                    text(author).size(14).color(aether_drift::TEXT_PRIMARY),
                    text(format!("{time_str}{edited_tag}"))
                        .size(11)
                        .color(aether_drift::TEXT_MUTED),
                    horizontal_space(),
                    button(text("Responder").size(11).color(aether_drift::TEXT_MUTED))
                        .on_press(ChatMessageAction::StartReply {
                            message_id: msg.id.clone(),
                            author: author.to_string(),
                        })
                        .padding([2, 6])
                        .style(aether_drift::icon_button_style(false)),
                ]
                .spacing(6)
                .align_y(Alignment::Center);

                if is_mine {
                    head = head
                        .push(
                            button(text("Editar").size(11).color(aether_drift::TEXT_MUTED))
                                .on_press(ChatMessageAction::StartEdit {
                                    message_id: msg.id.clone(),
                                    current_text: body.to_string(),
                                })
                                .padding([2, 6])
                                .style(aether_drift::icon_button_style(false)),
                        )
                        .push(
                            button(text("Excluir").size(11).color(aether_drift::TEXT_MUTED))
                                .on_press(ChatMessageAction::DeleteMessage(msg.id.clone()))
                                .padding([2, 6])
                                .style(aether_drift::icon_button_style(false)),
                        );
                }

                let block = row![avatar, column![head, msg_body_col].spacing(3)]
                    .spacing(12)
                    .align_y(Alignment::Start);

                feed = feed.push(container(block).padding(Padding {
                    top: 10.0,
                    right: 0.0,
                    bottom: 2.0,
                    left: 0.0,
                }));
            }
        }
    }

    let mut composer_col = column![].spacing(6);

    if let Some((_, rep_author)) = &state.replying_to {
        composer_col = composer_col.push(
            container(
                row![
                    text(format!("Respondendo a @{rep_author}"))
                        .size(12)
                        .color(aether_drift::ACCENT_VIOLET),
                    horizontal_space(),
                    button(text("Cancelar").size(11))
                        .on_press(ChatMessageAction::CancelReply)
                        .padding([2, 8])
                        .style(aether_drift::ghost_button_style),
                ]
                .align_y(Alignment::Center),
            )
            .width(Length::Fill)
            .padding([5, 10])
            .style(aether_drift::pill_style),
        );
    }

    if let Some(typer) = state.typing_users.get(channel_id) {
        composer_col = composer_col.push(
            text(format!("{typer} está digitando..."))
                .size(11)
                .color(aether_drift::TEXT_MUTED),
        );
    }

    composer_col = composer_col.push(
        row![
            text_input(
                &format!("Conversar em {channel_label}..."),
                &state.draft,
            )
            .on_input(ChatMessageAction::DraftChanged)
            .on_submit(ChatMessageAction::Send)
            .padding(11)
            .style(aether_drift::input_style),
            button(text(if state.sending { "..." } else { "Enviar" }).size(13))
                .on_press_maybe(
                    (!state.sending && !state.draft.trim().is_empty())
                        .then_some(ChatMessageAction::Send)
                )
                .padding([11, 18])
                .style(aether_drift::primary_button_style),
        ]
        .spacing(10)
        .align_y(Alignment::Center),
    );

    let composer = container(composer_col).padding(Padding {
        top: 8.0,
        right: 18.0,
        bottom: 16.0,
        left: 18.0,
    });

    let mut root = column![search_bar, scrollable(feed).height(Length::Fill), composer].spacing(0);

    if let Some(err) = &state.error {
        root = root.push(
            container(text(err).size(12).color(aether_drift::DANGER_RED)).padding(Padding {
                top: 0.0,
                right: 18.0,
                bottom: 8.0,
                left: 18.0,
            }),
        );
    }

    root.height(Length::Fill).into()
}
