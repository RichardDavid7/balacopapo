//! Native Node-API (napi-rs) addon for Windows WASAPI Process Loopback audio capture.
//!
//! Captures 48 kHz stereo `f32` little-endian PCM from a target process tree
//! (`PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE`) or from the entire system
//! excluding the current process (`PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE`),
//! streaming chunks over a local authenticated HTTP loopback server (`127.0.0.1:0`).

use napi_derive::napi;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::JoinHandle;

#[cfg(target_os = "windows")]
use std::io::{Read, Write};
#[cfg(target_os = "windows")]
use std::net::TcpListener;
#[cfg(target_os = "windows")]
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const CAPTURE_SAMPLE_RATE: u32 = 48_000;
pub const CAPTURE_CHANNELS: u16 = 2;
const MAX_QUEUED_BLOCKS: usize = 24;

/// Computes the normalized absolute peak `[0.0, 1.0]` of an `f32` PCM sample slice.
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

/// Resolves the `(pid, include_process_tree)` pair for WASAPI Process Loopback.
///
/// When `!exclude_self && target_pid > 0`, includes only `target_pid` and its child processes.
/// Otherwise, excludes `self_pid` from system-wide audio capture.
pub fn resolve_loopback_target(target_pid: u32, exclude_self: bool, self_pid: u32) -> (u32, bool) {
    if !exclude_self && target_pid > 0 {
        (target_pid, true)
    } else {
        (self_pid, false)
    }
}

struct SharedMetrics {
    running: AtomicBool,
    peak_bits: AtomicU32,
    captured_frames: AtomicU64,
    last_error: Mutex<Option<String>>,
    pcm_queue: Mutex<VecDeque<Vec<u8>>>,
}

impl SharedMetrics {
    fn new() -> Self {
        Self {
            running: AtomicBool::new(true),
            peak_bits: AtomicU32::new(0.0_f32.to_bits()),
            captured_frames: AtomicU64::new(0),
            last_error: Mutex::new(None),
            pcm_queue: Mutex::new(VecDeque::with_capacity(32)),
        }
    }

    #[cfg(any(target_os = "windows", test))]
    fn set_error(&self, msg: String) {
        if let Ok(mut guard) = self.last_error.lock() {
            *guard = Some(msg);
        }
    }

    #[cfg(test)]
    fn last_error(&self) -> Option<String> {
        self.last_error.lock().ok().and_then(|g| g.clone())
    }

    #[cfg(any(target_os = "windows", test))]
    fn record_block(&self, samples: &[f32]) {
        let peak = compute_pcm_f32_peak(samples);
        self.peak_bits.store(peak.to_bits(), Ordering::Relaxed);
        let frames = (samples.len() / usize::from(CAPTURE_CHANNELS)) as u64;
        self.captured_frames.fetch_add(frames, Ordering::Relaxed);

        if let Ok(mut q) = self.pcm_queue.lock() {
            if q.len() >= MAX_QUEUED_BLOCKS {
                q.pop_front();
            }
            let mut bytes = Vec::with_capacity(samples.len() * 4);
            for &s in samples {
                bytes.extend_from_slice(&s.to_le_bytes());
            }
            q.push_back(bytes);
        }
    }
}

struct ActiveCapture {
    metrics: Arc<SharedMetrics>,
    worker: Option<JoinHandle<()>>,
    server_worker: Option<JoinHandle<()>>,
}

static ACTIVE_CAPTURE: OnceLock<Mutex<Option<ActiveCapture>>> = OnceLock::new();

fn active_capture_slot() -> &'static Mutex<Option<ActiveCapture>> {
    ACTIVE_CAPTURE.get_or_init(|| Mutex::new(None))
}

#[cfg(target_os = "windows")]
static TOKEN_COUNTER: AtomicU64 = AtomicU64::new(1);

#[cfg(target_os = "windows")]
fn generate_audio_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = u128::from(TOKEN_COUNTER.fetch_add(1, Ordering::Relaxed));
    let mixed = nanos
        ^ u128::from(std::process::id()).wrapping_mul(0x517c_c1b7_2722_0a95)
        ^ seq.wrapping_mul(0x9e37_79b9_7f4a_7c15);
    format!("{mixed:032x}")
}

