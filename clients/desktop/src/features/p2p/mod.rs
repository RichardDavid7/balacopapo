use iced::widget::{button, canvas, column, container, horizontal_space, row, scrollable, text};
use iced::{Alignment, Color, Element, Length, Point, Rectangle, Renderer, Theme};

use crate::core::p2p_mesh::{FileTransferStatus, P2PFileOffer, P2PPeerMetrics};
use crate::ui::aether_drift;

#[derive(Debug, Clone)]
pub struct P2PState {
    pub p2p_enabled: bool,
    pub server_online: bool,
    pub my_server_rtt_ms: f32,
    pub peers: Vec<P2PPeerMetrics>,
    pub file_offers: Vec<P2PFileOffer>,
}

impl Default for P2PState {
    fn default() -> Self {
        Self {
            p2p_enabled: true,
            server_online: true,
            my_server_rtt_ms: 0.0,
            peers: Vec::new(),
            file_offers: Vec::new(),
        }
    }
}

impl P2PState {
    pub fn survival_mode_active(&self) -> bool {
        !self.server_online && self.p2p_enabled && self.peers.iter().any(|p| p.connected)
    }

    pub fn set_server_online(&mut self, online: bool) {
        self.server_online = online;
        self.reevaluate_all();
    }

    pub fn reevaluate_all(&mut self) {
        for peer in &mut self.peers {
            peer.evaluate_route(self.my_server_rtt_ms, self.server_online, self.p2p_enabled);
        }
    }
}

#[derive(Debug, Clone)]
pub enum P2PAction {
    ToggleP2P,
    SimulateServerOutage,
    AcceptFileOffer(String),
    RejectFileOffer(String),
}

struct MeshGraphCanvas<'a> {
    server_online: bool,
    my_server_rtt_ms: f32,
    peers: &'a [P2PPeerMetrics],
}

impl canvas::Program<P2PAction> for MeshGraphCanvas<'_> {
    type State = ();

    fn draw(
        &self,
        _state: &Self::State,
        renderer: &Renderer,
        _theme: &Theme,
        bounds: Rectangle,
        _cursor: iced::mouse::Cursor,
    ) -> Vec<canvas::Geometry> {
        let mut frame = canvas::Frame::new(renderer, bounds.size());
        frame.fill_rectangle(Point::ORIGIN, bounds.size(), aether_drift::SURFACE_ELEVATED);

        let server_pos = Point::new(bounds.width * 0.5, 42.0);
        let self_pos = Point::new(bounds.width * 0.22, bounds.height - 46.0);

        // Aresta Você <-> Servidor
        let srv_color = if self.server_online {
            aether_drift::ACCENT_VIOLET
        } else {
            aether_drift::DANGER_RED
        };
        let srv_edge = canvas::Path::line(self_pos, server_pos);
        frame.stroke(
            &srv_edge,
            canvas::Stroke::default()
                .with_color(srv_color)
                .with_width(2.0),
        );

        // Nós dos peers distribuídos à direita
        let count = self.peers.len().max(1);
        for (idx, peer) in self.peers.iter().enumerate() {
            let t = (idx as f32 + 1.0) / (count as f32 + 1.0);
            let px = bounds.width * 0.78;
            let py = 46.0 + t * (bounds.height - 92.0);
            let peer_pos = Point::new(px, py);

            // Aresta Peer <-> Servidor
            let peer_srv = canvas::Path::line(peer_pos, server_pos);
            frame.stroke(
                &peer_srv,
                canvas::Stroke::default()
                    .with_color(Color::from_rgba(0.604, 0.627, 0.706, 0.35))
                    .with_width(1.5),
            );

            // Aresta P2P direta Você <-> Peer
            let direct_color = if peer.using_p2p_audio {
                aether_drift::SUCCESS_GREEN
            } else {
                Color::from_rgba(0.604, 0.627, 0.706, 0.25)
            };
            let direct_edge = canvas::Path::line(self_pos, peer_pos);
            frame.stroke(
                &direct_edge,
                canvas::Stroke::default()
                    .with_color(direct_color)
                    .with_width(if peer.using_p2p_audio { 3.0 } else { 1.5 }),
            );

            let node = canvas::Path::circle(peer_pos, 14.0);
            frame.fill(&node, direct_color);
        }

        // Nó Servidor
        let srv_node = canvas::Path::circle(server_pos, 16.0);
        frame.fill(&srv_node, srv_color);

        // Nó Você
        let self_node = canvas::Path::circle(self_pos, 16.0);
        frame.fill(&self_node, aether_drift::ACCENT_VIOLET);

        // Legenda rápida de RTT do servidor no canto superior esquerdo
        frame.fill_text(canvas::Text {
            content: if self.server_online {
                format!("Instância: {:.0} ms", self.my_server_rtt_ms)
            } else {
                "Instância OFFLINE — Sobrevivência P2P".to_string()
            },
            position: Point::new(12.0, 12.0),
            color: aether_drift::TEXT_PRIMARY,
            size: 12.0.into(),
            ..Default::default()
        });

        vec![frame.into_geometry()]
    }
}

