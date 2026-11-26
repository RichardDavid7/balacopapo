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
    pub loading_history: bool,
    pub sending: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub enum ChatMessageAction {
    DraftChanged(String),
    #[allow(dead_code)]
    SearchChanged(String),
    Send,
    LoadOlder,
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

pub fn view<'a>(
    state: &'a ChatState,
    channel_id: &'a str,
    channel_label: &'a str,
    current_user_id: &'a str,
    image_cache: &'a HashMap<String, image::Handle>,
) -> Element<'a, ChatMessageAction> {
    let messages = state
        .messages_by_channel
        .get(channel_id)
        .map(Vec::as_slice)
        .unwrap_or(&[]);

    let query = state.search_query.trim().to_ascii_lowercase();
    let mut feed = column![].spacing(2).padding([12, 18]);

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
            let grouped = last_author == Some(author);
            last_author = Some(author);

            let is_mine = msg.user_id.as_deref() == Some(current_user_id);
            let time_str = msg.short_time();
            let edited_tag = if msg.is_edited() { " (editada)" } else { "" };

            if grouped {
                let line = row![
                    container(text("")).width(Length::Fixed(46.0)),
                    text(body).size(14).color(aether_drift::TEXT_PRIMARY),
                ]
                .spacing(0);
                feed = feed.push(container(line).padding([1, 0]));
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
                    container(
                        text(initials_of(author))
                            .size(12)
                            .color(Color::WHITE),
                    )
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
                ]
                .spacing(8)
                .align_y(Alignment::Center);

                if is_mine {
                    head = head.push(
                        button(text("Excluir").size(11).color(aether_drift::TEXT_MUTED))
                            .on_press(ChatMessageAction::DeleteMessage(msg.id.clone()))
                            .padding([2, 6])
                            .style(aether_drift::icon_button_style(false)),
                    );
                }

                let block = row![
                    avatar,
                    column![head, text(body).size(14).color(aether_drift::TEXT_PRIMARY)].spacing(2),
                ]
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

    let composer = container(
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
    )
    .padding(Padding {
        top: 10.0,
        right: 18.0,
        bottom: 16.0,
        left: 18.0,
    });

    let mut root = column![scrollable(feed).height(Length::Fill), composer].spacing(0);

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
