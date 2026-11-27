use iced::widget::{
    button, column, container, horizontal_space, image, row, scrollable, text, text_input,
};
use iced::{Alignment, Background, Border, Color, ContentFit, Element, Length, Padding};
use std::collections::HashMap;

use crate::core::models::ChatMessage;
use crate::ui::{aether_drift, icons};

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
    pub pending_attachments: Vec<(String, String)>,
    pub uploading: bool,
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
    OpenAuthorProfile(String),
    PickAttachment,
    RemovePendingAttachment(usize),
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

fn mini_avatar<'a>(
    image_cache: &'a HashMap<String, image::Handle>,
    avatar_url: Option<&'a str>,
    author: &str,
    size: f32,
) -> Element<'a, ChatMessageAction> {
    let radius = size * 0.5;
    if let Some(handle) = avatar_url.and_then(|u| image_cache.get(u)) {
        container(
            image(handle.clone())
                .width(Length::Fixed(size))
                .height(Length::Fixed(size))
                .content_fit(ContentFit::Cover),
        )
        .width(Length::Fixed(size))
        .height(Length::Fixed(size))
        .clip(true)
        .style(move |_t| container::Style {
            border: Border {
                radius: radius.into(),
                ..Default::default()
            },
            ..Default::default()
        })
        .into()
    } else {
        let font_sz = (size * 0.40).clamp(8.0, 13.0);
        container(text(initials_of(author)).size(font_sz).color(Color::WHITE))
            .width(Length::Fixed(size))
            .height(Length::Fixed(size))
            .center(Length::Fixed(size))
            .style(move |_t| container::Style {
                background: Some(Background::Color(aether_drift::SURFACE_ELEVATED)),
                border: Border {
                    radius: radius.into(),
                    ..Default::default()
                },
                ..Default::default()
            })
            .into()
    }
}

