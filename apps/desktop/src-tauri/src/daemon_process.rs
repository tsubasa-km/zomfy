//! Pieces shared by the local and WSL daemon launchers: finding the built binary, a cheap
//! "is this the same build" stamp, reachability checks, and spawning a process that outlives the
//! app (daemons keep terminals and agent turns alive across app restarts, as Orca's do).

use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
#[cfg(windows)]
const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;

static RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

/// The installed app's resource folder, where the installer put the daemon binaries.
pub fn set_resource_dir(dir: PathBuf) {
    let _ = RESOURCE_DIR.set(dir);
}

/// The daemon binary `name`: bundled under `daemon/` in an installed app (tauri.windows.conf.json),
/// else where `bun run build` in packages/daemon leaves it (dev builds).
pub fn built_binary(name: &str) -> Result<PathBuf, String> {
    let bundled = RESOURCE_DIR.get().map(|dir| dir.join("daemon").join(name));
    let path = match bundled {
        Some(path) if !cfg!(debug_assertions) && path.is_file() => path,
        _ => PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../packages/daemon/dist").join(name),
    };
    path.canonicalize()
        .map(|p| PathBuf::from(p.to_string_lossy().trim_start_matches(r"\\?\")))
        .map_err(|_| format!("Daemon binary missing: {} (dev builds: run `bun run build` in packages/daemon)", path.display()))
}

/// Size + mtime: enough to tell builds apart without hashing a 90 MB file.
pub fn stamp(path: &Path) -> Result<String, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs());
    Ok(format!("{}-{modified}", meta.len()))
}

/// The port of a `ws://127.0.0.1:<port>/acp` url from a daemon.json record.
pub fn port_of(info_json: &str) -> Option<u16> {
    let value: serde_json::Value = serde_json::from_str(info_json).ok()?;
    let url = value.get("url")?.as_str()?;
    url.rsplit_once(':')?.1.split('/').next()?.parse().ok()
}

pub fn reachable(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
}

/// Polls `read` until it yields a record whose port answers, or the timeout passes.
pub fn wait_for(timeout: Duration, mut read: impl FnMut() -> Option<String>) -> Result<String, String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Some(info) = read() {
            if port_of(&info).is_some_and(reachable) {
                return Ok(info);
            }
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    Err("The daemon did not start in time".into())
}

/// Starts `command` with no console and outside the app's process tree, so it survives the app.
pub fn spawn_detached(mut command: Command) -> Result<(), String> {
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        // Not DETACHED_PROCESS: a console program started with no console opens its own window
        // (a Windows Terminal window when that is the default); CREATE_NO_WINDOW gives it a hidden one.
        // Breaking away fails inside a job that forbids it (some dev launchers); retry without.
        command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB);
        if command.spawn().is_ok() {
            return Ok(());
        }
        command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }
    command.spawn().map(|_| ()).map_err(|e| format!("could not start the daemon: {e}"))
}

/// A short-lived helper command (wsl.exe probes, taskkill) that must not flash a console.
pub fn hidden(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}
