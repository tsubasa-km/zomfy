//! Orca's "Open in" menu: hand a workspace folder to VS Code, the file manager, or a terminal. A WSL
//! workspace opens through the distro (VS Code's WSL remote, `\\wsl.localhost`, `wsl --cd`).

use crate::daemon_process::hidden;

fn spawn(program: &str, args: &[&str]) -> Result<(), String> {
    hidden(program)
        .args(args)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("{program}: {e}"))
}

/// `host` is `local` or `wsl:<distro>`; `path` is the host's own path (Linux path for WSL).
pub fn open_in(target: &str, host: &str, path: &str) -> Result<(), String> {
    let distro = host.strip_prefix("wsl:");
    match (target, distro) {
        // `code` is a .cmd shim on Windows, so it goes through cmd with the args kept separate.
        ("vscode", None) if cfg!(windows) => spawn("cmd", &["/C", "code", path]),
        ("vscode", None) => spawn("code", &[path]),
        ("vscode", Some(d)) => spawn("cmd", &["/C", "code", "--remote", &format!("wsl+{d}"), path]),
        ("explorer", None) if cfg!(windows) => spawn("explorer", &[path]),
        ("explorer", None) if cfg!(target_os = "macos") => spawn("open", &[path]),
        ("explorer", None) => spawn("xdg-open", &[path]),
        ("explorer", Some(d)) => {
            let unc = format!(r"\\wsl.localhost\{d}{}", path.replace('/', r"\"));
            spawn("explorer", &[&unc])
        }
        ("terminal", None) if cfg!(windows) => spawn("wt", &["-d", path]),
        ("terminal", Some(d)) => spawn("wt", &["wsl.exe", "-d", d, "--cd", path]),
        ("terminal", None) => Err("Open in terminal is only wired up on Windows so far".into()),
        _ => Err(format!("Unknown open target {target}")),
    }
}
