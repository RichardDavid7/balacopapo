use iced::widget::{button, column, container, horizontal_space, row, scrollable, text, text_input};
use iced::{Alignment, Element, Length};
use std::collections::HashMap;

use crate::core::models::{ChannelSummary, ChatMessage};
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

fn format_short_time(iso: &str) -> &str {
    // Extrai HH:MM de timestamps ISO-8601 como "2026-11-26T06:28:00.000Z"
    if let Some((_, rest)) = iso.split_once('T') {
        if rest.len() >= 5 {
            return &rest[..5];
        }
    }
    ""
}

pub fn view<'a>(
    state: &'a ChatState,
    channel: &'a ChannelSummary,
    current_user_id: &'a str,
) -> Element<'a, ChatMessageAction> {
    let channel_header = row![
        column![
            text(format!("# {}", channel.name)).size(16),
            text(
                channel
                    .topic
                    .as_deref()
                    .filter(|t| !t.trim().is_empty())
                    .unwrap_or("Canal de texto · sincronização WebSocket ao vivo")
            )
            .size(12)
            .color(aether_drift::TEXT_MUTED),
        ]
        .spacing(2),
        horizontal_space(),
        text_input("Filtrar mensagens...", &state.search_query)
            .on_input(ChatMessageAction::SearchChanged)
            .padding(8)
            .width(Length::Fixed(220.0))
            .style(aether_drift::input_style),
    ]
    .spacing(12)
    .align_y(Alignment::Center);

    let messages = state
        .messages_by_channel
        .get(&channel.id)
        .map(Vec::as_slice)
        .unwrap_or(&[]);

    let query = state.search_query.trim().to_ascii_lowercase();
    let mut feed = column![].spacing(6);

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
        feed = feed.push(container(load_btn).center_x(Length::Fill));
    }

    if state.loading_history && messages.is_empty() {
        feed = feed.push(
            text("Carregando histórico do canal...")
                .size(13)
                .color(aether_drift::TEXT_MUTED),
        );
    } else if messages.is_empty() {
        feed = feed.push(
            text("Nenhuma mensagem neste canal ainda. Diga olá!")
                .size(13)
                .color(aether_drift::TEXT_MUTED),
        );
    } else {
        let mut last_author: Option<&str> = None;
        for msg in messages {
            if !query.is_empty()
                && !msg.content.to_ascii_lowercase().contains(&query)
                && !msg.author_label().to_ascii_lowercase().contains(&query)
            {
                continue;
            }

            let author = msg.author_label();
            let grouped = last_author == Some(author);
            last_author = Some(author);

            let is_mine = msg.user_id.as_deref() == Some(current_user_id);
            let time_str = format_short_time(&msg.created_at);
            let edited_tag = if msg.updated_at.is_some() {
                " (editada)"
            } else {
                ""
            };

            let mut msg_col = column![].spacing(3);
            if !grouped {
                let mut head = row![
                    text(author).size(13).color(aether_drift::ACCENT_VIOLET),
                    text(format!("{time_str}{edited_tag}"))
                        .size(11)
                        .color(aether_drift::TEXT_MUTED),
                    horizontal_space(),
                ]
                .spacing(8)
                .align_y(Alignment::Center);

                if is_mine {
                    head = head.push(
                        button(text("Excluir").size(10))
                            .on_press(ChatMessageAction::DeleteMessage(msg.id.clone()))
                            .padding([2, 6])
                            .style(aether_drift::ghost_button_style),
                    );
                }
                msg_col = msg_col.push(head);
            }

            msg_col = msg_col.push(text(&msg.content).size(14));

            let style_fn: fn(&iced::Theme) -> container::Style = if grouped {
                aether_drift::transparent_style
            } else {
                aether_drift::card_style
            };
            let card = container(msg_col)
                .width(Length::Fill)
                .padding(if grouped { [2, 12] } else { [8, 12] })
                .style(style_fn);

            feed = feed.push(card);
        }
    }

    let composer = row![
        text_input(
            &format!("Enviar mensagem em #{}...", channel.name),
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
    .align_y(Alignment::Center);

    let mut root = column![
        channel_header,
        scrollable(feed).height(Length::Fill),
        composer,
    ]
    .spacing(12);

    if let Some(err) = &state.error {
        root = root.push(text(err).size(12).color(aether_drift::DANGER_RED));
    }

    root.height(Length::Fill).into()
}
