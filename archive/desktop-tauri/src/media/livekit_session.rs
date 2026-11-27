//! Sessão WebRTC real de Voz em Rust via SDK oficial `livekit` + motor lock-free `cpal`/`rtrb`/`nnnoiseless`.
//!
//! - **Envio (Mic → LiveKit):** captura do microfone em `cpal` → ring buffer `rtrb` → ganho, VAD, mute e RNNoise
//!   em blocos de 480 amostras (10 ms @ 48 kHz) → `NativeAudioSource::capture_frame`.
//! - **Recebimento (LiveKit → Fone):** cada track remoto (`RemoteTrack::Audio`) abre um `NativeAudioStream`
//!   @ 48 kHz mono, aplica o volume individual do participante e alimenta o mixer lock-free do `cpal`.
//! - **Suspensão Ociosa:** ao desconectar (ou dropar `ActiveVoiceSession`), fecha a sala LiveKit e libera DAC/ADC.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use futures_util::StreamExt;
use livekit::options::TrackPublishOptions;
use livekit::prelude::*;
use livekit::webrtc::audio_frame::AudioFrame;
use livekit::webrtc::audio_source::native::NativeAudioSource;
use livekit::webrtc::audio_source::AudioSourceOptions;
use livekit::webrtc::audio_stream::native::NativeAudioStream;
use livekit::webrtc::prelude::RtcAudioSource;
use nnnoiseless::DenoiseState;
use rtrb::{Consumer, Producer, RingBuffer};
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

use crate::media::audio_engine::AudioParams;

const LK_SAMPLE_RATE: u32 = 48_000;
const LK_FRAME_SAMPLES: usize = 480; // 10 ms @ 48 kHz (exato para RNNoise + WebRTC)

struct MixerChannel {
    user_id: String,
    consumer: Consumer<f32>,
}

/// Handle vivo de uma chamada de voz conectada no LiveKit.
/// Ao ser dropado, encerra a sala WebRTC e libera imediatamente microfone e saída de áudio.
pub struct ActiveVoiceSession {
    shutdown_tx: Option<oneshot::Sender<()>>,
    running: Arc<AtomicBool>,
}

impl Drop for ActiveVoiceSession {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Relaxed);
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}

