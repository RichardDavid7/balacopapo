//! Cliente WebSocket resiliente 100% *event-driven* (`tokio-tungstenite` + `rustls`).
//!
//! Zero busy-loops: dorme no IOCP/epoll até chegar um frame do servidor e envia
//! `{"type":"ping"}` a cada 15s sem acordar a thread de UI.

use futures_util::{SinkExt, StreamExt};
use iced::Subscription;
use serde_json::json;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message as TungsteniteMsg;

use crate::core::models::{parse_ws_server_event, WsEvent};

pub fn build_ws_url(instance_url: &str) -> String {
    let trimmed = instance_url.trim_end_matches('/');
    if let Some(rest) = trimmed.strip_prefix("https://") {
        format!("wss://{rest}/ws")
    } else if let Some(rest) = trimmed.strip_prefix("http://") {
        format!("ws://{rest}/ws")
    } else {
        format!("wss://{trimmed}/ws")
    }
}

pub fn connect_subscription(instance_url: String, token: String) -> Subscription<WsEvent> {
    let id = (instance_url.clone(), token.clone());
    Subscription::run_with_id(
        id,
        iced::stream::channel(64, move |mut output| async move {
            let ws_url = build_ws_url(&instance_url);
            let mut backoff_secs: u64 = 1;

            loop {
                match tokio_tungstenite::connect_async(&ws_url).await {
                    Ok((ws_stream, _)) => {
                        backoff_secs = 1;
                        let (mut write, mut read) = ws_stream.split();

                        let auth_payload = json!({
                            "type": "auth",
                            "token": token,
                            "client": "desktop",
                        })
                        .to_string();

                        if write.send(TungsteniteMsg::Text(auth_payload)).await.is_err() {
                            let _ = output
                                .send(WsEvent::Disconnected("Falha no handshake auth".to_string()))
                                .await;
                            tokio::time::sleep(Duration::from_secs(backoff_secs)).await;
                            backoff_secs = (backoff_secs * 2).min(30);
                            continue;
                        }

                        let (cmd_tx, mut cmd_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
                        let _ = output.send(WsEvent::WsReadyToSend(cmd_tx)).await;
                        let _ = output.send(WsEvent::Connected).await;

                        let mut heartbeat = tokio::time::interval(Duration::from_secs(15));
                        heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
                        // Consome o primeiro tick imediato
                        heartbeat.tick().await;

                        loop {
                            tokio::select! {
                                _ = heartbeat.tick() => {
                                    if write
                                        .send(TungsteniteMsg::Text(r#"{"type":"ping"}"#.to_string()))
                                        .await
                                        .is_err()
                                    {
                                        break;
                                    }
                                }
                                outbound = cmd_rx.recv() => {
                                    if let Some(payload) = outbound {
                                        if write.send(TungsteniteMsg::Text(payload)).await.is_err() {
                                            break;
                                        }
                                    }
                                }
                                incoming = read.next() => {
                                    match incoming {
                                        Some(Ok(TungsteniteMsg::Text(text))) => {
                                            if let Some(ev) = parse_ws_server_event(&text) {
                                                let _ = output.send(ev).await;
                                            }
                                        }
                                        Some(Ok(TungsteniteMsg::Ping(payload))) => {
                                            let _ = write.send(TungsteniteMsg::Pong(payload)).await;
                                        }
                                        Some(Ok(TungsteniteMsg::Close(_))) | None => break,
                                        Some(Err(_)) => break,
                                        _ => {}
                                    }
                                }
                            }
                        }

                        let _ = output
                            .send(WsEvent::Disconnected("Reconectando...".to_string()))
                            .await;
                    }
                    Err(err) => {
                        let _ = output
                            .send(WsEvent::Disconnected(format!("Offline: {err}")))
                            .await;
                    }
                }

                tokio::time::sleep(Duration::from_secs(backoff_secs)).await;
                backoff_secs = (backoff_secs * 2).min(30);
            }
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_ws_urls_correctly() {
        assert_eq!(
            build_ws_url("https://chat.balacopapo.com/"),
            "wss://chat.balacopapo.com/ws"
        );
        assert_eq!(
            build_ws_url("http://192.168.1.50:3000"),
            "ws://192.168.1.50:3000/ws"
        );
    }
}
