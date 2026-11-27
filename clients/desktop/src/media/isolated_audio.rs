//! Captura de **Áudio Isolado por Janela/Processo** (Etapa 2):
//! - **Windows 10 (Build 20348+) / Windows 11:** WASAPI Process Loopback nativo
//!   (`ActivateAudioInterfaceAsync` + `AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS`):
//!   - `IncludeProcessTree { pid }`: captura apenas o áudio do aplicativo/jogo alvo e seus filhos.
//!   - `ExcludeSelf`: captura todo o áudio do sistema excluindo o próprio PID do Balacopapo (zero eco da call).
//! - **Linux (Fedora / CachyOS — PipeWire):**
//!   - Descobre nós de reprodução via `pw-dump` (incluindo jogos Wine/Proton/Steam) e captura
//!     PCM `f32` estéreo 48 kHz em streaming via `pw-record` sem arquivos temporários.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

pub const CAPTURE_SAMPLE_RATE: u32 = 48_000;
pub const CAPTURE_CHANNELS: u16 = 2;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AudioTarget {
    pub pid: u32,
    pub process_name: String,
    pub window_title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pipewire_node_id: Option<u32>,
    pub is_system_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum IsolatedAudioMode {
    /// Isola apenas o processo/janela especificado (e sua árvore de subprocessos).
    IncludeProcessTree {
        pid: u32,
        #[serde(default)]
        pipewire_node_id: Option<u32>,
        #[serde(default)]
        label: Option<String>,
    },
    /// Captura o áudio do sistema inteiro excluindo o próprio processo do Balacopapo.
    ExcludeSelf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IsolatedAudioStatus {
    pub active: bool,
    pub mode: Option<IsolatedAudioMode>,
    pub target_label: Option<String>,
    pub backend: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub peak_level: f32,
    pub captured_frames: u64,
    pub error: Option<String>,
}

pub fn audio_isolation_backend_name() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "Windows WASAPI Process Loopback"
    }
    #[cfg(target_os = "linux")]
    {
        "Linux PipeWire Per-App Capture"
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        "Indisponível nesta plataforma"
    }
}

/// Calcula o pico absoluto normalizado `[0.0, 1.0]` de um bloco PCM `f32`.
pub fn compute_pcm_f32_peak(samples: &[f32]) -> f32 {
    let mut peak = 0.0_f32;
    for &s in samples {
        if s.is_finite() {
            let a = s.abs();
            if a > peak {
                peak = a;
            }
        }
    }
    peak.min(1.0)
}

/// Lista os alvos de áudio disponíveis no SO atual, sempre incluindo a opção de sistema sem eco no topo.
pub fn list_audio_targets() -> Vec<AudioTarget> {
    let mut targets = vec![AudioTarget {
        pid: 0,
        process_name: "system".to_string(),
        window_title: "Sistema inteiro (sem eco do Balacopapo)".to_string(),
        pipewire_node_id: None,
        is_system_default: true,
    }];

    #[cfg(target_os = "windows")]
    {
        targets.extend(win_impl::list_windows_targets());
    }

    #[cfg(target_os = "linux")]
    {
        targets.extend(linux_impl::list_pipewire_targets());
    }

    targets
}

struct SharedMetrics {
    running: AtomicBool,
    peak_bits: AtomicU32,
    captured_frames: AtomicU64,
    last_error: Mutex<Option<String>>,
}

impl SharedMetrics {
    fn new() -> Self {
        Self {
            running: AtomicBool::new(true),
            peak_bits: AtomicU32::new(0.0_f32.to_bits()),
            captured_frames: AtomicU64::new(0),
            last_error: Mutex::new(None),
        }
    }

    fn set_error(&self, msg: String) {
        if let Ok(mut guard) = self.last_error.lock() {
            *guard = Some(msg);
        }
    }

    fn record_block(&self, samples: &[f32]) {
        let peak = compute_pcm_f32_peak(samples);
        self.peak_bits.store(peak.to_bits(), Ordering::Relaxed);
        let frames = (samples.len() / usize::from(CAPTURE_CHANNELS)) as u64;
        self.captured_frames.fetch_add(frames, Ordering::Relaxed);
    }
}