/// Conecta à sala LiveKit real e inicia captura de microfone (RNNoise) + mixer de saída para participantes.
pub async fn connect_voice_session(
    livekit_url: String,
    token: String,
    input_device_name: Option<String>,
    output_device_name: Option<String>,
    params: AudioParams,
    user_volumes: Arc<Mutex<HashMap<String, f32>>>,
) -> Result<ActiveVoiceSession, String> {
    if livekit_url.trim().is_empty() {
        return Err("Instância não informou URL do servidor LiveKit.".to_string());
    }

    let (room, mut room_events) = Room::connect(&livekit_url, &token, RoomOptions::default())
        .await
        .map_err(|e| format!("Falha ao conectar na sala LiveKit: {e}"))?;

    let audio_source = NativeAudioSource::new(
        AudioSourceOptions {
            echo_cancellation: true,
            noise_suppression: false, // RNNoise nativo já cuida antes do WebRTC
            auto_gain_control: true,
        },
        LK_SAMPLE_RATE,
        1,
        200,
    );

    let local_track = LocalAudioTrack::create_audio_track(
        "microphone",
        RtcAudioSource::Native(audio_source.clone()),
    );

    room.local_participant()
        .publish_track(
            LocalTrack::Audio(local_track),
            TrackPublishOptions {
                source: TrackSource::Microphone,
                dtx: true,
                red: true,
                ..Default::default()
            },
        )
        .await
        .map_err(|e| format!("Conectou à sala, mas falhou ao publicar microfone: {e}"))?;

    let running = Arc::new(AtomicBool::new(true));
    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
    let mixer_channels: Arc<Mutex<Vec<MixerChannel>>> = Arc::new(Mutex::new(Vec::new()));

    // ── Thread de captura cpal (Mic -> rtrb) ──
    let (mic_prod, mut mic_cons) = RingBuffer::<f32>::new(LK_SAMPLE_RATE as usize);
    let running_in = running.clone();
    let in_name = input_device_name.clone();
    std::thread::spawn(move || {
        let _stream = start_cpal_input(in_name.as_deref(), mic_prod);
        while running_in.load(Ordering::Relaxed) {
            std::thread::sleep(std::time::Duration::from_millis(60));
        }
    });

    // ── Thread de saída cpal (Mixer lock-free -> Fone) ──
    let running_out = running.clone();
    let out_name = output_device_name.clone();
    let mixer_for_out = mixer_channels.clone();
    let params_for_out = params.clone();
    let vols_for_out = user_volumes.clone();
    std::thread::spawn(move || {
        let _stream = start_cpal_output(
            out_name.as_deref(),
            mixer_for_out,
            params_for_out,
            vols_for_out,
        );
        while running_out.load(Ordering::Relaxed) {
            std::thread::sleep(std::time::Duration::from_millis(60));
        }
    });

    // ── Task assíncrona de DSP + envio (RNNoise + VAD + Mute -> NativeAudioSource) ──
    let running_tx = running.clone();
    let params_tx = params.clone();
    tokio::spawn(async move {
        let mut denoise = DenoiseState::new();
        let mut frame_f32 = [0.0_f32; LK_FRAME_SAMPLES];
        let mut denoised = [0.0_f32; LK_FRAME_SAMPLES];
        let mut pcm_i16 = [0_i16; LK_FRAME_SAMPLES];
        let mut filled = 0usize;

        while running_tx.load(Ordering::Relaxed) {
            while filled < LK_FRAME_SAMPLES {
                match mic_cons.pop() {
                    Ok(s) => {
                        frame_f32[filled] = s;
                        filled += 1;
                    }
                    Err(_) => break,
                }
            }

            if filled < LK_FRAME_SAMPLES {
                tokio::time::sleep(std::time::Duration::from_millis(4)).await;
                continue;
            }
            filled = 0;

            let muted = params_tx.muted.load(Ordering::Relaxed)
                || params_tx.deafened.load(Ordering::Relaxed);
            if muted {
                pcm_i16.fill(0);
            } else {
                let gain = params_tx.mic_gain();
                let mut sum_sq = 0.0_f32;
                for s in &mut frame_f32 {
                    *s = (*s * gain).clamp(-1.0, 1.0);
                    sum_sq += *s * *s;
                }
                let rms = (sum_sq / LK_FRAME_SAMPLES as f32).sqrt();
                let db = if rms > 1e-6 { 20.0 * rms.log10() } else { -120.0 };
                if db < params_tx.vad_threshold_db() {
                    pcm_i16.fill(0);
                } else if params_tx.rnnoise_enabled.load(Ordering::Relaxed) {
                    let mut rn_in = [0.0_f32; LK_FRAME_SAMPLES];
                    for i in 0..LK_FRAME_SAMPLES {
                        rn_in[i] = frame_f32[i] * 32767.0;
                    }
                    denoise.process_frame(&mut denoised, &rn_in);
                    for i in 0..LK_FRAME_SAMPLES {
                        pcm_i16[i] = denoised[i].clamp(-32767.0, 32767.0) as i16;
                    }
                } else {
                    for i in 0..LK_FRAME_SAMPLES {
                        pcm_i16[i] = (frame_f32[i] * 32767.0).clamp(-32767.0, 32767.0) as i16;
                    }
                }
            }

            let audio_frame = AudioFrame {
                data: Cow::Borrowed(&pcm_i16),
                sample_rate: LK_SAMPLE_RATE,
                num_channels: 1,
                samples_per_channel: LK_FRAME_SAMPLES as u32,
            };
            if audio_source.capture_frame(&audio_frame).await.is_err() {
                break;
            }
        }
    });

    // ── Loop principal de eventos da sala LiveKit (recebimento de áudio remoto + shutdown) ──
    let running_room = running.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => {
                    running_room.store(false, Ordering::Relaxed);
                    let _ = room.close().await;
                    break;
                }
                maybe_ev = room_events.recv() => {
                    let Some(ev) = maybe_ev else {
                        running_room.store(false, Ordering::Relaxed);
                        break;
                    };
                    if let RoomEvent::TrackSubscribed {
                        track: RemoteTrack::Audio(audio_track),
                        participant,
                        ..
                    } = ev
                    {
                        let identity = participant.identity().0;
                        let user_id = identity
                            .split(':')
                            .next()
                            .unwrap_or(&identity)
                            .to_string();
                        let (mut prod, cons) = RingBuffer::<f32>::new(LK_SAMPLE_RATE as usize);
                        if let Ok(mut list) = mixer_channels.lock() {
                            list.push(MixerChannel {
                                user_id,
                                consumer: cons,
                            });
                        }
                        let rtc_track = audio_track.rtc_track();
                        let running_sub = running_room.clone();
                        tokio::spawn(async move {
                            let mut stream =
                                NativeAudioStream::new(rtc_track, LK_SAMPLE_RATE as i32, 1);
                            while running_sub.load(Ordering::Relaxed) {
                                let Some(frame) = stream.next().await else {
                                    break;
                                };
                                for &sample in frame.data.iter() {
                                    let _ = prod.push(sample as f32 / 32768.0);
                                }
                            }
                        });
                    }
                }
            }
        }
    });

    Ok(ActiveVoiceSession {
        shutdown_tx: Some(shutdown_tx),
        running,
    })
}

