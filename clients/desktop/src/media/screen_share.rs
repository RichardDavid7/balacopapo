//! Compartilhamento de tela nativo, **Áudio isolado da janela** (WASAPI Process Loopback / PipeWire)
//! e **Orçamento Dinâmico de Upload** (fim das quedas para 320p — Fase 1 & Fase 5).

#![allow(dead_code)]

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioScope {
    /// Captura isolada apenas da janela/árvore de processos selecionada (zero vazamento).
    WindowOnly,
    /// Áudio do sistema inteiro excluindo o próprio PID do Balacopapo (zero eco da call).
    SystemExcludeSelf,
    /// Sem áudio na transmissão.
    Muted,
}

impl AudioScope {
    pub fn label_pt(self) -> &'static str {
        match self {
            Self::WindowOnly => "Apenas da janela (isolado)",
            Self::SystemExcludeSelf => "Sistema inteiro (sem eco da call)",
            Self::Muted => "Sem áudio",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamPreset {
    P720Fps30,
    P1080Fps60,
    P1440Fps60,
    SourceFps60,
}

impl StreamPreset {
    pub fn label(self) -> &'static str {
        match self {
            Self::P720Fps30 => "720p · 30 fps",
            Self::P1080Fps60 => "1080p · 60 fps",
            Self::P1440Fps60 => "1440p · 60 fps",
            Self::SourceFps60 => "Nativa · 60 fps",
        }
    }

    pub fn target_bitrate_kbps(self) -> u32 {
        match self {
            Self::P720Fps30 => 3_000,
            Self::P1080Fps60 => 6_500,
            Self::P1440Fps60 => 10_000,
            Self::SourceFps60 => 12_000,
        }
    }
}

/// Descreve a capacidade nativa de captura isolada de áudio por aplicativo no SO atual.
pub fn window_audio_backend_label() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "Windows WASAPI Process Loopback (INCLUDE/EXCLUDE_TARGET_PROCESS_TREE)"
    }
    #[cfg(target_os = "linux")]
    {
        "Linux PipeWire Node Isolation (Fedora / CachyOS / Wayland Portal)"
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        "CoreAudio Process Tap / ScreenCaptureKit"
    }
}

/// Calcula o teto dinâmico de bitrate de stream a partir do orçamento de upload da instância (Mbps),
/// preservando o piso mínimo de 1.500 kbps e `maintain-resolution` (sem quedas bruscas para 320p).
pub fn compute_dynamic_stream_bitrate_kbps(
    instance_budget_mbps: f32,
    active_streams: u32,
    viewers: u32,
    preset: StreamPreset,
) -> u32 {
    const FLOOR_KBPS: u32 = 1_500;
    let preset_max = preset.target_bitrate_kbps();

    if instance_budget_mbps <= 0.0 {
        return preset_max;
    }

    let total_kbps = (instance_budget_mbps * 1000.0) as u32;
    let denominator = (active_streams.max(1) * viewers.max(1)).max(1);
    let fair_share = total_kbps / denominator;
    fair_share.clamp(FLOOR_KBPS, preset_max)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dynamic_budget_scales_smoothly_with_floor() {
        // 20 Mbps com 1 stream e 2 espectadores -> 10 Mbps share, capado no preset 1080p60 (6500 kbps)
        assert_eq!(
            compute_dynamic_stream_bitrate_kbps(20.0, 1, 2, StreamPreset::P1080Fps60),
            6_500
        );
        // 10 Mbps com 1 stream e 4 espectadores -> 2500 kbps
        assert_eq!(
            compute_dynamic_stream_bitrate_kbps(10.0, 1, 4, StreamPreset::P1080Fps60),
            2_500
        );
        // Nunca cai abaixo do piso de 1500 kbps
        assert_eq!(
            compute_dynamic_stream_bitrate_kbps(4.0, 2, 10, StreamPreset::P1080Fps60),
            1_500
        );
    }
}
