//! Backend nativo Win32 (`WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE`).
//!
//! - Zero WebView, zero hook de DLL (anti-cheat safe) e zero foco roubado do jogo.
//! - Quando não há marcadores ativos, o timer de 60 Hz é desligado e a janela fica oculta (0% CPU).
//! - Quando o `stdin` fecha (processo pai encerrado), posta `WM_QUIT` imediatamente.

#![cfg(windows)]

use std::io::{self, BufRead};
use std::ptr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, SIZE, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, AC_SRC_ALPHA,
    AC_SRC_OVER, BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BLENDFUNCTION, DIB_RGB_COLORS,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::HiDpi::{
    SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW,
    GetSystemMetrics, KillTimer, PostMessageW, PostQuitMessage, RegisterClassW, SetTimer,
    SetWindowPos, ShowWindow, TranslateMessage, UpdateLayeredWindow, HWND_TOPMOST, MSG,
    SM_CXSCREEN, SM_CYSCREEN, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_SHOWWINDOW, SW_HIDE,
    SW_SHOWNA, ULW_ALPHA, WM_APP, WM_DESTROY, WM_TIMER, WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_POPUP,
};

use crate::protocol::{parse_command_line, MonitorRect, OverlayCommand, OverlayWorld};
use crate::renderer::{render_markers_rgba, rgba_to_bgra_into};

const WM_OVERLAY_WAKE: u32 = WM_APP + 1;
const WM_OVERLAY_EXIT: u32 = WM_APP + 2;
const TIMER_ID: usize = 1;
const FRAME_INTERVAL_MS: u32 = 16;

struct SharedState {
    world: OverlayWorld,
    started_at: Instant,
    timer_running: bool,
    window_visible: bool,
    pending_bounds_update: bool,
}

static SHARED: Mutex<Option<Arc<Mutex<SharedState>>>> = Mutex::new(None);

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn now_ms(started: Instant) -> u64 {
    started.elapsed().as_millis() as u64
}

pub fn run(demo_mode: bool) -> Result<(), String> {
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let screen_w = GetSystemMetrics(SM_CXSCREEN).max(640);
        let screen_h = GetSystemMetrics(SM_CYSCREEN).max(480);

        let shared = Arc::new(Mutex::new(SharedState {
            world: OverlayWorld::new(MonitorRect {
                x: 0,
                y: 0,
                width: screen_w,
                height: screen_h,
            }),
            started_at: Instant::now(),
            timer_running: false,
            window_visible: false,
            pending_bounds_update: false,
        }));

        if let Ok(mut guard) = SHARED.lock() {
            *guard = Some(shared.clone());
        }

        let hinstance = GetModuleHandleW(ptr::null());
        let class_name = to_wide("BalacopapoPointerOverlayClass");
        let wc = WNDCLASSW {
            style: 0,
            lpfnWndProc: Some(wnd_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: hinstance,
            hIcon: ptr::null_mut(),
            hCursor: ptr::null_mut(),
            hbrBackground: ptr::null_mut(),
            lpszMenuName: ptr::null(),
            lpszClassName: class_name.as_ptr(),
        };
        RegisterClassW(&wc);

        let ex_style = WS_EX_LAYERED
            | WS_EX_TRANSPARENT
            | WS_EX_TOPMOST
            | WS_EX_TOOLWINDOW
            | WS_EX_NOACTIVATE;

        let hwnd = CreateWindowExW(
            ex_style,
            class_name.as_ptr(),
            to_wide("Balacopapo Pointer Overlay").as_ptr(),
            WS_POPUP,
            0,
            0,
            screen_w,
            screen_h,
            ptr::null_mut(),
            ptr::null_mut(),
            hinstance,
            ptr::null(),
        );
        if hwnd.is_null() {
            return Err("Falha ao criar janela nativa Win32 do overlay.".to_string());
        }

        let hwnd_raw = hwnd as usize;
        if demo_mode {
            let shared_demo = shared.clone();
            std::thread::spawn(move || {
                let demo_points = [
                    (0.50_f32, 0.50_f32, "Centro", "#86EFAC"),
                    (0.35_f32, 0.35_f32, "Biel", "#38BDF8"),
                    (0.65_f32, 0.60_f32, "Richard", "#FDA4AF"),
                ];
                for (x, y, from, color) in demo_points {
                    if let Ok(mut st) = shared_demo.lock() {
                        let t = now_ms(st.started_at);
                        st.world.apply_command(
                            OverlayCommand::PointerPing {
                                x,
                                y,
                                from: from.to_string(),
                                color: color.to_string(),
                                ttl_ms: 2500,
                            },
                            t,
                        );
                    }
                    PostMessageW(hwnd_raw as HWND, WM_OVERLAY_WAKE, 0, 0);
                    std::thread::sleep(Duration::from_millis(900));
                }
                std::thread::sleep(Duration::from_millis(2800));
                PostMessageW(hwnd_raw as HWND, WM_OVERLAY_EXIT, 0, 0);
            });
        } else {
            let shared_in = shared.clone();
            std::thread::spawn(move || {
                let stdin = io::stdin();
                for line in stdin.lock().lines() {
                    let Ok(text) = line else {
                        break;
                    };
                    if let Some(cmd) = parse_command_line(&text) {
                        let is_state = matches!(cmd, OverlayCommand::OverlayState { .. });
                        if let Ok(mut st) = shared_in.lock() {
                            let t = now_ms(st.started_at);
                            if st.world.apply_command(cmd, t) {
                                if is_state {
                                    st.pending_bounds_update = true;
                                }
                                drop(st);
                                PostMessageW(hwnd_raw as HWND, WM_OVERLAY_WAKE, 0, 0);
                            }
                        }
                    }
                }
                // `stdin` fechado (Electron encerrou ou caiu) -> fecha o overlay imediatamente
                PostMessageW(hwnd_raw as HWND, WM_OVERLAY_EXIT, 0, 0);
            });
        }

        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        let _ = DestroyWindow(hwnd);
    }
    Ok(())
}

unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_OVERLAY_WAKE | WM_TIMER => {
            repaint_overlay(hwnd);
            0
        }
        WM_OVERLAY_EXIT => {
            KillTimer(hwnd, TIMER_ID);
            PostQuitMessage(0);
            0
        }
        WM_DESTROY => {
            KillTimer(hwnd, TIMER_ID);
            PostQuitMessage(0);
            0
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

unsafe fn repaint_overlay(hwnd: HWND) {
    let shared = {
        let Ok(guard) = SHARED.lock() else { return };
        match guard.as_ref() {
            Some(s) => s.clone(),
            None => return,
        }
    };

    let (bounds, scale, markers, t_now, should_show, bounds_changed) = {
        let Ok(mut st) = shared.lock() else { return };
        let t = now_ms(st.started_at);
        st.world.prune_expired(t);

        let has_markers = st.world.enabled && !st.world.markers.is_empty();
        if has_markers && !st.timer_running {
            SetTimer(hwnd, TIMER_ID, FRAME_INTERVAL_MS, None);
            st.timer_running = true;
        } else if !has_markers && st.timer_running {
            KillTimer(hwnd, TIMER_ID);
            st.timer_running = false;
        }

        let bc = st.pending_bounds_update;
        st.pending_bounds_update = false;

        if !has_markers {
            if st.window_visible {
                ShowWindow(hwnd, SW_HIDE);
                st.window_visible = false;
            }
            return;
        }

        let need_show = !st.window_visible;
        st.window_visible = true;
        (
            st.world.bounds,
            st.world.scale_factor,
            st.world.markers.clone(),
            t,
            need_show,
            bc,
        )
    };

    if bounds.width <= 0 || bounds.height <= 0 {
        return;
    }

    if bounds_changed || should_show {
        SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            bounds.x,
            bounds.y,
            bounds.width,
            bounds.height,
            SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_SHOWWINDOW,
        );
        ShowWindow(hwnd, SW_SHOWNA);
    }

    let Some(pixmap) = render_markers_rgba(
        bounds.width as u32,
        bounds.height as u32,
        scale,
        &markers,
        t_now,
    ) else {
        return;
    };

    blit_pixmap_layered(hwnd, bounds, pixmap.data());
}

unsafe fn blit_pixmap_layered(hwnd: HWND, bounds: MonitorRect, rgba: &[u8]) {
    let mem_dc = CreateCompatibleDC(ptr::null_mut());
    if mem_dc.is_null() {
        return;
    }

    let bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: bounds.width,
            biHeight: -bounds.height, // top-down DIB
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            biSizeImage: 0,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        },
        bmiColors: [std::mem::zeroed()],
    };

    let mut bits_ptr: *mut core::ffi::c_void = ptr::null_mut();
    let hbitmap = CreateDIBSection(mem_dc, &bmi, DIB_RGB_COLORS, &mut bits_ptr, ptr::null_mut(), 0);
    if hbitmap.is_null() || bits_ptr.is_null() {
        DeleteDC(mem_dc);
        return;
    }

    let pixel_bytes = (bounds.width as usize) * (bounds.height as usize) * 4;
    let dst = std::slice::from_raw_parts_mut(bits_ptr as *mut u8, pixel_bytes);
    rgba_to_bgra_into(rgba, dst);

    let old_obj = SelectObject(mem_dc, hbitmap);
    let dst_pt = POINT {
        x: bounds.x,
        y: bounds.y,
    };
    let size = SIZE {
        cx: bounds.width,
        cy: bounds.height,
    };
    let src_pt = POINT { x: 0, y: 0 };
    let blend = BLENDFUNCTION {
        BlendOp: AC_SRC_OVER as u8,
        BlendFlags: 0,
        SourceConstantAlpha: 255,
        AlphaFormat: AC_SRC_ALPHA as u8,
    };

    UpdateLayeredWindow(
        hwnd,
        ptr::null_mut(),
        &dst_pt,
        &size,
        mem_dc,
        &src_pt,
        0 as COLORREF,
        &blend,
        ULW_ALPHA,
    );

    SelectObject(mem_dc, old_obj);
    DeleteObject(hbitmap);
    DeleteDC(mem_dc);
}