#[cfg(target_os = "windows")]
fn run_audio_loopback_server(
    listener: TcpListener,
    expected_token: &str,
    metrics: &Arc<SharedMetrics>,
) {
    let expected_query = format!("token={expected_token}");
    while metrics.running.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((mut stream, addr)) => {
                if !addr.ip().is_loopback() {
                    continue;
                }
                let _ = stream.set_nonblocking(false);
                let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
                let mut req_buf = [0u8; 1024];
                let Ok(read_n) = stream.read(&mut req_buf) else {
                    continue;
                };
                let first_line = String::from_utf8_lossy(&req_buf[..read_n])
                    .lines()
                    .next()
                    .unwrap_or_default()
                    .to_string();
                if !first_line.contains(&expected_query) {
                    let _ =
                        stream.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
                    continue;
                }
                let header = "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nTransfer-Encoding: chunked\r\n\r\n";
                if stream.write_all(header.as_bytes()).is_err() {
                    continue;
                }
                while metrics.running.load(Ordering::Relaxed) {
                    let chunk = metrics.pcm_queue.lock().ok().and_then(|mut q| q.pop_front());
                    let Some(data) = chunk else {
                        std::thread::sleep(Duration::from_millis(4));
                        continue;
                    };
                    let prefix = format!("{:x}\r\n", data.len());
                    if stream.write_all(prefix.as_bytes()).is_err()
                        || stream.write_all(&data).is_err()
                        || stream.write_all(b"\r\n").is_err()
                    {
                        break;
                    }
                }
                let _ = stream.write_all(b"0\r\n\r\n");
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(12));
            }
            Err(_) => break,
        }
    }
}

/// Returns `true` on Windows where WASAPI Process Loopback is supported, `false` elsewhere.
#[napi]
pub fn is_supported() -> bool {
    cfg!(target_os = "windows")
}

/// Resolves the owning process ID (PID) from a Win32 `HWND` numeric handle.
#[napi]
pub fn resolve_pid_from_hwnd(hwnd_val: i64) -> Option<u32> {
    #[cfg(target_os = "windows")]
    {
        win_impl::resolve_pid_from_hwnd(hwnd_val)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = hwnd_val;
        None
    }
}

/// Starts WASAPI Process Loopback capture and an authenticated local HTTP chunked PCM server.
///
/// Returns the loopback URL (`http://127.0.0.1:<port>/audio?token=<token>`).
#[napi]
pub fn start_process_loopback(target_pid: u32, exclude_self: bool) -> napi::Result<String> {
    #[cfg(target_os = "windows")]
    {
        stop_process_loopback();

        let (resolved_pid, include_tree) =
            resolve_loopback_target(target_pid, exclude_self, std::process::id());

        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| {
            napi::Error::from_reason(format!("Failed to bind local audio loopback server: {e}"))
        })?;
        let port = listener
            .local_addr()
            .map_err(|e| {
                napi::Error::from_reason(format!("Failed to query loopback server port: {e}"))
            })?
            .port();
        let _ = listener.set_nonblocking(true);
        let token = generate_audio_token();
        let loopback_url = format!("http://127.0.0.1:{port}/audio?token={token}");

        let metrics = Arc::new(SharedMetrics::new());
        let worker_metrics = Arc::clone(&metrics);
        let worker = std::thread::Builder::new()
            .name("bp-wasapi-loopback".to_string())
            .spawn(move || {
                win_impl::run_capture_loop(resolved_pid, include_tree, worker_metrics);
            })
            .map_err(|e| {
                napi::Error::from_reason(format!("Failed to spawn WASAPI capture thread: {e}"))
            })?;

        let srv_metrics = Arc::clone(&metrics);
        let server_worker = std::thread::Builder::new()
            .name("bp-audio-loopback-http".to_string())
            .spawn(move || run_audio_loopback_server(listener, &token, &srv_metrics))
            .map_err(|e| {
                metrics.running.store(false, Ordering::SeqCst);
                napi::Error::from_reason(format!(
                    "Failed to spawn audio loopback HTTP server thread: {e}"
                ))
            })?;

        if let Ok(mut guard) = active_capture_slot().lock() {
            *guard = Some(ActiveCapture {
                metrics,
                worker: Some(worker),
                server_worker: Some(server_worker),
            });
        }

        Ok(loopback_url)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (target_pid, exclude_self);
        Err(napi::Error::from_reason(
            "WASAPI Process Loopback is only supported on Windows",
        ))
    }
}

/// Stops any active WASAPI Process Loopback capture and closes the loopback HTTP server cleanly.
#[napi]
pub fn stop_process_loopback() {
    let taken = active_capture_slot().lock().ok().and_then(|mut g| g.take());
    if let Some(mut cap) = taken {
        cap.metrics.running.store(false, Ordering::SeqCst);
        if let Some(handle) = cap.worker.take() {
            let _ = handle.join();
        }
        if let Some(handle) = cap.server_worker.take() {
            let _ = handle.join();
        }
    }
}

