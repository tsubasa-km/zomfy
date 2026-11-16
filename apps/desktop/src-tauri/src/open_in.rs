//! Orca's "Open in" menu: hand a workspace folder to VS Code, the file manager, or a terminal. A WSL
//! workspace opens through the distro (VS Code's WSL remote, `\\wsl.localhost`, `wsl --cd`); an SSH
//! one through VS Code Remote-SSH or an `ssh -t` terminal. A file can also be shown selected in the
//! file manager (`reveal`) or handed to the app the OS opens it with (`default`).

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
        "explorer" | "reveal" => Err("An SSH host's folders can't open in the file manager; use VS Code".into()),
        "default" => Err("An SSH host's files can't open in a local app".into()),
        _ => Err(format!("Unknown open target {target}")),
    }
}

/// What Windows Terminal runs for one of the daemon's local shell ids (terminal-manager.ts detectShells);
/// none leaves it to Windows Terminal's default profile.
fn local_shell_argv(shell: Option<&str>) -> Result<Vec<&'static str>, String> {
    Ok(match shell {
        None => vec![],
        Some("pwsh") => vec!["pwsh.exe", "-NoLogo"],
        Some("powershell") => vec!["powershell.exe", "-NoLogo"],
        Some("cmd") => vec!["cmd.exe"],
        Some("git-bash") => vec![r"C:\Program Files\Git\bin\bash.exe", "--login", "-i"],
        Some(other) => return Err(format!("Unknown shell {other}")),
    })
}

/// A WSL path as Windows sees it.
fn wsl_unc(distro: &str, path: &str) -> String {
    format!(r"\\wsl.localhost\{distro}{}", path.replace('/', r"\"))
}

/// The file manager's window on the folder holding `path`, with `path` selected.
fn reveal(path: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Explorer parses `/select,"path"` itself; quoting the whole argument, as Command does
        // for a path with spaces, makes it open its default folder instead.
        hidden("explorer")
            .raw_arg(format!("/select,\"{path}\""))
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("explorer: {e}"))
    }
    #[cfg(target_os = "macos")]
    {
        spawn("open", &["-R", path])
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let parent = std::path::Path::new(path).parent().and_then(|p| p.to_str()).unwrap_or(path);
        spawn("xdg-open", &[parent])
    }
}

/// `host` is `local`, `wsl:<distro>` or `ssh:<target>`; `path` is the host's own path. `shell` picks the
/// local terminal's shell by the daemon's shell id; WSL and SSH terminals run the host's login shell.
pub fn open_in(target: &str, host: &str, path: &str, shell: Option<&str>) -> Result<(), String> {
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
        ("explorer", Some(d)) => spawn("explorer", &[&wsl_unc(d, path)]),
        ("reveal", None) => reveal(path),
        ("reveal", Some(d)) => reveal(&wsl_unc(d, path)),
        // Explorer hands a file to its associated app, and asks which one when there is none.
        ("default", None) if cfg!(windows) => spawn("explorer", &[path]),
        ("default", None) if cfg!(target_os = "macos") => spawn("open", &[path]),
        ("default", None) => spawn("xdg-open", &[path]),
        ("default", Some(d)) => spawn("explorer", &[&wsl_unc(d, path)]),
        ("terminal", None) if cfg!(windows) => {
            let mut args = vec!["-d", path];
            args.extend(local_shell_argv(shell)?);
            spawn("wt", &args)
        }
        ("terminal", Some(d)) => spawn("wt", &["wsl.exe", "-d", d, "--cd", path]),
        ("terminal", None) => Err("Open in terminal is only wired up on Windows so far".into()),
        _ => Err(format!("Unknown open target {target}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_shells_map_to_programs() {
        assert!(local_shell_argv(None).unwrap().is_empty());
        assert_eq!(local_shell_argv(Some("cmd")).unwrap(), ["cmd.exe"]);
        assert!(local_shell_argv(Some("zsh")).is_err());
    }

    #[test]
    fn wsl_paths_become_unc() {
        assert_eq!(wsl_unc("Ubuntu", "/home/me/a.zip"), r"\\wsl.localhost\Ubuntu\home\me\a.zip");
    }

    #[test]
    fn ssh_terminal_starts_in_the_folder() {
        let dest = Destination::parse("me@h:2200").unwrap();
        assert_eq!(
            ssh_terminal_args(&dest, "/srv/it's"),
            ["ssh", "-t", "-p", "2200", "--", "me@h", r#"cd '/srv/it'\''s' && exec "${SHELL:-/bin/sh}" -l"#]
        );
    }
}