struct ActiveCapture {
    mode: IsolatedAudioMode,
    target_label: String,
    metrics: Arc<SharedMetrics>,
    worker: Option<JoinHandle<()>>,
}

pub struct IsolatedAudioController {
    active: Mutex<Option<ActiveCapture>>,
}

impl Default for IsolatedAudioController {
    fn default() -> Self {
        Self::new()
    }
}

impl IsolatedAudioController {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(None),
        }
    }

    pub fn start(&self, mode: IsolatedAudioMode) -> Result<IsolatedAudioStatus, String> {
        self.stop();

        let target_label = match &mode {
            IsolatedAudioMode::ExcludeSelf => {
                "Sistema inteiro (sem eco do Balacopapo)".to_string()
            }
            IsolatedAudioMode::IncludeProcessTree { pid, label, .. } => label
                .clone()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| format!("Processo PID {pid}")),
        };

        let metrics = Arc::new(SharedMetrics::new());
        let worker_metrics = Arc::clone(&metrics);
        let worker_mode = mode.clone();

        let worker = std::thread::Builder::new()
            .name("bp-isolated-audio".to_string())
            .spawn(move || {
                #[cfg(target_os = "windows")]
                win_impl::run_capture_loop(worker_mode, worker_metrics);

                #[cfg(target_os = "linux")]
                linux_impl::run_capture_loop(worker_mode, worker_metrics);

                #[cfg(not(any(target_os = "windows", target_os = "linux")))]
                {
                    let _ = worker_mode;
                    worker_metrics.set_error("Captura isolada indisponível neste SO.".to_string());
                    worker_metrics.running.store(false, Ordering::SeqCst);
                }
            })
            .map_err(|e| format!("Falha ao iniciar thread de captura de áudio: {e}"))?;

        if let Ok(mut guard) = self.active.lock() {
            *guard = Some(ActiveCapture {
                mode,
                target_label,
                metrics,
                worker: Some(worker),
            });
        }

        Ok(self.status())
    }

    pub fn stop(&self) {
        let taken = self.active.lock().ok().and_then(|mut g| g.take());
        if let Some(mut cap) = taken {
            cap.metrics.running.store(false, Ordering::SeqCst);
            if let Some(handle) = cap.worker.take() {
                let _ = handle.join();
            }
        }
    }

    pub fn status(&self) -> IsolatedAudioStatus {
        let guard = self.active.lock().ok();
        if let Some(Some(cap)) = guard.as_deref() {
            let err = cap.metrics.last_error.lock().ok().and_then(|e| e.clone());
            IsolatedAudioStatus {
                active: cap.metrics.running.load(Ordering::Relaxed),
                mode: Some(cap.mode.clone()),
                target_label: Some(cap.target_label.clone()),
                backend: audio_isolation_backend_name().to_string(),
                sample_rate: CAPTURE_SAMPLE_RATE,
                channels: CAPTURE_CHANNELS,
                peak_level: f32::from_bits(cap.metrics.peak_bits.load(Ordering::Relaxed)),
                captured_frames: cap.metrics.captured_frames.load(Ordering::Relaxed),
                error: err,
            }
        } else {
            IsolatedAudioStatus {
                active: false,
                mode: None,
                target_label: None,
                backend: audio_isolation_backend_name().to_string(),
                sample_rate: CAPTURE_SAMPLE_RATE,
                channels: CAPTURE_CHANNELS,
                peak_level: 0.0,
                captured_frames: 0,
                error: None,
            }
        }
    }
}