#[cfg(target_os = "windows")]
mod win_impl {
    use super::*;
    use std::ffi::c_void;
    use windows::core::{implement, Interface, PCWSTR};
    use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND};
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
    use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

    /// Standard Win32 (`mmreg.h`): IEEE 32-bit float PCM.
    const WAVE_FORMAT_IEEE_FLOAT: u16 = 0x0003;
    /// Standard COM (`wtypes.h`): `VT_BLOB`.
    const VT_BLOB_TAG: u16 = 65;

    /// Exact ABI layout of `PROPVARIANT` holding a `VT_BLOB` on Windows x86_64 (24 bytes),
    /// avoiding private field names and avoiding `PropVariantClear` on stack memory.
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

    pub fn resolve_pid_from_hwnd(hwnd_val: i64) -> Option<u32> {
        if hwnd_val == 0 {
            return None;
        }
        let mut pid: u32 = 0;
        unsafe {
            GetWindowThreadProcessId(HWND(hwnd_val as isize as *mut c_void), Some(&mut pid));
        }
        if pid > 0 {
            Some(pid)
        } else {
            None
        }
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

    pub fn run_capture_loop(target_pid: u32, include_tree: bool, metrics: Arc<SharedMetrics>) {
        if let Err(err) = run_wasapi_process_loopback(target_pid, include_tree, &metrics) {
            metrics.set_error(err);
        }
        metrics.running.store(false, Ordering::SeqCst);
    }

    fn run_wasapi_process_loopback(
        target_pid: u32,
        include_tree: bool,
        metrics: &Arc<SharedMetrics>,
    ) -> Result<(), String> {
        unsafe {
            let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
            if hr.is_err() {
                return Err(format!("CoInitializeEx failed: {hr:?}"));
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

        let loopback_mode = if include_tree {
            PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
        } else {
            PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE
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
                .map_err(|e| format!("Failed to create WASAPI activation event: {e}"))?
        };

        let handler: IActivateAudioInterfaceCompletionHandler = ActivationHandler {
            event: activate_event,
        }
        .into();

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
                    "WASAPI Process Loopback unavailable (requires Windows 10 20348+ / Windows 11): {e}"
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
                .map_err(|e| format!("Failed to read WASAPI activation result: {e}"))?;
        }
        if activate_hr.is_err() {
            return Err(format!(
                "ActivateAudioInterfaceAsync returned {activate_hr:?}"
            ));
        }

        let audio_client: IAudioClient = activated_iface
            .ok_or_else(|| "WASAPI returned null IAudioClient.".to_string())?
            .cast()
            .map_err(|e| format!("Failed to cast to IAudioClient: {e}"))?;

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
                .map_err(|e| format!("Failed to create WASAPI sample event: {e}"))?
        };

        unsafe {
            audio_client
                .Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    stream_flags,
                    200_000, // 20 ms in 100ns units (low latency)
                    0,
                    &format,
                    None,
                )
                .map_err(|e| {
                    let _ = CloseHandle(sample_event);
                    format!("Failed to initialize IAudioClient: {e}")
                })?;

            audio_client.SetEventHandle(sample_event).map_err(|e| {
                let _ = CloseHandle(sample_event);
                format!("Failed in SetEventHandle: {e}")
            })?;
        }

        let capture_client: IAudioCaptureClient = unsafe {
            audio_client.GetService().map_err(|e| {
                let _ = CloseHandle(sample_event);
                format!("Failed to obtain IAudioCaptureClient: {e}")
            })?
        };

        unsafe {
            audio_client.Start().map_err(|e| {
                let _ = CloseHandle(sample_event);
                format!("Failed to start WASAPI capture: {e}")
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
                        std::slice::from_raw_parts(
                            data_ptr as *const c_void as *const f32,
                            sample_count,
                        )
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_pcm_peak_clamped_safely() {
        assert!((compute_pcm_f32_peak(&[]) - 0.0).abs() < 1e-6);
        assert!((compute_pcm_f32_peak(&[0.0, -0.5, 0.25]) - 0.5).abs() < 1e-6);
        assert!((compute_pcm_f32_peak(&[f32::NAN, 1.8, -0.2]) - 1.0).abs() < 1e-6);
        assert!((compute_pcm_f32_peak(&[f32::INFINITY, -0.75]) - 0.75).abs() < 1e-6);
    }

    #[test]
    fn records_pcm_blocks_and_caps_queue_length() {
        let metrics = SharedMetrics::new();
        // 4 stereo frames = 8 f32 samples = 32 bytes per block
        let block = [0.25_f32, -0.5, 0.1, -0.1, 0.0, 0.0, 0.5, -0.25];

        for _ in 0..30 {
            metrics.record_block(&block);
        }

        assert_eq!(metrics.captured_frames.load(Ordering::Relaxed), 30 * 4);
        assert!((f32::from_bits(metrics.peak_bits.load(Ordering::Relaxed)) - 0.5).abs() < 1e-6);

        let queue = metrics.pcm_queue.lock().expect("queue lock");
        assert_eq!(queue.len(), MAX_QUEUED_BLOCKS);
        assert_eq!(queue.front().map(Vec::len), Some(block.len() * 4));

        metrics.set_error("sample error".to_string());
        assert_eq!(metrics.last_error().as_deref(), Some("sample error"));
    }

    #[test]
    fn resolves_loopback_target_mode_correctly() {
        assert_eq!(resolve_loopback_target(4242, false, 1000), (4242, true));
        assert_eq!(resolve_loopback_target(4242, true, 1000), (1000, false));
        assert_eq!(resolve_loopback_target(0, false, 1000), (1000, false));
    }
}
