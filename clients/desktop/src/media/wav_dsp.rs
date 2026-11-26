//! Processamento WAV em Rust puro para o Editor do Soundboard:
//! - Decodificação / codificação PCM 16-bit via `hound`
//! - Recorte (trim) por razão `[0.0..1.0]`
//! - Normalização **Active-RMS** (ignora silêncio abaixo de -45 dBFS) + **Soft Limiter (`tanh`)**
//! - Downsample de picos para renderização GPU (`iced::widget::canvas`)

#![allow(dead_code)]

use std::io::Cursor;

#[derive(Debug, Clone)]
pub struct WavClip {
    pub sample_rate: u32,
    pub samples: Vec<f32>, // mono normalizado [-1.0..1.0]
}

impl WavClip {
    pub fn from_wav_bytes(bytes: &[u8]) -> Result<Self, String> {
        let mut reader = hound::WavReader::new(Cursor::new(bytes))
            .map_err(|e| format!("WAV inválido: {e}"))?;
        let spec = reader.spec();
        let channels = spec.channels.max(1) as usize;

        let raw_samples: Vec<f32> = match spec.sample_format {
            hound::SampleFormat::Float => reader
                .samples::<f32>()
                .filter_map(Result::ok)
                .collect(),
            hound::SampleFormat::Int => {
                let max_val = ((1_i64 << (spec.bits_per_sample.saturating_sub(1))) - 1) as f32;
                let denom = max_val.max(1.0);
                reader
                    .samples::<i32>()
                    .filter_map(Result::ok)
                    .map(|s| (s as f32 / denom).clamp(-1.0, 1.0))
                    .collect()
            }
        };

        let mut mono = Vec::with_capacity(raw_samples.len() / channels);
        for frame in raw_samples.chunks(channels) {
            let sum: f32 = frame.iter().copied().sum();
            mono.push(sum / frame.len() as f32);
        }

        Ok(Self {
            sample_rate: spec.sample_rate.max(8_000),
            samples: mono,
        })
    }

    /// Gera um clipe sintético curto (440 Hz -> 660 Hz com envelope suave) para testar o Editor WAV.
    pub fn demo_chime() -> Self {
        let sr = 48_000_u32;
        let len = (sr as f32 * 0.85) as usize;
        let mut samples = Vec::with_capacity(len);
        for i in 0..len {
            let t = i as f32 / sr as f32;
            let freq = if t < 0.35 { 440.0 } else { 659.25 };
            let env = (t * 25.0).min(1.0) * ((0.85 - t) * 4.0).clamp(0.0, 1.0);
            let s = (2.0 * std::f32::consts::PI * freq * t).sin() * env * 0.45;
            samples.push(s);
        }
        Self {
            sample_rate: sr,
            samples,
        }
    }

    pub fn duration_secs(&self) -> f32 {
        if self.sample_rate == 0 {
            return 0.0;
        }
        self.samples.len() as f32 / self.sample_rate as f32
    }

    pub fn trimmed(&self, start_ratio: f32, end_ratio: f32) -> Self {
        if self.samples.is_empty() {
            return self.clone();
        }
        let s = start_ratio.clamp(0.0, 0.98);
        let e = end_ratio.clamp(s + 0.02, 1.0);
        let start_idx = ((self.samples.len() as f32) * s) as usize;
        let end_idx = (((self.samples.len() as f32) * e) as usize).min(self.samples.len());
        Self {
            sample_rate: self.sample_rate,
            samples: self.samples[start_idx..end_idx].to_vec(),
        }
    }

    /// Normalização Active-RMS (target padrão -14 dBFS) com soft limiter `tanh` anti-clipping.
    pub fn normalize_active_rms(&mut self, target_dbfs: f32) {
        if self.samples.is_empty() {
            return;
        }
        let noise_floor = 10_f32.powf(-45.0 / 20.0); // ~0.0056
        let mut sum_sq = 0.0_f64;
        let mut active_count = 0_usize;

        for &s in &self.samples {
            if s.abs() >= noise_floor {
                sum_sq += (s as f64) * (s as f64);
                active_count += 1;
            }
        }

        if active_count == 0 {
            return;
        }

        let active_rms = (sum_sq / active_count as f64).sqrt() as f32;
        if active_rms <= 1e-6 {
            return;
        }

        let target_linear = 10_f32.powf(target_dbfs / 20.0);
        let gain = (target_linear / active_rms).clamp(0.1, 12.0);

        for s in &mut self.samples {
            // Soft limiter suave para evitar distorção dura acima de 0 dBFS
            *s = (*s * gain).tanh();
        }
    }

    pub fn compute_peaks(&self, buckets: usize) -> Vec<f32> {
        if self.samples.is_empty() || buckets == 0 {
            return Vec::new();
        }
        let chunk = (self.samples.len() / buckets).max(1);
        self.samples
            .chunks(chunk)
            .take(buckets)
            .map(|c| c.iter().fold(0.0_f32, |acc, &x| acc.max(x.abs())))
            .collect()
    }

    pub fn to_wav_bytes(&self) -> Result<Vec<u8>, String> {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: self.sample_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut cursor = Cursor::new(Vec::new());
        {
            let mut writer = hound::WavWriter::new(&mut cursor, spec)
                .map_err(|e| format!("Falha ao criar WAV: {e}"))?;
            for &s in &self.samples {
                let sample_i16 = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                writer
                    .write_sample(sample_i16)
                    .map_err(|e| format!("Falha ao gravar sample WAV: {e}"))?;
            }
            writer
                .finalize()
                .map_err(|e| format!("Falha ao finalizar WAV: {e}"))?;
        }
        Ok(cursor.into_inner())
    }
}

/// Curva quadrática de volume do Soundboard (paridade com Balacopapo Web).
pub fn quadratic_gain(percent: f32) -> f32 {
    let norm = (percent / 100.0).clamp(0.0, 2.0);
    norm * norm
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_roundtrip_trim_and_active_rms_work() {
        let mut clip = WavClip::demo_chime();
        assert!(clip.duration_secs() > 0.8);
        clip.normalize_active_rms(-14.0);
        assert!(clip.samples.iter().all(|s| s.abs() <= 1.0));

        let trimmed = clip.trimmed(0.1, 0.6);
        assert!(trimmed.samples.len() < clip.samples.len());

        let peaks = trimmed.compute_peaks(32);
        assert_eq!(peaks.len(), 32);

        let bytes = trimmed.to_wav_bytes().unwrap();
        let decoded = WavClip::from_wav_bytes(&bytes).unwrap();
        assert_eq!(decoded.sample_rate, 48_000);
        assert_eq!(decoded.samples.len(), trimmed.samples.len());
    }

    #[test]
    fn quadratic_gain_matches_curve() {
        assert!((quadratic_gain(0.0) - 0.0).abs() < 1e-5);
        assert!((quadratic_gain(50.0) - 0.25).abs() < 1e-5);
        assert!((quadratic_gain(100.0) - 1.0).abs() < 1e-5);
    }
}
