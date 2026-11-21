//! Keeps a daemon running on this computer: reuses one that answers and matches the current build,
//! otherwise starts a fresh copy, detached, from a per-build location (so rebuilding never hits a
//! locked executable, and an app update never kills running terminals).

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use crate::daemon_process::{built_binary, hidden, port_of, reachable, spawn_detached, stamp, wait_for};

const LOCAL_DAEMON_PORT: u16 = 7801;

/// Concurrent callers wait for one start instead of racing two daemons for the port.
static STARTING: Mutex<()> = Mutex::new(());

#[cfg(windows)]
const BINARY_NAME: &str = "zomfy-daemon-windows-x64.exe";
#[cfg(target_os = "linux")]
const BINARY_NAME: &str = "zomfy-daemon-linux-x64";
#[cfg(target_os = "macos")]
const BINARY_NAME: &str = "zomfy-daemon-darwin-arm64";

fn user_home() -> Result<PathBuf, String> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or("home directory not found")?;
    Ok(PathBuf::from(home))
}

fn harness_home() -> Result<PathBuf, String> {
    Ok(user_home()?.join(".zomfy"))
}

/// The home older builds used; the daemon moves it to `harness_home` on its first start.
fn legacy_home() -> Result<PathBuf, String> {
    Ok(user_home()?.join(".acp-harness")) // legacy
}

/// A legacy home is a real folder until the daemon moved it and left a link in its place.
fn is_unmoved_legacy(legacy: &Path) -> bool {
    std::fs::symlink_metadata(legacy).is_ok_and(|m| m.is_dir()) && !legacy.join("MOVED-TO-ZOMFY.txt").exists() // legacy marker
}

/// Where the daemon keeps its state right now: the new home once it exists, else a legacy home the
/// daemon has not moved yet (it stays there when the move cannot be done safely).
fn active_home(home: &Path, legacy: &Path) -> PathBuf {
    if !home.exists() && is_unmoved_legacy(legacy) { legacy.to_path_buf() } else { home.to_path_buf() }
}

/// Before the first start under the new name: stops a daemon still running from the legacy home
/// (the daemon will not move a home in use) and clears its record, so the new one moves it.
fn retire_legacy_daemon(home: &Path, legacy: &Path) {
    if home.exists() || !is_unmoved_legacy(legacy) {
        return;
    }
    if let Some(info) = read_info(legacy) {
        if port_of(&info).is_some_and(reachable) {
            stop(&info);
            std::thread::sleep(Duration::from_millis(500));
        }
        let _ = std::fs::remove_file(legacy.join("daemon.json"));
    }
}

/// Per-user install root for the running copy (`%LOCALAPPDATA%` on Windows).
fn install_root() -> Result<PathBuf, String> {
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or(harness_home()?);
    Ok(base.join("zomfy").join("bin"))
}

fn read_info(home: &std::path::Path) -> Option<String> {
    std::fs::read_to_string(home.join("daemon.json")).ok()
}