#[allow(clippy::too_many_arguments)]
pub fn view<'a>(
    state: &'a ChatState,
    channel_id: &str,
    channel_label: &str,
    is_dm: bool,
    current_user_id: &str,
    instance_url: &str,
    image_cache: &'a HashMap<String, image::Handle>,
    author_colors: &HashMap<String, Color>,
    author_nicks: &HashMap<String, String>,
) -> Element<'a, ChatMessageAction> {
    let messages = state
        .messages_by_channel
        .get(channel_id)
        .map(Vec::as_slice)
        .unwrap_or(&[]);

    let query = state.search_query.trim().to_ascii_lowercase();
    let mut feed = column![].spacing(1).padding([12, 18]);

    if !messages.is_empty() && query.is_empty() {
        let load_btn = button(
            text(if state.loading_history {
                "Carregando..."
            } else {
                "Carregar mensagens anteriores"
            })
            .size(11.5)
            .color(aether_drift::TEXT_SECONDARY),
        )
        .on_press_maybe((!state.loading_history).then_some(ChatMessageAction::LoadOlder))
        .padding([5, 12])
        .style(aether_drift::ghost_button_style);
        feed = feed.push(
            container(load_btn)
                .padding(Padding {
                    top: 0.0,
                    right: 0.0,
                    bottom: 8.0,
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
        let prefix = if is_dm { "@" } else { "#" };
        feed = feed.push(
            container(
                column![
                    text(format!("Bem-vindo a {prefix}{channel_label}"))
                        .size(20)
                        .color(aether_drift::TEXT_PRIMARY),
                    text("Este é o começo da conversa.")
                        .size(13)
                        .color(aether_drift::TEXT_MUTED),
                ]
                .spacing(4),
            )
            .padding(Padding {
                top: 16.0,
                right: 0.0,
                bottom: 8.0,
                left: 0.0,
            }),
        );
    } else {
        let mut last_author_uid: Option<&str> = None;
        for msg in messages {
            let body = msg.body_text();
            let uid_opt = msg
                .user_id
                .as_deref()
                .or_else(|| msg.user.as_ref().map(|u| u.id.as_str()));
            let author_owned: String = uid_opt
                .and_then(|uid| author_nicks.get(uid).cloned())
                .unwrap_or_else(|| msg.author_label().to_string());

            if !query.is_empty()
                && !body.to_ascii_lowercase().contains(&query)
                && !author_owned.to_ascii_lowercase().contains(&query)
            {
                continue;
            }

            let has_reply = msg.reply_to.is_some();
            let is_editing = state.editing_message_id.as_deref() == Some(msg.id.as_str());
            let grouped = uid_opt.is_some()
                && last_author_uid == uid_opt
                && !has_reply
                && !is_editing;
            last_author_uid = uid_opt;

            let is_mine = uid_opt == Some(current_user_id);
            let time_str = msg.formatted_datetime_pt();
            let edited_tag = if msg.is_edited() { " (editada)" } else { "" };
            let author_color = uid_opt
                .and_then(|uid| author_colors.get(uid).copied())
                .unwrap_or(aether_drift::TEXT_PRIMARY);

            let mut msg_body_col = column![].spacing(4);

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
                msg_body_col = msg_body_col.push(
                    text(body)
                        .size(14.5)
                        .color(aether_drift::TEXT_MESSAGE),
                );
            }

            // Links clicáveis detectados no texto (`--text-link: #7DD3FC`)
            let urls = extract_urls(body);
            if !urls.is_empty() {
                let mut links_row = row![].spacing(6);
                for u in urls {
                    let label = if u.len() > 58 {
                        format!("{}...", &u[..55])
                    } else {
                        u.clone()
                    };
                    links_row = links_row.push(
                        button(text(label).size(12).color(aether_drift::TEXT_LINK))
                            .on_press(ChatMessageAction::OpenUrl(u))
                            .padding([2, 6])
                            .style(aether_drift::icon_button_style(false)),
                    );
                }
                msg_body_col = msg_body_col.push(links_row);
            }

            // Anexos (Imagens inline estilo Backspace + arquivos clicáveis)
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
                                        .height(Length::Fixed(245.0))
                                        .content_fit(ContentFit::Contain),
                                )
                                .clip(true)
                                .style(|_t| container::Style {
                                    border: Border {
                                        color: aether_drift::BORDER_SUBTLE,
                                        width: 1.0,
                                        radius: 8.0.into(),
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
                                .size(12)
                                .color(aether_drift::TEXT_LINK),
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
                                icons::download_tray(14.0, aether_drift::TEXT_SECONDARY),
                                text(&att.original_name)
                                    .size(12.5)
                                    .color(aether_drift::TEXT_LINK),
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

            // Pílulas de Reação estilo Backspace (contagem mint `#86EFAC`)
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
                    react_row = react_row.push(
                        container(
                            row![
                                text(emoji).size(12),
                                text(cnt.to_string())
                                    .size(11.5)
                                    .color(aether_drift::SUCCESS_GREEN),
                            ]
                            .spacing(4)
                            .align_y(Alignment::Center),
                        )
                        .padding([2, 8])
                        .style(aether_drift::mint_pill_style),
                    );
                }
                msg_body_col = msg_body_col.push(react_row);
            }

            if grouped {
                let line = row![
                    container(text("")).width(Length::Fixed(48.0)),
                    msg_body_col,
                ]
                .spacing(0);
                feed = feed.push(container(line).padding([1, 0]));
            } else {
                // Linha superior de citação de resposta (`╭─ [avatar] Autor  trecho`) igual ao `Message.tsx`!
                let reply_header: Option<Element<'a, ChatMessageAction>> =
                    msg.reply_to.as_ref().map(|rep| {
                        let rep_uid = rep.user.as_ref().map(|u| u.id.as_str());
                        let rep_author_owned: String = rep_uid
                            .and_then(|id| author_nicks.get(id).cloned())
                            .or_else(|| {
                                rep.user
                                    .as_ref()
                                    .map(|u| crate::core::models::AuthUser::label(u).to_string())
                            })
                            .unwrap_or_else(|| "Mensagem".to_string());
                        let rep_color = rep_uid
                            .and_then(|id| author_colors.get(id).copied())
                            .unwrap_or(aether_drift::SUCCESS_GREEN);
                        let rep_av = mini_avatar(
                            image_cache,
                            rep.user.as_ref().and_then(|u| u.avatar_url.as_deref()),
                            &rep_author_owned,
                            15.0,
                        );
                        let rep_snippet = rep
                            .content
                            .as_deref()
                            .filter(|s| !s.trim().is_empty())
                            .unwrap_or("Clique para ver anexo")
                            .lines()
                            .next()
                            .unwrap_or("")
                            .chars()
                            .take(86)
                            .collect::<String>();

                        let spine = container(text("╭─").size(12).color(aether_drift::BORDER_SOFT))
                            .width(Length::Fixed(36.0))
                            .padding(Padding {
                                top: 0.0,
                                right: 0.0,
                                bottom: 0.0,
                                left: 16.0,
                            });

                        row![
                            spine,
                            row![
                                rep_av,
                                text(rep_author_owned).size(12).color(rep_color),
                                text(rep_snippet)
                                    .size(12)
                                    .color(aether_drift::TEXT_SECONDARY),
                            ]
                            .spacing(6)
                            .align_y(Alignment::Center),
                        ]
                        .spacing(12)
                        .align_y(Alignment::Center)
                        .into()
                    });

                let avatar_el = mini_avatar(
                    image_cache,
                    msg.user.as_ref().and_then(|u| u.avatar_url.as_deref()),
                    &author_owned,
                    36.0,
                );
                let avatar: Element<'a, ChatMessageAction> = if let Some(uid) = uid_opt {
                    button(avatar_el)
                        .padding(0)
                        .on_press(ChatMessageAction::OpenAuthorProfile(uid.to_string()))
                        .style(aether_drift::icon_button_style(false))
                        .into()
                } else {
                    avatar_el
                };

                let author_for_reply = author_owned.clone();
                let author_btn: Element<'a, ChatMessageAction> = if let Some(uid) = uid_opt {
                    button(text(author_owned).size(14.5).color(author_color))
                        .padding(0)
                        .on_press(ChatMessageAction::OpenAuthorProfile(uid.to_string()))
                        .style(aether_drift::icon_button_style(false))
                        .into()
                } else {
                    text(author_owned).size(14.5).color(author_color).into()
                };

                let mut head = row![
                    author_btn,
                    text(format!("{time_str}{edited_tag}"))
                        .size(11.5)
                        .color(aether_drift::TEXT_MUTED),
                    horizontal_space(),
                    button(text("Responder").size(10.5).color(aether_drift::TEXT_MUTED))
                        .on_press(ChatMessageAction::StartReply {
                            message_id: msg.id.clone(),
                            author: author_for_reply,
                        })
                        .padding([2, 5])
                        .style(aether_drift::icon_button_style(false)),
                ]
                .spacing(8)
                .align_y(Alignment::Center);

                if is_mine {
                    head = head
                        .push(
                            button(text("Editar").size(10.5).color(aether_drift::TEXT_MUTED))
                                .on_press(ChatMessageAction::StartEdit {
                                    message_id: msg.id.clone(),
                                    current_text: body.to_string(),
                                })
                                .padding([2, 5])
                                .style(aether_drift::icon_button_style(false)),
                        )
                        .push(
                            button(text("Excluir").size(10.5).color(aether_drift::TEXT_MUTED))
                                .on_press(ChatMessageAction::DeleteMessage(msg.id.clone()))
                                .padding([2, 5])
                                .style(aether_drift::icon_button_style(false)),
                        );
                }

                let main_row = row![
                    avatar,
                    column![head, msg_body_col].spacing(2).width(Length::Fill),
                ]
                .spacing(12)
                .align_y(Alignment::Start);

                let full_block: Element<'a, ChatMessageAction> = if let Some(rep_row) = reply_header
                {
                    column![rep_row, main_row].spacing(3).into()
                } else {
                    main_row.into()
                };

                feed = feed.push(container(full_block).padding(Padding {
                    top: 12.0,
                    right: 0.0,
                    bottom: 2.0,
                    left: 0.0,
                }));
            }
        }
    }

    // ── Pílula Flutuante do Composer (`glass-bubble rounded-[14px]`, sem botão roxo "Enviar") ──
    let mut bubble_inner = column![].spacing(0);

    if let Some((_, rep_author)) = &state.replying_to {
        bubble_inner = bubble_inner.push(
            container(
                row![
                    text(format!("Respondendo a {rep_author}"))
                        .size(12)
                        .color(aether_drift::TEXT_SECONDARY),
                    horizontal_space(),
                    button(icons::close(13.0, aether_drift::TEXT_MUTED))
                        .on_press(ChatMessageAction::CancelReply)
                        .padding(3)
                        .style(aether_drift::icon_button_style(false)),
                ]
                .align_y(Alignment::Center),
            )
            .width(Length::Fill)
            .padding([6, 14])
            .style(|_t| container::Style {
                border: Border {
                    color: Color::from_rgba(1.0, 1.0, 1.0, 0.05),
                    width: 1.0,
                    ..Default::default()
                },
                ..Default::default()
            }),
        );
    }

    if !state.pending_attachments.is_empty() {
        let mut att_row = row![].spacing(6).align_y(Alignment::Center);
        for (idx, (_, name)) in state.pending_attachments.iter().enumerate() {
            att_row = att_row.push(
                container(
                    row![
                        text(name).size(11.5).color(aether_drift::TEXT_PRIMARY),
                        button(icons::close(11.0, aether_drift::TEXT_MUTED))
                            .on_press(ChatMessageAction::RemovePendingAttachment(idx))
                            .padding(2)
                            .style(aether_drift::icon_button_style(false)),
                    ]
                    .spacing(5)
                    .align_y(Alignment::Center),
                )
                .padding([3, 8])
                .style(aether_drift::pill_style),
            );
        }
        bubble_inner = bubble_inner.push(container(att_row).padding([6, 12]));
    }

    let placeholder = if is_dm {
        format!("Mensagem para @{channel_label}")
    } else {
        format!("Mensagem em #{channel_label}")
    };

    let attach_icon_color = if state.uploading {
        aether_drift::ACCENT_VIOLET
    } else {
        aether_drift::TEXT_SECONDARY
    };

    let input_row = row![
        button(icons::add_circle(19.0, attach_icon_color))
            .on_press_maybe((!state.uploading).then_some(ChatMessageAction::PickAttachment))
            .padding(6)
            .style(aether_drift::icon_button_style(false)),
        text_input(&placeholder, &state.draft)
            .on_input(ChatMessageAction::DraftChanged)
            .on_submit(ChatMessageAction::Send)
            .size(14)
            .padding([9, 6])
            .style(aether_drift::embedded_input_style),
        button(icons::sticker(18.0, aether_drift::TEXT_MUTED))
            .on_press_maybe((!state.uploading).then_some(ChatMessageAction::PickAttachment))
            .padding(6)
            .style(aether_drift::icon_button_style(false)),
        button(icons::smile(18.0, aether_drift::TEXT_MUTED))
            .padding(6)
            .style(aether_drift::icon_button_style(false)),
    ]
    .spacing(4)
    .padding([2, 8])
    .align_y(Alignment::Center);

    bubble_inner = bubble_inner.push(input_row);

    let composer_pill = container(bubble_inner)
        .width(Length::Fill)
        .style(aether_drift::glass_bubble_style);

    let mut bottom_wrap = column![].spacing(4);
    if let Some(typer) = state.typing_users.get(channel_id) {
        bottom_wrap = bottom_wrap.push(
            container(
                text(format!("{typer} está digitando..."))
                    .size(11)
                    .color(aether_drift::TEXT_SECONDARY),
            )
            .padding([0, 6]),
        );
    }
    bottom_wrap = bottom_wrap.push(composer_pill);
    if let Some(err) = &state.error {
        bottom_wrap = bottom_wrap.push(
            container(text(err).size(11.5).color(aether_drift::DANGER_RED)).padding([0, 6]),
        );
    }

    let composer_outer = container(bottom_wrap).padding(Padding {
        top: 4.0,
        right: 14.0,
        bottom: 12.0,
        left: 14.0,
    });

    let mut root = column![].spacing(0);

    // Barra de busca aparece SOMENTE quando acionada pela lupa no cabeçalho de 48 px!
    if state.show_search {
        root = root.push(
            container(
                row![
                    icons::search(15.0, aether_drift::TEXT_MUTED),
                    text_input(
                        "Buscar mensagens ou autor neste canal...",
                        &state.search_query
                    )
                    .on_input(ChatMessageAction::SearchChanged)
                    .size(13)
                    .padding([6, 8])
                    .style(aether_drift::embedded_input_style),
                    button(icons::close(14.0, aether_drift::TEXT_MUTED))
                        .on_press(ChatMessageAction::ToggleSearch)
                        .padding(4)
                        .style(aether_drift::icon_button_style(false)),
                ]
                .spacing(6)
                .align_y(Alignment::Center),
            )
            .width(Length::Fill)
            .padding([6, 16])
            .style(aether_drift::header_bar_style),
        );
    }

    root = root
        .push(scrollable(feed).height(Length::Fill))
        .push(composer_outer);

    container(root)
        .width(Length::Fill)
        .height(Length::Fill)
        .style(aether_drift::chat_canvas_style)
        .into()
}
