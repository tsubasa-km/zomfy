//! Keeps the harness daemon running inside a WSL distro, the way Zed runs its remote server there: a
//! prebuilt Linux binary is copied into the distro and started through `wsl.exe`. That wsl.exe is
//! launched detached from the app, so it outlives the app and also keeps the distro awake (Orca's
//! "distro holder"); the desktop connects over WSL's localhost forwarding.

use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;

use crate::daemon_process::{built_binary, hidden, port_of, reachable, spawn_detached, stamp, wait_for};

const WSL_DAEMON_PORT: u16 = 7811;
const INSTALLED_BINARY: &str = "$HOME/.acp-harness/bin/acp-harness-daemon";

/// Two windows (or a retry) asking at once must not start two daemons.
static STARTING: Mutex<()> = Mutex::new(());

fn wsl() -> Command {
    hidden("wsl.exe")
}

fn run(command: &mut Command) -> Result<String, String> {
    let output = command.output().map_err(|e| format!("wsl.exe: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// `wsl.exe -l -q` prints UTF-16LE; Docker's internal distros are not workspaces.
pub fn list_distros() -> Result<Vec<String>, String> {
    let output = wsl().args(["-l", "-q"]).output().map_err(|e| format!("wsl.exe: {e}"))?;
    let units: Vec<u16> = output
        .stdout
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect();
    Ok(String::from_utf16_lossy(&units)
        .lines()
        .map(|line| line.trim_matches(|c: char| c.is_whitespace() || c == '\0').to_string())
        .filter(|name| !name.is_empty() && !name.starts_with("docker-desktop"))
        .collect())
}

/// Copies the binary into the distro when its stamp changed, stopping the old daemon; returns
/// whether it upgraded.
fn install(distro: &str) -> Result<bool, String> {
    let source = built_binary("acp-harness-daemon-linux-x64")?;
    let build = stamp(&source)?;
    let linux_path = run(wsl().args(["-d", distro, "--exec", "wslpath", "-u", &source.to_string_lossy()]))?;
    // The source path and stamp are passed as $1/$2, never spliced into the script.
    let script = format!(
        "set -e; target=\"{INSTALLED_BINARY}\"; mkdir -p \"$(dirname \"$target\")\"; \
         if [ \"$(cat \"$target.stamp\" 2>/dev/null)\" != \"$2\" ] || [ ! -x \"$target\" ]; then \
         cp \"$1\" \"$target.new\"; chmod +x \"$target.new\"; pkill -f \"$target --port\" || true; \
         mv -f \"$target.new\" \"$target\"; echo \"$2\" > \"$target.stamp\"; echo upgraded; fi"
    );
    let out = run(wsl().args(["-d", distro, "--exec", "sh", "-c", &script, "sh", &linux_path, &build]))?;
    Ok(out.contains("upgraded"))
}

fn read_info(distro: &str) -> Option<String> {
    run(wsl().args(["-d", distro, "--exec", "sh", "-c", "cat \"$HOME/.acp-harness/daemon.json\""]))
        .ok()
        .filter(|s| s.starts_with('{'))
}

/// Ensures a daemon runs in `distro` and returns its connection JSON ({url, token, protocolPrefix}).
pub fn ensure(distro: &str) -> Result<String, String> {
    let _starting = STARTING.lock().map_err(|e| e.to_string())?;
    let upgraded = install(distro)?;
    if !upgraded {
        if let Some(info) = read_info(distro) {
            if port_of(&info).is_some_and(reachable) {
                return Ok(info);
            }
        }
    }
    let _ = run(wsl().args(["-d", distro, "--exec", "sh", "-c", "rm -f \"$HOME/.acp-harness/daemon.json\""]));
    // A login shell gives the daemon the user's PATH (claude in ~/.local/bin, etc.).
    let script = format!("exec \"{INSTALLED_BINARY}\" --port={WSL_DAEMON_PORT}");
    let mut command = Command::new("wsl.exe");
    command.args(["-d", distro, "--exec", "bash", "-lc", &script]);
    spawn_detached(command)?;
    wait_for(Duration::from_secs(30), || read_info(distro))
}
