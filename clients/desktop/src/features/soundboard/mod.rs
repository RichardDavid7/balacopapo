use iced::widget::{button, canvas, column, container, horizontal_space, row, scrollable, slider, text, text_input};
use iced::{Alignment, Color, Element, Length, Point, Rectangle, Renderer, Size, Theme};

use crate::core::models::SoundboardSound;
use crate::media::wav_dsp::WavClip;
use crate::ui::aether_drift;

#[derive(Debug, Clone)]
pub struct SoundboardState {
    pub sounds: Vec<SoundboardSound>,
    pub loading: bool,
    pub search: String,
    pub volume_pct: f32,
    pub editor_clip: WavClip,
    pub editor_peaks: Vec<f32>,
    pub trim_start: f32,
    pub trim_end: f32,
    pub status_note: Option<String>,
    pub error: Option<String>,
}

impl Default for SoundboardState {
    fn default() -> Self {
        let clip = WavClip::demo_chime();
        let peaks = clip.compute_peaks(72);
        Self {
            sounds: Vec::new(),
            loading: false,
            search: String::new(),
            volume_pct: 80.0,
            editor_clip: clip,
            editor_peaks: peaks,
            trim_start: 0.0,
            trim_end: 1.0,
            status_note: None,
            error: None,
        }
    }
}

impl SoundboardState {
    pub fn load_clip_into_editor(&mut self, clip: WavClip, label: String) {
        self.editor_peaks = clip.compute_peaks(72);
        self.editor_clip = clip;
        self.trim_start = 0.0;
        self.trim_end = 1.0;
        self.status_note = Some(format!("Carregado no editor: {label}"));
    }

    pub fn normalize_editor_clip(&mut self) {
        self.editor_clip.normalize_active_rms(-14.0);
        self.editor_peaks = self.editor_clip.compute_peaks(72);
        self.status_note = Some("Normalização Active-RMS (-14 dBFS) + Soft Limiter aplicada!".to_string());
    }
}

#[derive(Debug, Clone)]
pub enum SoundboardAction {
    Refresh,
    SearchChanged(String),
    VolumeChanged(f32),
    PreviewServerSound { name: String, file_url: String },
    TrimStartChanged(f32),
    TrimEndChanged(f32),
    NormalizeActiveRms,
    PreviewEditorClip,
    LoadDemoClip,
}

struct WaveformCanvas<'a> {
    peaks: &'a [f32],
    trim_start: f32,
    trim_end: f32,
}

impl canvas::Program<SoundboardAction> for WaveformCanvas<'_> {
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

        if self.peaks.is_empty() {
            return vec![frame.into_geometry()];
        }

        let bar_step = bounds.width / self.peaks.len() as f32;
        let bar_w = (bar_step * 0.68).max(2.0);
        let mid_y = bounds.height * 0.5;

        for (i, &peak) in self.peaks.iter().enumerate() {
            let ratio = i as f32 / self.peaks.len() as f32;
            let in_selection = ratio >= self.trim_start && ratio <= self.trim_end;
            let h = (peak.clamp(0.04, 1.0) * (bounds.height - 12.0)).max(3.0);
            let x = i as f32 * bar_step + (bar_step - bar_w) * 0.5;
            let y = mid_y - h * 0.5;
            let color = if in_selection {
                aether_drift::ACCENT_VIOLET
            } else {
                Color::from_rgba(0.604, 0.627, 0.706, 0.30)
            };
            frame.fill_rectangle(Point::new(x, y), Size::new(bar_w, h), color);
        }

        vec![frame.into_geometry()]
    }
}