fn start_cpal_input(preferred: Option<&str>, mut prod: Producer<f32>) -> Option<cpal::Stream> {
    let host = cpal::default_host();
    let device = preferred
        .and_then(|name| {
            host.input_devices()
                .ok()?
                .find(|d| d.name().ok().as_deref() == Some(name))
        })
        .or_else(|| host.default_input_device())?;

    let supported = device.default_input_config().ok()?;
    let channels = supported.channels() as usize;
    let config: cpal::StreamConfig = supported.into();

    let stream = device
        .build_input_stream(
            &config,
            move |data: &[f32], _| {
                for frame in data.chunks(channels.max(1)) {
                    let mono = frame.iter().copied().sum::<f32>() / frame.len().max(1) as f32;
                    let _ = prod.push(mono);
                }
            },
            |_err| {},
            None,
        )
        .ok()?;
    stream.play().ok()?;
    Some(stream)
}

fn start_cpal_output(
    preferred: Option<&str>,
    mixer_channels: Arc<Mutex<Vec<MixerChannel>>>,
    params: AudioParams,
    user_volumes: Arc<Mutex<HashMap<String, f32>>>,
) -> Option<cpal::Stream> {
    let host = cpal::default_host();
    let device = preferred
        .and_then(|name| {
            host.output_devices()
                .ok()?
                .find(|d| d.name().ok().as_deref() == Some(name))
        })
        .or_else(|| host.default_output_device())?;

    let supported = device.default_output_config().ok()?;
    let channels = supported.channels() as usize;
    let config: cpal::StreamConfig = supported.into();

    let stream = device
        .build_output_stream(
            &config,
            move |out: &mut [f32], _| {
                if params.deafened.load(Ordering::Relaxed) {
                    out.fill(0.0);
                    return;
                }
                let Ok(mut list) = mixer_channels.try_lock() else {
                    out.fill(0.0);
                    return;
                };
                let vols_guard = user_volumes.try_lock().ok();
                for frame in out.chunks_mut(channels.max(1)) {
                    let mut mixed = 0.0_f32;
                    for ch in list.iter_mut() {
                        if let Ok(sample) = ch.consumer.pop() {
                            let vol = vols_guard
                                .as_ref()
                                .and_then(|map| map.get(&ch.user_id).copied())
                                .unwrap_or(1.0);
                            mixed += sample * vol;
                        }
                    }
                    let clamped = mixed.clamp(-1.0, 1.0);
                    for slot in frame.iter_mut() {
                        *slot = clamped;
                    }
                }
            },
            |_err| {},
            None,
        )
        .ok()?;
    stream.play().ok()?;
    Some(stream)
}