pub fn view<'a>(state: &'a P2PState) -> Element<'a, P2PAction> {
    let header = row![
        column![
            text("Malha P2P Híbrida (Arquivos + Voz + Sobrevivência)").size(18),
            text("Histerese anti-flapping (-10 ms / +15 ms) com trimmed-mean e failover automático")
                .size(12)
                .color(aether_drift::TEXT_MUTED),
        ]
        .spacing(2),
        horizontal_space(),
        button(
            text(if state.p2p_enabled {
                "P2P Híbrido: Ativo"
            } else {
                "P2P Híbrido: Desligado"
            })
            .size(12),
        )
        .on_press(P2PAction::ToggleP2P)
        .padding([7, 14])
        .style(if state.p2p_enabled {
            aether_drift::primary_button_style
        } else {
            aether_drift::ghost_button_style
        }),
        button(
            text(if state.server_online {
                "Testar Sobrevivência"
            } else {
                "Restaurar Servidor"
            })
            .size(12),
        )
        .on_press(P2PAction::SimulateServerOutage)
        .padding([7, 12])
        .style(aether_drift::ghost_button_style),
    ]
    .spacing(8)
    .align_y(Alignment::Center);

    let graph = canvas(MeshGraphCanvas {
        server_online: state.server_online,
        my_server_rtt_ms: state.my_server_rtt_ms,
        peers: &state.peers,
    })
    .width(Length::Fill)
    .height(Length::Fixed(210.0));

    let mut peers_col = column![text("Peers na Malha").size(14)].spacing(6);
    if state.peers.is_empty() {
        peers_col = peers_col.push(
            text("Nenhum peer P2P conectado no momento. Entre em uma chamada de voz com outro participante para iniciar a malha.")
                .size(12)
                .color(aether_drift::TEXT_MUTED),
        );
    }
    for peer in &state.peers {
        let direct = peer
            .trimmed_direct_rtt_ms()
            .map(|ms| format!("{ms:.0} ms"))
            .unwrap_or_else(|| "—".to_string());
        let active_route = if peer.using_p2p_audio {
            format!("P2P Direto ({})", peer.route.label())
        } else {
            "LiveKit SFU (Instância)".to_string()
        };
        peers_col = peers_col.push(
            row![
                text(&peer.display_name).size(13),
                horizontal_space(),
                text(format!("Direto: {direct} · Rota: {active_route}"))
                    .size(12)
                    .color(if peer.using_p2p_audio {
                        aether_drift::SUCCESS_GREEN
                    } else {
                        aether_drift::TEXT_MUTED
                    }),
            ]
            .align_y(Alignment::Center),
        );
    }

    let mut transfers_col = column![
        text("Transferências P2P (Consentimento Obrigatório · Chunks 16 KB)").size(14)
    ]
    .spacing(8);

    if state.file_offers.is_empty() {
        transfers_col = transfers_col.push(
            text("Nenhuma transferência P2P pendente.")
                .size(12)
                .color(aether_drift::TEXT_MUTED),
        );
    }

    for offer in &state.file_offers {
        let status_widget: Element<'a, P2PAction> = match offer.status {
            FileTransferStatus::PendingConsent => row![
                button(text("Aceitar").size(12))
                    .on_press(P2PAction::AcceptFileOffer(offer.id.clone()))
                    .padding([5, 12])
                    .style(aether_drift::primary_button_style),
                button(text("Recusar").size(12))
                    .on_press(P2PAction::RejectFileOffer(offer.id.clone()))
                    .padding([5, 12])
                    .style(aether_drift::ghost_button_style),
            ]
            .spacing(6)
            .into(),
            FileTransferStatus::Accepted => text("Transferência aceita (pronta para DataChannel)")
                .size(12)
                .color(aether_drift::SUCCESS_GREEN)
                .into(),
            FileTransferStatus::Rejected => text("Recusado (0 bytes transferidos)")
                .size(12)
                .color(aether_drift::DANGER_RED)
                .into(),
            FileTransferStatus::Completed => text("Concluído")
                .size(12)
                .color(aether_drift::SUCCESS_GREEN)
                .into(),
        };

        transfers_col = transfers_col.push(
            row![
                column![
                    text(format!("{} ({})", offer.file_name, offer.size_label())).size(13),
                    text(format!(
                        "De: {} · {} chunks de 16 KB",
                        offer.sender_name,
                        offer.total_chunks()
                    ))
                    .size(11)
                    .color(aether_drift::TEXT_MUTED),
                ]
                .spacing(2),
                horizontal_space(),
                status_widget,
            ]
            .align_y(Alignment::Center),
        );
    }

    let mut root = column![header].spacing(12);

    if state.survival_mode_active() {
        root = root.push(
            container(
                text("MODO SOBREVIVÊNCIA P2P ATIVO — Instância indisponível; áudio mantido direto entre peers!")
                    .size(12)
                    .color(aether_drift::SUCCESS_GREEN),
            )
            .width(Length::Fill)
            .padding(10)
            .style(aether_drift::pill_style),
        );
    }

    root = root
        .push(graph)
        .push(
            container(peers_col)
                .width(Length::Fill)
                .padding(14)
                .style(aether_drift::card_style),
        )
        .push(
            container(transfers_col)
                .width(Length::Fill)
                .padding(14)
                .style(aether_drift::card_style),
        );

    scrollable(root).height(Length::Fill).into()
}