impl Drop for IsolatedAudioController {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Parser puro do JSON do `pw-dump` (usado no Linux e testado em todas as plataformas).
pub fn parse_pw_dump_audio_targets(raw_json: &str, self_pid: u32) -> Vec<AudioTarget> {
    let Ok(items) = serde_json::from_str::<Vec<serde_json::Value>>(raw_json) else {
        return Vec::new();
    };

    let mut seen_nodes = std::collections::HashSet::new();
    let mut results = Vec::new();

    for item in items {
        let Some(node_id) = item.get("id").and_then(|v| v.as_u64()).map(|id| id as u32) else {
            continue;
        };
        let Some(props) = item.pointer("/info/props") else {
            continue;
        };
        let media_class = props
            .get("media.class")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        if media_class != "Stream/Output/Audio" {
            continue;
        }

        let pid = props
            .get("application.process.id")
            .and_then(|v| {
                v.as_u64()
                    .or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
            })
            .unwrap_or(0) as u32;

        if pid != 0 && pid == self_pid {
            continue;
        }

        let binary = props
            .get("application.process.binary")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        if binary.eq_ignore_ascii_case("balacopapo-desktop")
            || binary.eq_ignore_ascii_case("balacopapo")
        {
            continue;
        }

        if !seen_nodes.insert(node_id) {
            continue;
        }

        let app_name = props
            .get("application.name")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(ToString::to_string);
        let media_name = props
            .get("media.name")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(ToString::to_string);

        let title = match (app_name.as_deref(), media_name.as_deref()) {
            (Some(a), Some(m)) if !a.eq_ignore_ascii_case(m) => format!("{a} — {m}"),
            (Some(a), _) => a.to_string(),
            (None, Some(m)) => m.to_string(),
            (None, None) => format!("Stream PipeWire #{node_id}"),
        };

        let process_name = if !binary.is_empty() {
            binary
        } else {
            app_name.unwrap_or_else(|| "pipewire".to_string())
        };

        results.push(AudioTarget {
            pid,
            process_name,
            window_title: title,
            pipewire_node_id: Some(node_id),
            is_system_default: false,
        });
    }

    results
}

#[cfg(target_os = "windows")]
mod win_impl {
    use super::*;
    use std::collections::HashMap;
    use std::ffi::c_void;
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
    use windows::core::{implement, Interface, PCWSTR};
    use windows::Win32::Foundation::{CloseHandle, BOOL, HANDLE, HWND, LPARAM};
    use windows::Win32::Media::Audio::{
        ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation,
        IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl,
        IAudioCaptureClient, IAudioClient, AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
        AUDCLNT_STREAMFLAGS_LOOPBACK, AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
        AUDIOCLIENT_ACTIVATION_PARAMS, AUDIOCLIENT_ACTIVATION_PARAMS_0,
        AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK, AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
        PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
        PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
        WAVEFORMATEX,
    };
    use windows::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, IAgileObject, IAgileObject_Impl, COINIT_MULTITHREADED,
    };
    use windows::Win32::System::Threading::{CreateEventW, SetEvent, WaitForSingleObject};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
        IsWindowVisible,
    };

    /// Constante padrão Win32 (`mmreg.h`): IEEE 32-bit float PCM.
    const WAVE_FORMAT_IEEE_FLOAT: u16 = 0x0003;
    /// Constante padrão COM (`wtypes.h`): `VT_BLOB`.
    const VT_BLOB_TAG: u16 = 65;

    /// Layout ABI exato de `PROPVARIANT` contendo `VT_BLOB` em x86_64 Windows (24 bytes),
    /// sem depender de nomes internos privados nem acionar `PropVariantClear` sobre memória da stack.
    #[repr(C)]
    struct RawPropVariantBlob {
        vt: u16,
        reserved1: u16,
        reserved2: u16,
        reserved3: u16,
        cb_size: u32,
        #[cfg(target_pointer_width = "64")]
        _pad: u32,
        p_blob_data: *mut u8,
    }

    struct EnumState {
        self_pid: u32,
        entries: HashMap<u32, String>,
    }

    unsafe extern "system" fn enum_window_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        if !IsWindowVisible(hwnd).as_bool() {
            return BOOL(1);
        }
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return BOOL(1);
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let state = &mut *(lparam.0 as *mut EnumState);
        if pid == 0 || pid == state.self_pid {
            return BOOL(1);
        }

        let mut buf = vec![0u16; (len as usize) + 1];
        let copied = GetWindowTextW(hwnd, &mut buf);
        if copied > 0 {
            let title = String::from_utf16_lossy(&buf[..copied as usize])
                .trim()
                .to_string();
            if !title.is_empty() {
                state.entries.entry(pid).or_insert(title);
            }
        }
        BOOL(1)
    }

    pub fn list_windows_targets() -> Vec<AudioTarget> {
        let self_pid = std::process::id();
        let mut state = EnumState {
            self_pid,
            entries: HashMap::new(),
        };

        unsafe {
            let _ = EnumWindows(
                Some(enum_window_proc),
                LPARAM((&mut state as *mut EnumState) as isize),
            );
        }

        let mut sys = System::new();
        sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::new());

        let mut list: Vec<AudioTarget> = state
            .entries
            .into_iter()
            .map(|(pid, window_title)| {
                let proc_name = sys
                    .process(sysinfo::Pid::from_u32(pid))
                    .map(|p| p.name().to_string_lossy().to_string())
                    .unwrap_or_else(|| format!("pid-{pid}"));
                AudioTarget {
                    pid,
                    process_name: proc_name,
                    window_title,
                    pipewire_node_id: None,
                    is_system_default: false,
                }
            })
            .collect();

        list.sort_by(|a, b| {
            a.window_title
                .to_ascii_lowercase()
                .cmp(&b.window_title.to_ascii_lowercase())
        });
        list
    }

    #[implement(IActivateAudioInterfaceCompletionHandler, IAgileObject)]
    struct ActivationHandler {
        event: HANDLE,
    }

    impl IAgileObject_Impl for ActivationHandler_Impl {}

    impl IActivateAudioInterfaceCompletionHandler_Impl for ActivationHandler_Impl {
        fn ActivateCompleted(
            &self,
            _activateoperation: Option<&IActivateAudioInterfaceAsyncOperation>,
        ) -> windows::core::Result<()> {
            unsafe {
                let _ = SetEvent(self.event);
            }
            Ok(())
        }
    }

    pub fn run_capture_loop(mode: IsolatedAudioMode, metrics: Arc<SharedMetrics>) {
        if let Err(err) = run_wasapi_process_loopback(mode, &metrics) {
            metrics.set_error(err);
        }
        metrics.running.store(false, Ordering::SeqCst);
    }

    fn run_wasapi_process_loopback(
        mode: IsolatedAudioMode,
        metrics: &Arc<SharedMetrics>,
    ) -> Result<(), String> {
        unsafe {
            let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
            if hr.is_err() {
                return Err(format!("Falha em CoInitializeEx: {hr:?}"));
            }
        }

        struct ComGuard;
        impl Drop for ComGuard {
            fn drop(&mut self) {
                unsafe {
                    CoUninitialize();
                }
            }
        }
        let _com_guard = ComGuard;

        let (target_pid, loopback_mode) = match mode {
            IsolatedAudioMode::IncludeProcessTree { pid, .. } => (
                pid,
                PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
            ),
            IsolatedAudioMode::ExcludeSelf => (
                std::process::id(),
                PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
            ),
        };

        let mut activation_params = AUDIOCLIENT_ACTIVATION_PARAMS {
            ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
            Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
                ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                    TargetProcessId: target_pid,
                    ProcessLoopbackMode: loopback_mode,
                },
            },
        };

        let raw_prop = RawPropVariantBlob {
            vt: VT_BLOB_TAG,
            reserved1: 0,
            reserved2: 0,
            reserved3: 0,
            cb_size: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
            #[cfg(target_pointer_width = "64")]
            _pad: 0,
            p_blob_data: (&mut activation_params as *mut AUDIOCLIENT_ACTIVATION_PARAMS) as *mut u8,
        };

        let activate_event = unsafe {
            CreateEventW(None, false, false, PCWSTR::null())
                .map_err(|e| format!("Falha ao criar evento WASAPI: {e}"))?
        };

        let handler: IActivateAudioInterfaceCompletionHandler =
            ActivationHandler { event: activate_event }.into();

        let operation = unsafe {
            ActivateAudioInterfaceAsync(
                VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
                &IAudioClient::IID,
                Some((&raw_prop as *const RawPropVariantBlob).cast()),
                &handler,
            )
            .map_err(|e| {
                let _ = CloseHandle(activate_event);
                format!(
                    "WASAPI Process Loopback indisponível (requer Windows 10 20348+ / Windows 11): {e}"
                )
            })?
        };

        unsafe {
            let _ = WaitForSingleObject(activate_event, 5_000);
            let _ = CloseHandle(activate_event);
        }

        let mut activate_hr = windows::core::HRESULT(0);
        let mut activated_iface = None;
        unsafe {
            operation
                .GetActivateResult(&mut activate_hr, &mut activated_iface)
                .map_err(|e| format!("Falha ao obter resultado do WASAPI: {e}"))?;
        }
        if activate_hr.is_err() {
            return Err(format!("ActivateAudioInterfaceAsync retornou {activate_hr:?}"));
        }

        let audio_client: IAudioClient = activated_iface
            .ok_or_else(|| "IAudioClient nulo retornado pelo WASAPI.".to_string())?
            .cast()
            .map_err(|e| format!("Falha no cast para IAudioClient: {e}"))?;

        let bits_per_sample: u16 = 32;
        let block_align = CAPTURE_CHANNELS * (bits_per_sample / 8);
        let format = WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_IEEE_FLOAT,
            nChannels: CAPTURE_CHANNELS,
            nSamplesPerSec: CAPTURE_SAMPLE_RATE,
            nAvgBytesPerSec: CAPTURE_SAMPLE_RATE * u32::from(block_align),
            nBlockAlign: block_align,
            wBitsPerSample: bits_per_sample,
            cbSize: 0,
        };

        let stream_flags = AUDCLNT_STREAMFLAGS_LOOPBACK
            | AUDCLNT_STREAMFLAGS_EVENTCALLBACK
            | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
            | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;

        let sample_event = unsafe {
            CreateEventW(None, false, false, PCWSTR::null())
                .map_err(|e| format!("Falha ao criar evento de captura WASAPI: {e}"))?
        };

        unsafe {
            audio_client
                .Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    stream_flags,
                    200_000, // 20 ms em unidades de 100ns (baixa latência)
                    0,
                    &format,
                    None,
                )
                .map_err(|e| {
                    let _ = CloseHandle(sample_event);
                    format!("Falha ao inicializar IAudioClient: {e}")
                })?;

            audio_client.SetEventHandle(sample_event).map_err(|e| {
                let _ = CloseHandle(sample_event);
                format!("Falha em SetEventHandle: {e}")
            })?;
        }

        let capture_client: IAudioCaptureClient = unsafe {
            audio_client.GetService().map_err(|e| {
                let _ = CloseHandle(sample_event);
                format!("Falha ao obter IAudioCaptureClient: {e}")
            })?
        };

        unsafe {
            audio_client.Start().map_err(|e| {
                let _ = CloseHandle(sample_event);
                format!("Falha ao iniciar captura WASAPI: {e}")
            })?;
        }

        while metrics.running.load(Ordering::Relaxed) {
            unsafe {
                let _ = WaitForSingleObject(sample_event, 50);
            }

            loop {
                let packet_frames = match unsafe { capture_client.GetNextPacketSize() } {
                    Ok(n) if n > 0 => n,
                    _ => break,
                };

                let mut data_ptr: *mut u8 = std::ptr::null_mut();
                let mut num_frames: u32 = 0;
                let mut flags: u32 = 0;

                if unsafe {
                    capture_client.GetBuffer(&mut data_ptr, &mut num_frames, &mut flags, None, None)
                }
                .is_err()
                {
                    break;
                }

                let sample_count = (num_frames as usize) * usize::from(CAPTURE_CHANNELS);
                if !data_ptr.is_null() && sample_count > 0 && (flags & 0x2) == 0 {
                    // AUDCLIENT_BUFFERFLAGS_SILENT = 0x2
                    let slice = unsafe {
                        std::slice::from_raw_parts(data_ptr as *const c_void as *const f32, sample_count)
                    };
                    metrics.record_block(slice);
                } else {
                    metrics
                        .captured_frames
                        .fetch_add(u64::from(packet_frames), Ordering::Relaxed);
                    metrics.peak_bits.store(0.0_f32.to_bits(), Ordering::Relaxed);
                }

                let _ = unsafe { capture_client.ReleaseBuffer(num_frames) };
            }
        }

        unsafe {
            let _ = audio_client.Stop();
            let _ = CloseHandle(sample_event);
        }

        Ok(())
    }
}

