//! Keito Notch for Windows — native side.
//!
//! The app logic (Keito / Jira / Google calls, durations, targets) lives in the TypeScript frontend.
//! This side only does what a web view can't:
//! - place the notch window: edge, island or next to the tray, on the chosen display (placement.rs)
//! - probes for "Active display", full-screen tuck-away and dragging (placement.rs, platform.rs)
//! - the tray icon, the global hotkey (Ctrl+Alt+T) and single-instance handling
//! - secrets in Windows Credential Manager (`keyring`)
//! - the one-shot 127.0.0.1 listener for Google sign-in (OAuth loopback + PKCE)
//! - seconds since the last keyboard/mouse input (idle reminder)

mod oauth;
mod placement;
mod platform;

use placement::PlacementState;

use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const SERVICE: &str = "KeitoNotch";
const TRAY_ID: &str = "main";
/// Only these entries may be read or written in Credential Manager.
const SECRET_KEYS: &[&str] = &["keito.apiKey", "jira.token", "google.clientSecret", "google.refreshToken"];

// MARK: Secrets

fn entry(key: &str) -> Result<keyring::Entry, String> {
    if !SECRET_KEYS.contains(&key) {
        return Err(format!("unknown secret {key}"));
    }
    keyring::Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Empty or missing value deletes the entry.
#[tauri::command]
fn secret_set(key: String, value: Option<String>) -> Result<(), String> {
    let e = entry(&key)?;
    match value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty()) {
        Some(v) => e.set_password(&v).map_err(|e| e.to_string()),
        None => match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.to_string()),
        },
    }
}

// MARK: Windows

/// Shows the notch without taking focus away from what you're doing.
#[tauri::command]
fn show_notch(app: AppHandle) -> Result<(), String> {
    let win = app.get_webview_window("notch").ok_or("no notch window")?;
    platform::show_without_focus(&win);
    Ok(())
}

/// Hides the notch (tray style while closed, or tucked away next to a full-screen app).
#[tauri::command]
fn hide_notch(app: AppHandle) -> Result<(), String> {
    let win = app.get_webview_window("notch").ok_or("no notch window")?;
    win.hide().map_err(|e| e.to_string())
}

/// Toast: bottom centre of the notch's display, above the taskbar. Never takes focus,
/// so an open day view stays open.
#[tauri::command]
fn show_toast(app: AppHandle, state: tauri::State<'_, PlacementState>, width: f64, height: f64) -> Result<(), String> {
    let win = app.get_webview_window("toast").ok_or("no toast window")?;
    let r = match placement::toast_rect(&state, width, height) {
        Some(r) => r,
        None => {
            let m = win.primary_monitor().map_err(|e| e.to_string())?.ok_or("no monitor")?;
            let s = m.scale_factor();
            let a = m.work_area();
            let (w, h) = ((width * s) as i32, (height * s) as i32);
            placement::Rect { x: a.position.x + (a.size.width as i32 - w) / 2, y: a.position.y + a.size.height as i32 - h - (16.0 * s) as i32, w, h }
        }
    };
    win.set_size(PhysicalSize::new(r.w as u32, r.h as u32)).map_err(|e| e.to_string())?;
    win.set_position(PhysicalPosition::new(r.x, r.y)).map_err(|e| e.to_string())?;
    platform::show_without_focus(&win);
    Ok(())
}

#[tauri::command]
fn hide_toast(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("toast") {
        w.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn open_settings(app: AppHandle, section: Option<String>) -> Result<(), String> {
    open_settings_window(&app, section.as_deref())
}

fn open_settings_window(app: &AppHandle, section: Option<&str>) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("settings") {
        if let Some(s) = section {
            let _ = w.emit("settings-section", s);
        }
        w.unminimize().ok();
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let url = format!("index.html?view=settings&section={}", section.unwrap_or("keito"));
    WebviewWindowBuilder::new(app, "settings", WebviewUrl::App(url.into()))
        .title("Keito Notch Settings")
        .inner_size(760.0, 580.0)
        .min_inner_size(620.0, 460.0)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Tray tooltip, e.g. "Keito Notch · 1:23 · Project".
#[tauri::command]
fn set_tray_tooltip(app: AppHandle, text: String) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_tooltip(Some(text)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn idle_seconds() -> u64 {
    platform::idle_seconds()
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

/// Opens (or closes) the day view and gives the notch keyboard focus.
fn toggle_day(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("notch") {
        let _ = w.emit("toggle-day", ());
    }
}

fn emit_notch(app: &AppHandle, event: &str) {
    if let Some(w) = app.get_webview_window("notch") {
        let _ = w.emit(event, ());
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let day = MenuItem::with_id(app, "day", "Day view\tCtrl+Alt+T", true, None::<&str>)?;
    let new = MenuItem::with_id(app, "new", "New entry", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Keito Notch", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&day, &new, &settings, &sep, &quit])?;

    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Keito Notch")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "day" => toggle_day(app),
            "new" => emit_notch(app, "new-entry"),
            "settings" => {
                let _ = open_settings_window(app, None);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                toggle_day(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A second launch (e.g. from the Start menu) just opens the day view of the running one.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| toggle_day(app)))
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_day(app);
                    }
                })
                .build(),
        )
        .manage(oauth::Loopback(Mutex::new(None)))
        .manage(PlacementState(Mutex::new(Default::default())))
        .invoke_handler(tauri::generate_handler![
            secret_get,
            secret_set,
            placement::place_notch,
            placement::monitors,
            placement::screen_state,
            show_notch,
            hide_notch,
            show_toast,
            hide_toast,
            open_settings,
            set_tray_tooltip,
            idle_seconds,
            quit,
            oauth::oauth_listen,
            oauth::oauth_wait,
        ])
        .setup(|app| {
            build_tray(app.handle())?;
            // Another app may already own Ctrl+Alt+T; the tray icon still works then.
            if let Err(e) = app.global_shortcut().register("ctrl+alt+t") {
                eprintln!("Ctrl+Alt+T is taken: {e}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Keito Notch");
}
