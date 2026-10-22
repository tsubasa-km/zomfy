//! Orca's "Open in" menu: hand a workspace folder to VS Code, the file manager, or a terminal. A WSL
//! workspace opens through the distro (VS Code's WSL remote, `\\wsl.localhost`, `wsl --cd`); an SSH
//! one through VS Code Remote-SSH or an `ssh -t` terminal.

use crate::daemon_process::hidden;
use crate::ssh_daemon::{Destination, posix_quote};

fn spawn(program: &str, args: &[&str]) -> Result<(), String> {
    hidden(program)
        .args(args)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("{program}: {e}"))
}

/// An interactive ssh (no BatchMode: a terminal may prompt) that starts in `path`.
fn ssh_terminal_args(dest: &Destination, path: &str) -> Vec<String> {
    let mut args = vec!["ssh".to_string(), "-t".to_string()];
    if let Some(port) = dest.port {
        args.extend(["-p".to_string(), port.to_string()]);
    }
    let remote = format!("cd {} && exec \"${{SHELL:-/bin/sh}}\" -l", posix_quote(path));
    args.extend(["--".to_string(), dest.host.clone(), remote]);
    args
}

fn open_ssh(target: &str, ssh: &str, path: &str) -> Result<(), String> {
    let dest = Destination::parse(ssh)?;
    match target {
        "vscode" => {
            let remote = format!("ssh-remote+{}", dest.vscode_authority()?);
            if cfg!(windows) {
                spawn("cmd", &["/C", "code", "--remote", &remote, path])
            } else {
                spawn("code", &["--remote", &remote, path])
            }
        }
        "terminal" if cfg!(windows) => {
            let args = ssh_terminal_args(&dest, path);
            spawn("wt", &args.iter().map(String::as_str).collect::<Vec<_>>())
        }
        "terminal" => Err("Open in terminal is only wired up on Windows so far".into()),
        "explorer" => Err("An SSH host's folders can't open in the file manager; use VS Code".into()),
        _ => Err(format!("Unknown open target {target}")),
    }
}

/// `host` is `local`, `wsl:<distro>` or `ssh:<target>`; `path` is the host's own path.
pub fn open_in(target: &str, host: &str, path: &str) -> Result<(), String> {
    if let Some(ssh) = host.strip_prefix("ssh:") {
        return open_ssh(target, ssh, path);
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ssh_terminal_starts_in_the_folder() {
        let dest = Destination::parse("me@h:2200").unwrap();
        assert_eq!(
            ssh_terminal_args(&dest, "/srv/it's"),
            ["ssh", "-t", "-p", "2200", "--", "me@h", r#"cd '/srv/it'\''s' && exec "${SHELL:-/bin/sh}" -l"#]
        );
    }
}
