//! Keeps a daemon running on this computer: reuses one that answers and matches the current build,
//! otherwise starts a fresh copy, detached, from a per-build location (so rebuilding never hits a
//! locked executable, and an app update never kills running terminals).

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use crate::daemon_process::{built_binary, hidden, port_of, reachable, spawn_detached, stamp, wait_for};

const LOCAL_DAEMON_PORT: u16 = 7801;

/// Concurrent callers wait for one start instead of racing two daemons for the port.
static STARTING: Mutex<()> = Mutex::new(());

#[cfg(windows)]
const BINARY_NAME: &str = "acp-harness-daemon-windows-x64.exe";
#[cfg(target_os = "linux")]
const BINARY_NAME: &str = "acp-harness-daemon-linux-x64";
#[cfg(target_os = "macos")]
const BINARY_NAME: &str = "acp-harness-daemon-darwin-arm64";

fn harness_home() -> Result<PathBuf, String> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or("home directory not found")?;
    Ok(PathBuf::from(home).join(".acp-harness"))
}

/// Per-user install root for the running copy (`%LOCALAPPDATA%` on Windows).
fn install_root() -> Result<PathBuf, String> {
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or(harness_home()?);
    Ok(base.join("acp-harness").join("bin"))
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
    let Ok(home) = harness_home() else { return };
    if let Some(info) = read_info(&home) {
        stop(&info);
    }
    let _ = std::fs::remove_file(home.join("daemon.json"));
}

/// Returns this computer's daemon connection JSON, starting or upgrading the daemon as needed.
pub fn ensure() -> Result<String, String> {
    let _starting = STARTING.lock().map_err(|e| e.to_string())?;
    let home = harness_home()?;
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
    let info = wait_for(Duration::from_secs(15), || read_info(&home))?;
    std::fs::create_dir_all(&home).map_err(|e| e.to_string())?;
    std::fs::write(&stamp_path, &build).map_err(|e| e.to_string())?;
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