pub fn view<'a>(state: &'a SoundboardState) -> Element<'a, SoundboardAction> {
    let header = row![
        column![
            text("Soundboard & Editor WAV (GPU)").size(18),
            text("Curva de volume quadrática · Normalização Active-RMS + Soft Limiter")
                .size(12)
                .color(aether_drift::TEXT_MUTED),
        ]
        .spacing(2),
        horizontal_space(),
        button(text(if state.loading { "..." } else { "Recarregar" }).size(12))
            .on_press_maybe((!state.loading).then_some(SoundboardAction::Refresh))
            .padding([6, 12])
            .style(aether_drift::ghost_button_style),
    ]
    .align_y(Alignment::Center);

    let controls = row![
        text_input("Buscar som ou pasta...", &state.search)
            .on_input(SoundboardAction::SearchChanged)
            .padding(9)
            .width(Length::FillPortion(2))
            .style(aether_drift::input_style),
        column![
            text(format!("Volume Soundboard: {:.0}%", state.volume_pct))
                .size(11)
                .color(aether_drift::TEXT_MUTED),
            slider(0.0..=150.0, state.volume_pct, SoundboardAction::VolumeChanged).step(5.0_f32),
        ]
        .width(Length::FillPortion(1)),
    ]
    .spacing(12)
    .align_y(Alignment::Center);

    let query = state.search.trim().to_ascii_lowercase();
    let mut sound_list = column![].spacing(6);

    if state.sounds.is_empty() {
        sound_list = sound_list.push(
            text("Nenhum som carregado do servidor ainda (ou Soundboard vazio).")
                .size(12)
                .color(aether_drift::TEXT_MUTED),
        );
    } else {
        for s in &state.sounds {
            let folder = s.folder.as_deref().unwrap_or("");
            if !query.is_empty()
                && !s.name.to_ascii_lowercase().contains(&query)
                && !folder.to_ascii_lowercase().contains(&query)
            {
                continue;
            }
            let emoji = s.emoji.as_deref().unwrap_or("🎵");
            let label = if folder.is_empty() {
                format!("{emoji} {}", s.name)
            } else {
                format!("{emoji} {}  [{folder}]", s.name)
            };
            sound_list = sound_list.push(
                button(text(label).size(13))
                    .width(Length::Fill)
                    .padding([8, 12])
                    .on_press(SoundboardAction::PreviewServerSound {
                        name: s.name.clone(),
                        file_url: s.file_url.clone(),
                    })
                    .style(aether_drift::ghost_button_style),
            );
        }
    }

    let waveform = canvas(WaveformCanvas {
        peaks: &state.editor_peaks,
        trim_start: state.trim_start,
        trim_end: state.trim_end,
    })
    .width(Length::Fill)
    .height(Length::Fixed(92.0));

    let editor_card = container(
        column![
            row![
                text(format!(
                    "Editor WAV Nativo ({:.2}s · {} Hz)",
                    state.editor_clip.duration_secs(),
                    state.editor_clip.sample_rate
                ))
                .size(14),
                horizontal_space(),
                button(text("Clipe Demo").size(11))
                    .on_press(SoundboardAction::LoadDemoClip)
                    .padding([4, 10])
                    .style(aether_drift::ghost_button_style),
            ]
            .align_y(Alignment::Center),
            waveform,
            row![
                column![
                    text(format!("Início do recorte: {:.0}%", state.trim_start * 100.0))
                        .size(11)
                        .color(aether_drift::TEXT_MUTED),
                    slider(0.0..=0.95, state.trim_start, SoundboardAction::TrimStartChanged)
                        .step(0.01_f32),
                ]
                .width(Length::FillPortion(1)),
                column![
                    text(format!("Fim do recorte: {:.0}%", state.trim_end * 100.0))
                        .size(11)
                        .color(aether_drift::TEXT_MUTED),
                    slider(0.05..=1.0, state.trim_end, SoundboardAction::TrimEndChanged)
                        .step(0.01_f32),
                ]
                .width(Length::FillPortion(1)),
            ]
            .spacing(12),
            row![
                button(text("Normalizar Active-RMS + Limiter").size(12))
                    .on_press(SoundboardAction::NormalizeActiveRms)
                    .padding([8, 14])
                    .style(aether_drift::ghost_button_style),
                button(text("▶ Ouvir Prévia Recortada").size(12))
                    .on_press(SoundboardAction::PreviewEditorClip)
                    .padding([8, 16])
                    .style(aether_drift::primary_button_style),
            ]
            .spacing(10),
        ]
        .spacing(10),
    )
    .width(Length::Fill)
    .padding(16)
    .style(aether_drift::card_style);

    let mut root = column![
        header,
        controls,
        scrollable(sound_list).height(Length::FillPortion(1)),
        editor_card,
    ]
    .spacing(12);

    if let Some(note) = &state.status_note {
        root = root.push(text(note).size(12).color(aether_drift::SUCCESS_GREEN));
    }
    if let Some(err) = &state.error {
        root = root.push(text(err).size(12).color(aether_drift::DANGER_RED));
    }

    root.height(Length::Fill).into()
}
