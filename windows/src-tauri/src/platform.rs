//! Windows specifics. Other platforms get harmless fallbacks so the app can be developed on a Mac.

use tauri::WebviewWindow;

/// Seconds since the last keyboard or mouse input anywhere in the session.
#[cfg(windows)]
pub fn idle_seconds() -> u64 {
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    // SAFETY: `info` is a valid, correctly sized LASTINPUTINFO.
    if unsafe { GetLastInputInfo(&mut info) } == 0 {
        return 0;
    }
    // Both are 32-bit tick counts; wrapping_sub handles the 49-day rollover.
    let now = unsafe { GetTickCount() };
    (now.wrapping_sub(info.dwTime) / 1000) as u64
}

#[cfg(not(windows))]
pub fn idle_seconds() -> u64 {
    0
}

/// Shows a window without activating it (SW_SHOWNOACTIVATE), so the app you're typing in keeps focus.
#[cfg(windows)]
pub fn show_without_focus(win: &WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};
    match win.hwnd() {
        // SAFETY: the handle belongs to a live window owned by this process.
        Ok(hwnd) => unsafe {
            ShowWindow(hwnd.0 as _, SW_SHOWNOACTIVATE);
        },
        Err(_) => {
            let _ = win.show();
        }
    }
}

#[cfg(not(windows))]
pub fn show_without_focus(win: &WebviewWindow) {
    let _ = win.show();
}

/// Moves and resizes a window in ONE step (physical pixels). Separate set_size + set_position calls let
/// Windows draw the frame in between: measured on hover, the island grew 228 px off-screen at its old
/// spot for ~4 ms before moving, and shrank at the wrong spot on leave — a visible jump.
#[cfg(windows)]
pub fn set_bounds(win: &WebviewWindow, r: crate::placement::Rect) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOZORDER};
    let hwnd = win.hwnd().map_err(|e| e.to_string())?;
    // SAFETY: the handle belongs to a live window owned by this process; plain geometry change.
    let ok = unsafe {
        SetWindowPos(hwnd.0 as _, std::ptr::null_mut(), r.x, r.y, r.w, r.h, SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_NOACTIVATE)
    };
    if ok == 0 {
        return Err("SetWindowPos failed".into());
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn set_bounds(win: &WebviewWindow, r: crate::placement::Rect) -> Result<(), String> {
    use tauri::{PhysicalPosition, PhysicalSize};
    win.set_position(PhysicalPosition::new(r.x, r.y)).map_err(|e| e.to_string())?;
    win.set_size(PhysicalSize::new(r.w as u32, r.h as u32)).map_err(|e| e.to_string())
}

/// A full-screen app (game, video, presentation) covers this monitor: the foreground window is at least as
/// large as the whole screen and isn't the desktop, the taskbar or one of our own windows.
#[cfg(windows)]
pub fn fullscreen_app_on(screen: crate::placement::Rect) -> bool {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::System::Threading::GetCurrentProcessId;
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId};
    if screen.w <= 0 {
        return false;
    }
    // SAFETY: plain Win32 queries on the foreground window handle; buffers are sized correctly.
    unsafe {
        let fg = GetForegroundWindow();
        if fg.is_null() {
            return false;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(fg, &mut pid);
        if pid == GetCurrentProcessId() {
            return false;
        }
        let mut class = [0u16; 64];
        let n = GetClassNameW(fg, class.as_mut_ptr(), class.len() as i32);
        let class = String::from_utf16_lossy(&class[..n.max(0) as usize]);
        if matches!(class.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd") {
            return false;
        }
        let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        if GetWindowRect(fg, &mut r) == 0 {
            return false;
        }
        r.left <= screen.x && r.top <= screen.y && r.right >= screen.x + screen.w && r.bottom >= screen.y + screen.h
    }
}

#[cfg(not(windows))]
pub fn fullscreen_app_on(_screen: crate::placement::Rect) -> bool {
    false
}
