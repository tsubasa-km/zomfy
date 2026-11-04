//! Keeps the harness daemon running inside a WSL distro, the way Zed runs its remote server there: a
//! prebuilt Linux binary is copied into the distro and started through `wsl.exe`. That wsl.exe is
//! launched detached from the app, so it outlives the app and also keeps the distro awake (Orca's
//! "distro holder"); the desktop connects over WSL's localhost forwarding.

use std::process::{Command, Stdio};
use std::sync::{Mutex, mpsc};
use std::time::Duration;

use crate::daemon_process::{built_binary, hidden, port_of, reachable, spawn_detached, stamp, wait_for};

const WSL_DAEMON_PORT: u16 = 7811;
const INSTALLED_BINARY: &str = "$HOME/.acp-harness/bin/acp-harness-daemon";

/// Two windows (or a retry) asking at once must not start two daemons.
static STARTING: Mutex<()> = Mutex::new(());

fn wsl() -> Command {
    hidden("wsl.exe")
}

/// How long one wsl.exe call may take. Just after sign-in, while the WSL service is still coming up,
/// wsl.exe can hang; a hung call would hold STARTING and stall every retry until the app restarts.
const CALL_LIMIT: Duration = Duration::from_secs(60);
/// Copying a new daemon binary into the distro takes longer than a plain call.
const INSTALL_LIMIT: Duration = Duration::from_secs(180);
const READ_LIMIT: Duration = Duration::from_secs(15);

fn run(command: &mut Command) -> Result<String, String> {
    run_within(command, CALL_LIMIT)
}

/// Runs `command` to the end, or gives up after `limit` and kills it (and what it started).
fn run_within(command: &mut Command, limit: Duration) -> Result<String, String> {
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let child = command.spawn().map_err(|e| format!("wsl.exe: {e}"))?;
    let pid = child.id();
    let (done, outcome) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = done.send(child.wait_with_output());
    });
    let Ok(result) = outcome.recv_timeout(limit) else {
        let _ = hidden("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).stdout(Stdio::null()).stderr(Stdio::null()).status();
        return Err(format!("WSL did not answer within {} seconds; it may still be starting", limit.as_secs()));
    };
    let output = result.map_err(|e| format!("wsl.exe: {e}"))?;
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
    let out = run_within(wsl().args(["-d", distro, "--exec", "sh", "-c", &script, "sh", &linux_path, &build]), INSTALL_LIMIT)?;
    Ok(out.contains("upgraded"))
}

fn read_info(distro: &str) -> Option<String> {
    run_within(wsl().args(["-d", distro, "--exec", "sh", "-c", "cat \"$HOME/.acp-harness/daemon.json\""]), READ_LIMIT)
        .ok()
        .filter(|s| s.starts_with('{'))
}

/// Distros this app ensured a daemon in, to stop on quit.
static USED: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Stops the daemons this app used; their wsl.exe holders then exit and the distros may idle.
pub fn shutdown() {
    let distros = USED.lock().map(|d| d.clone()).unwrap_or_default();
    for distro in distros {
        let script = format!("pkill -f \"{INSTALLED_BINARY} --port\"; rm -f \"$HOME/.acp-harness/daemon.json\"");
        let _ = wsl().args(["-d", &distro, "--exec", "sh", "-c", &script]).status();
    }
}

/// Ensures a daemon runs in `distro` and returns its connection JSON ({url, token, protocolPrefix}).
pub fn ensure(distro: &str) -> Result<String, String> {
    let _starting = STARTING.lock().map_err(|e| e.to_string())?;
    if let Ok(mut used) = USED.lock() {
        if !used.iter().any(|d| d == distro) {
            used.push(distro.to_string());
        }
    }
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

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::time::Instant;

    #[test]
    fn a_call_that_hangs_is_given_up_on() {
        let started = Instant::now();
        let result = run_within(hidden("ping").args(["-n", "10", "127.0.0.1"]), Duration::from_secs(1));
        assert!(result.is_err());
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn a_quick_call_returns_its_output() {
        assert_eq!(run_within(hidden("cmd").args(["/C", "echo hi"]), Duration::from_secs(10)).unwrap(), "hi");
    }
}
