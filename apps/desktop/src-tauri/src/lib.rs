use std::path::PathBuf;
use std::process::Child;
use std::sync::{Arc, Mutex};

mod wsl_daemon;

/// WSL daemons this app started; held so their wsl.exe handles live as long as the app.
#[derive(Default)]
struct WslDaemons(Arc<Mutex<Vec<Child>>>);

/// Connection info the local daemon writes on startup (url + token), read here because the
/// webview cannot touch the filesystem.
#[tauri::command]
fn local_daemon_info() -> Result<String, String> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or("home directory not found")?;
    let path = PathBuf::from(home).join(".acp-harness").join("daemon.json");
    std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))
}

#[tauri::command]
fn wsl_distros() -> Result<Vec<String>, String> {
    if cfg!(windows) {
        wsl_daemon::list_distros()
    } else {
        Ok(vec![])
    }
}

/// Blocking work (copying the binary, waiting for the daemon) runs off the main thread.
#[tauri::command]
async fn start_wsl_daemon(distro: String, state: tauri::State<'_, WslDaemons>) -> Result<String, String> {
    let children = Arc::clone(&state.0);
    tauri::async_runtime::spawn_blocking(move || wsl_daemon::start(&distro, &children))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(WslDaemons::default())
        .invoke_handler(tauri::generate_handler![local_daemon_info, wsl_distros, start_wsl_daemon])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