fn stop(info: &str) {
    let Some(pid) = serde_json::from_str::<serde_json::Value>(info)
        .ok()
        .and_then(|v| v.get("pid")?.as_u64())
    else {
        return;
    };
    #[cfg(windows)]
    // /T: the agents, CLIs and MCP servers it started go with it instead of piling up.
    let _ = hidden("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).status();
    #[cfg(not(windows))]
    let _ = hidden("kill").args(["-TERM", &pid.to_string()]).status();
}

/// Stops this computer's daemon when the app quits.
pub fn shutdown() {
    let (Ok(home), Ok(legacy)) = (harness_home(), legacy_home()) else { return };
    let home = active_home(&home, &legacy);
    if let Some(info) = read_info(&home) {
        stop(&info);
    }
    let _ = std::fs::remove_file(home.join("daemon.json"));
}

/// Returns this computer's daemon connection JSON, starting or upgrading the daemon as needed.
pub fn ensure() -> Result<String, String> {
    let _starting = STARTING.lock().map_err(|e| e.to_string())?;
    let (new_home, legacy) = (harness_home()?, legacy_home()?);
    if !new_home.exists() && is_unmoved_legacy(&legacy) {
        retire_legacy_daemon(&new_home, &legacy);
        // The legacy per-build copies of the daemon; one still locked is left behind.
        if let Some(base) = std::env::var_os("LOCALAPPDATA") {
            let _ = std::fs::remove_dir_all(PathBuf::from(base).join("acp-harness")); // legacy install root
        }
    }
    let home = active_home(&new_home, &legacy);
    let source = built_binary(BINARY_NAME)?;
    let build = stamp(&source)?;
    let stamp_path = home.join("daemon.stamp");

    if let Some(info) = read_info(&home) {
        if port_of(&info).is_some_and(reachable) {
            let running = std::fs::read_to_string(&stamp_path).unwrap_or_default();
            if running.trim() == build {
                return Ok(info);
            }
            // A different build answers (an older copy, or one started by hand): replace it.
            stop(&info);
            std::thread::sleep(Duration::from_millis(500));
        }
    }

    let root = install_root()?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let target = root.join(format!("{}-{build}{}", BINARY_NAME.trim_end_matches(".exe"), std::env::consts::EXE_SUFFIX));
    if !target.exists() {
        std::fs::copy(&source, &target).map_err(|e| format!("copying the daemon: {e}"))?;
    }
    let _ = std::fs::remove_file(home.join("daemon.json"));

    let mut command = std::process::Command::new(&target);
    command.arg(format!("--port={LOCAL_DAEMON_PORT}")).current_dir(&root);
    spawn_detached(command)?;
    // The daemon moves a legacy home on start, so where its record appears is decided only now.
    let info = wait_for(Duration::from_secs(15), || read_info(&active_home(&new_home, &legacy)))?;
    let home = active_home(&new_home, &legacy);
    std::fs::create_dir_all(&home).map_err(|e| e.to_string())?;
    std::fs::write(home.join("daemon.stamp"), &build).map_err(|e| e.to_string())?;
    // Older builds' copies; a copy still running stays locked and is simply skipped.
    if let Ok(entries) = std::fs::read_dir(&root) {
        for entry in entries.flatten() {
            if entry.path() != target {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("zomfy-local-home-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_legacy_home_is_active_until_the_new_one_exists() {
        let root = temp("active");
        let (home, legacy) = (root.join(".zomfy"), root.join(".acp-harness")); // legacy
        assert_eq!(active_home(&home, &legacy), home);
        std::fs::create_dir_all(&legacy).unwrap();
        assert_eq!(active_home(&home, &legacy), legacy);
        std::fs::create_dir_all(&home).unwrap();
        assert_eq!(active_home(&home, &legacy), home);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_copied_legacy_home_is_not_active() {
        let root = temp("marked");
        let (home, legacy) = (root.join(".zomfy"), root.join(".acp-harness")); // legacy
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("MOVED-TO-ZOMFY.txt"), "").unwrap(); // legacy marker
        assert_eq!(active_home(&home, &legacy), home);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_stale_legacy_record_is_cleared_without_stopping_anything() {
        let root = temp("retire");
        let (home, legacy) = (root.join(".zomfy"), root.join(".acp-harness")); // legacy
        std::fs::create_dir_all(&legacy).unwrap();
        // Port 9 answers nothing, so no pid is killed; only the stale record goes.
        std::fs::write(legacy.join("daemon.json"), r#"{"url":"ws://127.0.0.1:9/acp","pid":4294967}"#).unwrap();
        std::fs::write(legacy.join("settings.json"), "{}").unwrap();
        retire_legacy_daemon(&home, &legacy);
        assert!(!legacy.join("daemon.json").exists());
        assert!(legacy.join("settings.json").exists());
        let _ = std::fs::remove_dir_all(&root);
    }
}
