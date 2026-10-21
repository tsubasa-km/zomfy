//! Starts the harness daemon inside a WSL distro, the way Zed runs its remote server there: a
//! prebuilt Linux binary is copied into the distro and launched through `wsl.exe`, hidden, and the
//! desktop then connects to it over WSL's localhost forwarding.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// CREATE_NO_WINDOW: without it every wsl.exe call flashes a console window.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const WSL_DAEMON_PORT: u16 = 7811;
const INSTALLED_BINARY: &str = "$HOME/.acp-harness/bin/acp-harness-daemon";

fn wsl() -> Command {
    let mut command = Command::new("wsl.exe");
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
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

fn local_binary() -> Result<PathBuf, String> {
    // Dev builds use the daemon package's compile output; packaged builds will bundle it.
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/daemon/dist/acp-harness-daemon-linux-x64");
    path.canonicalize()
        .map_err(|_| format!("Linux daemon not built: run `bun run build:linux` in packages/daemon ({})", path.display()))
}

/// Copies the binary into the distro when it differs from the installed one.
fn install(distro: &str) -> Result<(), String> {
    let windows_path = local_binary()?;
    let windows_path = windows_path.to_string_lossy().trim_start_matches(r"\\?\").to_string();
    let linux_path = run(wsl().args(["-d", distro, "--exec", "wslpath", "-u", &windows_path]))?;
    // Size + mtime stamp: comparing the 90 MB binary itself over WSL's file bridge takes seconds.
    let meta = std::fs::metadata(&windows_path).map_err(|e| e.to_string())?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs());
    let stamp = format!("{}-{modified}", meta.len());
    // The source path and stamp are passed as $1/$2, never spliced into the script.
    let script = format!(
        "set -e; target=\"{INSTALLED_BINARY}\"; mkdir -p \"$(dirname \"$target\")\"; \
         if [ \"$(cat \"$target.stamp\" 2>/dev/null)\" != \"$2\" ] || [ ! -x \"$target\" ]; then \
         cp \"$1\" \"$target.new\"; chmod +x \"$target.new\"; pkill -f \"$target --port\" || true; \
         mv -f \"$target.new\" \"$target\"; echo \"$2\" > \"$target.stamp\"; fi"
    );
    run(wsl().args(["-d", distro, "--exec", "sh", "-c", &script, "sh", &linux_path, &stamp]))?;
    Ok(())
}

/// Ensures a daemon runs in `distro` and returns its connection JSON ({url, token, protocolPrefix}).
pub fn start(distro: &str, children: &std::sync::Mutex<Vec<Child>>) -> Result<String, String> {
    install(distro)?;
    // A login shell gives the daemon the user's PATH (claude in ~/.local/bin, etc.).
    let script = format!("exec \"{INSTALLED_BINARY}\" --port={WSL_DAEMON_PORT} --print-connection");
    let mut child = wsl()
        .args(["-d", distro, "--exec", "bash", "-lc", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("wsl.exe: {e}"))?;

    let stdout = child.stdout.take().ok_or("no stdout")?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if line.starts_with('{') {
                let _ = tx.send(line);
                break;
            }
        }
    });

    match rx.recv_timeout(Duration::from_secs(20)) {
        Ok(line) => {
            children.lock().map_err(|e| e.to_string())?.push(child);
            Ok(line)
        }
        Err(_) => {
            // Usually a daemon is already listening there, so this one exited; reuse its record.
            let _ = child.kill();
            run(wsl().args(["-d", distro, "--exec", "sh", "-c", "cat \"$HOME/.acp-harness/daemon.json\""]))
        }
    }
}
