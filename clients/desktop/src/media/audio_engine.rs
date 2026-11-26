//! Motor de Áudio Nativo Lock-Free (`cpal` + `rtrb` + `nnnoiseless` RNNoise).
//!
//! Zero-Stutter Budget:
//! - Sem `Mutex` na thread de áudio real-time: parâmetros são lidos via `AtomicBool`/`AtomicU32`.
//! - Buffer circular *wait-free* (`rtrb`) conecta captura do microfone e reprodução local (loopback).
//! - **Suspensão Ociosa (PR #494):** quando `stop()` é chamado, os streams `cpal` são descartados
//!   imediatamente, liberando o DAC WASAPI/PipeWire (0% CPU).

#![allow(dead_code)]

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use nnnoiseless::DenoiseState;
use rtrb::RingBuffer;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct AudioParams {
    pub muted: Arc<AtomicBool>,
    pub deafened: Arc<AtomicBool>,
    pub rnnoise_enabled: Arc<AtomicBool>,
    pub mic_gain_bits: Arc<AtomicU32>,
    pub vad_threshold_db_bits: Arc<AtomicU32>,
    pub speaking: Arc<AtomicBool>,
}

impl Default for AudioParams {
    fn default() -> Self {
        Self {
            muted: Arc::new(AtomicBool::new(false)),
            deafened: Arc::new(AtomicBool::new(false)),
            rnnoise_enabled: Arc::new(AtomicBool::new(true)),
            mic_gain_bits: Arc::new(AtomicU32::new(1.0_f32.to_bits())),
            vad_threshold_db_bits: Arc::new(AtomicU32::new((-48.0_f32).to_bits())),
            speaking: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl AudioParams {
    pub fn set_mic_gain(&self, gain: f32) {
        self.mic_gain_bits
            .store(gain.clamp(0.0, 3.0).to_bits(), Ordering::Relaxed);
    }

    pub fn set_vad_threshold_db(&self, db: f32) {
        self.vad_threshold_db_bits
            .store(db.clamp(-80.0, -5.0).to_bits(), Ordering::Relaxed);
    }
}

pub struct ActiveLoopback {
    _input_stream: cpal::Stream,
    _output_stream: cpal::Stream,
    pub sample_rate: u32,
}

pub fn list_input_devices() -> Vec<String> {
    let host = cpal::default_host();
    let Ok(devices) = host.input_devices() else {
        return vec!["Padrão do Sistema".to_string()];
    };
    let mut names: Vec<String> = devices.filter_map(|d| d.name().ok()).collect();
    if names.is_empty() {
        names.push("Padrão do Sistema".to_string());
    }
    names
}

pub fn list_output_devices() -> Vec<String> {
    let host = cpal::default_host();
    let Ok(devices) = host.output_devices() else {
        return vec!["Padrão do Sistema".to_string()];
    };
    let mut names: Vec<String> = devices.filter_map(|d| d.name().ok()).collect();
    if names.is_empty() {
        names.push("Padrão do Sistema".to_string());
    }
    names
}

/// Inicia loopback local de microfone com **RNNoise (`nnnoiseless`) + VAD Gate**
/// usando ring buffer lock-free (`rtrb`).
pub fn start_mic_loopback(
    input_name: Option<&str>,
    output_name: Option<&str>,
    params: AudioParams,
) -> Result<ActiveLoopback, String> {
    let host = cpal::default_host();

    let input_device = input_name
        .and_then(|target| {
            host.input_devices()
                .ok()?
                .find(|d| d.name().ok().as_deref() == Some(target))
        })
        .or_else(|| host.default_input_device())
        .ok_or_else(|| "Nenhum dispositivo de microfone encontrado.".to_string())?;

    let output_device = output_name
        .and_then(|target| {
            host.output_devices()
                .ok()?
                .find(|d| d.name().ok().as_deref() == Some(target))
        })
        .or_else(|| host.default_output_device())
        .ok_or_else(|| "Nenhum dispositivo de saída de áudio encontrado.".to_string())?;

    let in_cfg = input_device
        .default_input_config()
        .map_err(|e| format!("Erro ao ler config do microfone: {e}"))?;
    let out_cfg = output_device
        .default_output_config()
        .map_err(|e| format!("Erro ao ler config de saída: {e}"))?;

    let sample_rate = in_cfg.sample_rate().0;
    let in_channels = in_cfg.channels().max(1) as usize;
    let out_channels = out_cfg.channels().max(1) as usize;

    // Ring buffer wait-free com ~200ms de capacidade
    let (mut prod, mut cons) = RingBuffer::<f32>::new((sample_rate as usize / 5).max(4096));

    let in_params = params.clone();
    let mut denoiser = DenoiseState::new();
    let mut rnn_in = [0.0_f32; DenoiseState::FRAME_SIZE];
    let mut rnn_out = [0.0_f32; DenoiseState::FRAME_SIZE];
    let mut rnn_pos = 0_usize;

    let input_stream = input_device
        .build_input_stream(
            &in_cfg.into(),
            move |data: &[f32], _| {
                if in_params.muted.load(Ordering::Relaxed) {
                    in_params.speaking.store(false, Ordering::Relaxed);
                    return;
                }
                let gain = f32::from_bits(in_params.mic_gain_bits.load(Ordering::Relaxed));
                let vad_db =
                    f32::from_bits(in_params.vad_threshold_db_bits.load(Ordering::Relaxed));
                let vad_lin = 10_f32.powf(vad_db / 20.0);
                let use_rnn = in_params.rnnoise_enabled.load(Ordering::Relaxed);

                for frame in data.chunks(in_channels) {
                    let mono = (frame.iter().copied().sum::<f32>() / frame.len() as f32) * gain;
                    if use_rnn {
                        // nnnoiseless opera na escala i16 [-32768..32767]
                        rnn_in[rnn_pos] = (mono * 32767.0).clamp(-32768.0, 32767.0);
                        rnn_pos += 1;
                        if rnn_pos == DenoiseState::FRAME_SIZE {
                            denoiser.process_frame(&mut rnn_out, &rnn_in);
                            let mut peak = 0.0_f32;
                            for &s in &rnn_out {
                                let norm = (s / 32767.0).clamp(-1.0, 1.0);
                                peak = peak.max(norm.abs());
                            }
                            let open = peak >= vad_lin;
                            in_params.speaking.store(open, Ordering::Relaxed);
                            for &s in &rnn_out {
                                let out_s = if open {
                                    (s / 32767.0).clamp(-1.0, 1.0)
                                } else {
                                    0.0
                                };
                                let _ = prod.push(out_s);
                            }
                            rnn_pos = 0;
                        }
                    } else {
                        let open = mono.abs() >= vad_lin;
                        in_params.speaking.store(open, Ordering::Relaxed);
                        let _ = prod.push(if open { mono.clamp(-1.0, 1.0) } else { 0.0 });
                    }
                }
            },
            |_err| {},
            None,
        )
        .map_err(|e| format!("Falha ao abrir captura WASAPI/ALSA: {e}"))?;

    let out_params = params;
    let output_stream = output_device
        .build_output_stream(
            &out_cfg.into(),
            move |data: &mut [f32], _| {
                let deaf = out_params.deafened.load(Ordering::Relaxed);
                for frame in data.chunks_mut(out_channels) {
                    let sample = if deaf {
                        let _ = cons.pop();
                        0.0
                    } else {
                        cons.pop().unwrap_or(0.0)
                    };
                    for ch in frame {
                        *ch = sample;
                    }
                }
            },
            |_err| {},
            None,
        )
        .map_err(|e| format!("Falha ao abrir saída de áudio: {e}"))?;

    input_stream
        .play()
        .map_err(|e| format!("Falha ao iniciar microfone: {e}"))?;
    output_stream
        .play()
        .map_err(|e| format!("Falha ao iniciar saída de áudio: {e}"))?;

    Ok(ActiveLoopback {
        _input_stream: input_stream,
        _output_stream: output_stream,
        sample_rate,
    })
}

/// Reproduz um clipe mono em thread separada usando `cpal` (prévia do Soundboard / Editor WAV).
pub fn play_clip_once(samples: Vec<f32>, gain: f32, output_name: Option<String>) {
    std::thread::spawn(move || {
        let host = cpal::default_host();
        let device = output_name
            .as_deref()
            .and_then(|target| {
                host.output_devices()
                    .ok()?
                    .find(|d| d.name().ok().as_deref() == Some(target))
            })
            .or_else(|| host.default_output_device());

        let Some(device) = device else { return };
        let Ok(out_cfg) = device.default_output_config() else {
            return;
        };
        let sr = out_cfg.sample_rate().0.max(8_000);
        let channels = out_cfg.channels().max(1) as usize;
        let duration_ms = ((samples.len() as u64 * 1000) / sr as u64).min(15_000) + 120;

        let mut cursor = 0_usize;
        let stream = device.build_output_stream(
            &out_cfg.into(),
            move |data: &mut [f32], _| {
                for frame in data.chunks_mut(channels) {
                    let s = if cursor < samples.len() {
                        let v = (samples[cursor] * gain).clamp(-1.0, 1.0);
                        cursor += 1;
                        v
                    } else {
                        0.0
                    };
                    for ch in frame {
                        *ch = s;
                    }
                }
            },
            |_err| {},
            None,
        );

        if let Ok(stream) = stream {
            if stream.play().is_ok() {
                std::thread::sleep(std::time::Duration::from_millis(duration_ms));
            }
        }
    });
}
