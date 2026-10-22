//! Orca's system tray (main/tray/system-tray.ts): an icon on Windows and macOS with Open and Quit,
//! left-click to restore on Windows, and an attention dot while the window is hidden and an agent
//! finished or needs the user. Closing the window hides it to the tray only when the user turned on
//! "Minimize to Tray on Close" (Windows, as in Orca); otherwise closing quits and stops the daemons.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime, Window};

const TRAY_ID: &str = "main";
const TOOLTIP: &str = "Zomfy";

static MINIMIZE_TO_TRAY: AtomicBool = AtomicBool::new(false);

struct TrayState {
    base: Option<Image<'static>>,
    attention: bool,
    waiting: u32,
}

static STATE: Mutex<TrayState> = Mutex::new(TrayState { base: None, attention: false, waiting: 0 });

fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Orca's tray-attention-icon: the app icon with an amber dot in the lower-right corner.
fn with_dot(base: &Image<'_>) -> Image<'static> {
    let (w, h) = (base.width(), base.height());
    let mut rgba = base.rgba().to_vec();
    let r = (w.min(h) as f32) * 0.22;
    let (cx, cy) = (w as f32 - r - 0.5, h as f32 - r - 0.5);
    for y in 0..h {
        for x in 0..w {
            let d = ((x as f32 - cx).powi(2) + (y as f32 - cy).powi(2)).sqrt();
            if d <= r {
                let i = ((y * w + x) * 4) as usize;
                rgba[i..i + 4].copy_from_slice(&[0xF5, 0x9E, 0x0B, 0xFF]);
            }
        }
    }
    Image::new_owned(rgba, w, h)
}

fn menu<R: Runtime>(app: &AppHandle<R>, waiting: u32) -> tauri::Result<Menu<R>> {
    let open = MenuItem::with_id(app, "open", "Open Zomfy", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    if waiting == 0 {
        return Menu::with_items(app, &[&open, &sep, &quit]);
    }
    let label = if waiting == 1 { "1 agent needs you".to_string() } else { format!("{waiting} agents need you") };
    let jump = MenuItem::with_id(app, "needs-you", label, true, None::<&str>)?;
    Menu::with_items(app, &[&open, &jump, &sep, &quit])
}

fn refresh<R: Runtime>(app: &AppHandle<R>) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    let state = STATE.lock().unwrap();
    if let Some(base) = &state.base {
        let _ = tray.set_icon(Some(if state.attention { with_dot(base) } else { base.clone() }));
    }
    let tooltip = match state.waiting {
        0 if state.attention => format!("{TOOLTIP} - activity waiting"),
        0 => TOOLTIP.to_string(),
        1 => format!("{TOOLTIP} - 1 agent needs you"),
        n => format!("{TOOLTIP} - {n} agents need you"),
    };
    let _ = tray.set_tooltip(Some(tooltip));
    if let Ok(m) = menu(app, state.waiting) {
        let _ = tray.set_menu(Some(m));
    }
}

/// No-op on Linux, as in Orca.
pub fn create<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Option<TrayIcon<R>>> {
    if !cfg!(any(windows, target_os = "macos")) {
        return Ok(None);
    }
    let Some(icon) = app.default_window_icon().cloned() else { return Ok(None) };
    STATE.lock().unwrap().base = Some(icon.clone().to_owned());
    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip(TOOLTIP)
        .menu(&menu(app, 0)?)
        // Windows restores on left-click; macOS opens the menu.
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "needs-you" => {
                show_main(app);
                let _ = app.emit("tray-jump-needs-you", ());
            }
            // RunEvent::Exit stops the daemons, as quitting from the window does.
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if cfg!(windows)
                && let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(Some(tray))
}

/// Attention lights while the window is hidden; `waiting` is how many agents need the user.
pub fn set_attention<R: Runtime>(app: &AppHandle<R>, attention: bool, waiting: u32) {
    {
        let mut state = STATE.lock().unwrap();
        if state.attention == attention && state.waiting == waiting {
            return;
        }
        state.attention = attention;
        state.waiting = waiting;
    }
    refresh(app);
}

pub fn clear_attention<R: Runtime>(app: &AppHandle<R>) {
    let waiting = STATE.lock().unwrap().waiting;
    set_attention(app, false, waiting);
}

pub fn set_minimize_to_tray(enabled: bool) {
    MINIMIZE_TO_TRAY.store(enabled, Ordering::Relaxed);
}

/// Windows minimize-to-tray: hides instead of closing; true when it hid.
pub fn hide_on_close<R: Runtime>(window: &Window<R>) -> bool {
    if !cfg!(windows) || !MINIMIZE_TO_TRAY.load(Ordering::Relaxed) || window.app_handle().tray_by_id(TRAY_ID).is_none() {
        return false;
    }
    let _ = window.hide();
    // The window tells the user once that closing only hid it.
    let _ = window.emit("tray-minimized", ());
    true
}