#[cfg(target_os = "linux")]
mod linux_impl {
    use super::*;
    use std::io::Read;
    use std::process::{Command, Stdio};

    pub fn list_pipewire_targets() -> Vec<AudioTarget> {
        let self_pid = std::process::id();
        if let Ok(out) = Command::new("pw-dump").output() {
            if out.status.success() {
                if let Ok(raw) = String::from_utf8(out.stdout) {
                    let parsed = parse_pw_dump_audio_targets(&raw, self_pid);
                    if !parsed.is_empty() {
                        return parsed;
                    }
                }
            }
        }
        Vec::new()
    }

    pub fn run_capture_loop(mode: IsolatedAudioMode, metrics: Arc<SharedMetrics>) {
        let mut cmd = Command::new("pw-record");
        cmd.args([
            "--format",
            "f32",
            "--rate",
            "48000",
            "--channels",
            "2",
            "--raw",
        ]);

        if let IsolatedAudioMode::IncludeProcessTree {
            pipewire_node_id: Some(node_id),
            ..
        } = mode
        {
            cmd.args(["--target", &node_id.to_string()]);
        } else {
            // Captura do monitor de saída padrão no PipeWire
            cmd.args(["-P", "{ stream.capture.sink=true }"]);
        }

        cmd.arg("-")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                metrics.set_error(format!(
                    "PipeWire `pw-record` não encontrado (instale pipewire-utils): {e}"
                ));
                metrics.running.store(false, Ordering::SeqCst);
                return;
            }
        };

        let Some(mut stdout) = child.stdout.take() else {
            let _ = child.kill();
            metrics.set_error("Falha ao abrir stdout do pw-record.".to_string());
            metrics.running.store(false, Ordering::SeqCst);
            return;
        };

        // 480 frames * 2 canais * 4 bytes (f32) = 3840 bytes (~10 ms)
        let mut raw_buf = [0u8; 3840];
        let mut f32_buf = [0.0_f32; 960];

        while metrics.running.load(Ordering::Relaxed) {
            match stdout.read(&mut raw_buf) {
                Ok(0) => break,
                Ok(n) => {
                    let count = n / 4;
                    for (i, chunk) in raw_buf[..count * 4].as_chunks::<4>().0.iter().enumerate() {
                        f32_buf[i] = f32::from_le_bytes(*chunk);
                    }
                    metrics.record_block(&f32_buf[..count]);
                }
                Err(_) => break,
            }
        }

        let _ = child.kill();
        let _ = child.wait();
        metrics.running.store(false, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pipewire_streams_and_excludes_self() {
        let sample = r#"[
          {
            "id": 42,
            "info": {
              "props": {
                "media.class": "Stream/Output/Audio",
                "application.name": "Counter-Strike 2",
                "media.name": "Audio Stream",
                "application.process.id": 1234,
                "application.process.binary": "cs2"
              }
            }
          },
          {
            "id": 43,
            "info": {
              "props": {
                "media.class": "Stream/Output/Audio",
                "application.name": "Balacopapo",
                "application.process.id": 9999,
                "application.process.binary": "balacopapo-desktop"
              }
            }
          },
          {
            "id": 44,
            "info": {
              "props": {
                "media.class": "Audio/Sink",
                "application.name": "Speakers"
              }
            }
          }
        ]"#;

        let targets = parse_pw_dump_audio_targets(sample, 9999);
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].pid, 1234);
        assert_eq!(targets[0].pipewire_node_id, Some(42));
        assert_eq!(targets[0].process_name, "cs2");
        assert!(targets[0].window_title.contains("Counter-Strike 2"));
    }

    #[test]
    fn computes_pcm_peak_clamped_safely() {
        assert!((compute_pcm_f32_peak(&[0.0, -0.5, 0.25]) - 0.5).abs() < 1e-6);
        assert!((compute_pcm_f32_peak(&[f32::NAN, 1.8, -0.2]) - 1.0).abs() < 1e-6);
    }
}
