//! Motor da **Malha P2P Híbrida (Fases 2A, 2B e 2C)** do Balacopapo:
//! - Cálculo de RTT combinado (`meuRttServidor + rttServidorDoPar`) vs `directRtt`
//! - **Trimmed-mean** + **Histerese anti-flapping** (`-10 ms` para entrar em P2P, `+15 ms` para voltar ao LiveKit)
//! - **Modo Sobrevivência P2P:** mantém peers diretos ativos se a instância cair/reiniciar
//! - **Consentimento obrigatório** (Aceitar / Recusar) antes de transferir qualquer chunk de 16 KB em DMs

#![allow(dead_code)]

pub const P2P_ENTER_ADVANTAGE_MS: f32 = 10.0;
pub const P2P_EXIT_PENALTY_MS: f32 = 15.0;
pub const P2P_CHUNK_BYTES: u64 = 16_384;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum P2PRouteKind {
    Lan,
    Nat,
    Relay,
    ServerSfu,
}

impl P2PRouteKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Lan => "LAN",
            Self::Nat => "NAT",
            Self::Relay => "Relay",
            Self::ServerSfu => "LiveKit SFU",
        }
    }
}

#[derive(Debug, Clone)]
pub struct P2PPeerMetrics {
    pub peer_id: String,
    pub display_name: String,
    pub route: P2PRouteKind,
    pub direct_rtt_samples_ms: Vec<f32>,
    pub peer_server_rtt_ms: f32,
    pub using_p2p_audio: bool,
    pub connected: bool,
}

impl P2PPeerMetrics {
    pub fn trimmed_direct_rtt_ms(&self) -> Option<f32> {
        trimmed_mean(&self.direct_rtt_samples_ms)
    }

    /// Reavalia se este peer deve usar áudio P2P direto ou LiveKit SFU com histerese e Sobrevivência.
    pub fn evaluate_route(&mut self, my_server_rtt_ms: f32, server_online: bool, p2p_enabled: bool) {
        if !p2p_enabled || !self.connected {
            self.using_p2p_audio = false;
            return;
        }
        // Failover de Sobrevivência: servidor caiu -> mantém P2P direto ativo!
        if !server_online {
            self.using_p2p_audio = true;
            return;
        }
        let Some(direct) = self.trimmed_direct_rtt_ms() else {
            self.using_p2p_audio = false;
            return;
        };
        let server_path = my_server_rtt_ms + self.peer_server_rtt_ms;
        if self.using_p2p_audio {
            if direct >= server_path + P2P_EXIT_PENALTY_MS {
                self.using_p2p_audio = false;
            }
        } else if direct <= server_path - P2P_ENTER_ADVANTAGE_MS {
            self.using_p2p_audio = true;
        }
    }
}

/// Média aparada (descarta menor e maior amostra quando há >= 4 medições) para evitar flapping por pico isolado.
pub fn trimmed_mean(samples: &[f32]) -> Option<f32> {
    if samples.is_empty() {
        return None;
    }
    let mut sorted: Vec<f32> = samples
        .iter()
        .copied()
        .filter(|v| v.is_finite() && *v >= 0.0)
        .collect();
    if sorted.is_empty() {
        return None;
    }
    sorted.sort_by(|a, b| a.total_cmp(b));
    let slice = if sorted.len() >= 4 {
        &sorted[1..sorted.len() - 1]
    } else {
        &sorted[..]
    };
    let sum: f32 = slice.iter().sum();
    Some(sum / slice.len() as f32)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileTransferStatus {
    PendingConsent,
    Accepted,
    Rejected,
    Completed,
}

#[derive(Debug, Clone)]
pub struct P2PFileOffer {
    pub id: String,
    pub sender_name: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub chunks_received: u64,
    pub status: FileTransferStatus,
}

impl P2PFileOffer {
    pub fn total_chunks(&self) -> u64 {
        self.size_bytes.div_ceil(P2P_CHUNK_BYTES).max(1)
    }

    pub fn size_label(&self) -> String {
        if self.size_bytes >= 1_048_576 {
            format!("{:.1} MB", self.size_bytes as f64 / 1_048_576.0)
        } else {
            format!("{} KB", self.size_bytes.div_ceil(1024))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trimmed_mean_ignores_single_spike() {
        let m = trimmed_mean(&[12.0, 14.0, 13.0, 220.0, 11.0]).unwrap();
        assert!((m - 13.0).abs() < 0.1);
    }

    #[test]
    fn hysteresis_and_survival_mode_work() {
        let mut peer = P2PPeerMetrics {
            peer_id: "p1".to_string(),
            display_name: "Ana".to_string(),
            route: P2PRouteKind::Lan,
            direct_rtt_samples_ms: vec![10.0, 11.0, 10.0, 12.0],
            peer_server_rtt_ms: 20.0,
            using_p2p_audio: false,
            connected: true,
        };
        // Server path = 20 + 20 = 40ms, direct = 10.5ms (<= 30ms) -> entra em P2P
        peer.evaluate_route(20.0, true, true);
        assert!(peer.using_p2p_audio);

        // Direct sobe para 48ms (< 40 + 15 = 55ms) -> histerese segura em P2P sem flapping
        peer.direct_rtt_samples_ms = vec![48.0, 48.0, 48.0, 48.0];
        peer.evaluate_route(20.0, true, true);
        assert!(peer.using_p2p_audio);

        // Direct sobe para 60ms (>= 55ms) -> volta ao LiveKit SFU
        peer.direct_rtt_samples_ms = vec![60.0, 60.0, 60.0, 60.0];
        peer.evaluate_route(20.0, true, true);
        assert!(!peer.using_p2p_audio);

        // Servidor cai -> Modo Sobrevivência ativa P2P direto imediatamente
        peer.evaluate_route(20.0, false, true);
        assert!(peer.using_p2p_audio);
    }
}
