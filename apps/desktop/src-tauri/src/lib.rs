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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            ensure_local_daemon,
            wsl_distros,
            start_wsl_daemon,
            ssh_config_hosts,
            start_ssh_daemon,
            disconnect_ssh_host,
            open_workspace_in,
            set_tray_attention,
            set_minimize_to_tray
        ])
        .setup(|app| {
            tray::create(app.handle())?;
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
