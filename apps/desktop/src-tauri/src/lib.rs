use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::window::Color;
use tauri::Manager;

mod daemon_process;
mod local_daemon;
mod open_in;
mod ssh_config;
mod ssh_daemon;
mod tray;
mod wsl_daemon;

/// Connection info for this computer's daemon, starting (or upgrading) it when needed. Blocking
/// work runs off the main thread.
#[tauri::command]
async fn ensure_local_daemon() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(local_daemon::ensure)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn wsl_distros() -> Result<Vec<String>, String> {
    if cfg!(windows) {
        wsl_daemon::list_distros()
    } else {
        Ok(vec![])
    }
}

#[tauri::command]
async fn start_wsl_daemon(distro: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || wsl_daemon::ensure(&distro))
        .await
        .map_err(|e| e.to_string())?
}

/// Concrete `Host` aliases from ~/.ssh/config (read-only).
#[tauri::command]
fn ssh_config_hosts() -> Vec<ssh_config::SshConfigHost> {
    ssh_config::load_user_hosts()
}

/// Connection info for an `ssh:<target>` host's daemon, reached through a local port forward.
#[tauri::command]
async fn start_ssh_daemon(target: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || ssh_daemon::ensure(&target))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn disconnect_ssh_host(target: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || ssh_daemon::disconnect(&target))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_workspace_in(target: String, host: String, path: String) -> Result<(), String> {
    open_in::open_in(&target, &host, &path)
}

/// Tray attention dot (window hidden and an agent finished or needs the user) and waiting count.
#[tauri::command]
fn set_tray_attention(app: tauri::AppHandle, attention: bool, waiting: u32) {
    tray::set_attention(&app, attention, waiting);
}

#[tauri::command]
fn set_minimize_to_tray(enabled: bool) {
    tray::set_minimize_to_tray(enabled);
}

/// The main window starts hidden so it can take its remembered size first; it shows once the page
/// has its boot screen up (`window_ready`), or after a while regardless.
static MAIN_SHOWN: AtomicBool = AtomicBool::new(false);
const SHOW_ANYWAY_AFTER: Duration = Duration::from_secs(3);

fn show_main_once<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>, dark: Option<bool>) {
    if window.label() != "main" || MAIN_SHOWN.swap(true, Ordering::SeqCst) {
        return;
    }
    // Same colours as the boot screen (index.html), so a resize the page lags behind never flashes.
    if let Some(dark) = dark {
        let color = if dark { Color(10, 10, 10, 255) } else { Color(255, 255, 255, 255) };
        let _ = window.set_background_color(Some(color));
    }
    if !presize_maximized(window) {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    // The page relays out at the new size before anyone sees it.
    let window = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(PRESIZE_SETTLE);
        let _ = window.show();
        let _ = window.set_focus();
    });
}

const PRESIZE_SETTLE: Duration = Duration::from_millis(120);

/// A hidden window keeps its maximize until it is shown (tao), so it used to grow on screen with the
/// page a beat behind. Hidden, it takes the work area's size first; the maximize at show then changes
/// next to nothing. Returns whether it did.
fn presize_maximized<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> bool {
    if !window.is_maximized().unwrap_or(false) {
        return false;
    }
    let Ok(Some(monitor)) = window.current_monitor() else {
        return false;
    };
    let area = *monitor.work_area();
    let _ = window.set_position(area.position);
    let _ = window.set_size(area.size);
    let _ = window.maximize();
    true
}

#[tauri::command]
fn window_ready(window: tauri::WebviewWindow, dark: bool) {
    show_main_once(&window, Some(dark));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Remembers the main window's size and maximized state; the first launch opens maximized
        // (tauri.conf.json). Visibility is left out: the window opens hidden and shows itself once sized.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .with_denylist(&["dashboard"])
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            ensure_local_daemon,
            wsl_distros,
            start_wsl_daemon,
            ssh_config_hosts,
            start_ssh_daemon,
            disconnect_ssh_host,
            open_workspace_in,
            set_tray_attention,
            set_minimize_to_tray,
            window_ready
        ])
        .setup(|app| {
            if let Ok(dir) = app.path().resource_dir() {
                daemon_process::set_resource_dir(dir);
            }
            tray::create(app.handle())?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(SHOW_ANYWAY_AFTER);
                if let Some(window) = handle.get_webview_window("main") {
                    show_main_once(&window, None);
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if tray::hide_on_close(window) {
                    api.prevent_close();
                }
            }
            tauri::WindowEvent::Focused(true) => tray::clear_attention(window.app_handle()),
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            // Daemons are detached so a crash or update cannot take terminals with it, but quitting
            // the app is the user ending the work: stop them with it.
            if let tauri::RunEvent::Exit = event {
                local_daemon::shutdown();
                wsl_daemon::shutdown();
                ssh_daemon::shutdown();
            }
        });
}
