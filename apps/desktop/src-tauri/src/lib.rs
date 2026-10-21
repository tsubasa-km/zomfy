use std::path::PathBuf;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![local_daemon_info])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
