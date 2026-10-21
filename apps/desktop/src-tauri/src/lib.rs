mod daemon_process;
mod local_daemon;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![ensure_local_daemon, wsl_distros, start_wsl_daemon])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            // Daemons are detached so a crash or update cannot take terminals with it, but quitting
            // the app is the user ending the work: stop them with it.
            if let tauri::RunEvent::Exit = event {
                local_daemon::shutdown();
                wsl_daemon::shutdown();
            }
        });
}
