//! Runs the harness daemon on an SSH host the way VS Code Remote-SSH runs its server: the system
//! `ssh` (so the user's config, keys, agent and ProxyJump all apply) detects the remote platform,
//! uploads the matching Linux binary when its stamp changed, starts it bound to the remote's
//! 127.0.0.1, and the desktop reaches it through a local relay port whose connections each run
//! `ssh -W` to the daemon's port.
//!
//! Why `-W` rather than one long-lived `-L`: `-L` cannot be separated from the LocalForwards in the
//! user's own config for that host (ClearAllForwardings drops ours too), so a tunnel would grab
//! ports the user's own `ssh` sessions need. Stdio forwarding binds nothing; the window opens one
//! socket per host, so the extra login per reconnect is cheap.
//!
//! Every ssh runs with `BatchMode=yes`: the app never handles passwords, so a host that would prompt
//! fails fast with a message pointing at key auth instead of hanging on an invisible prompt.

use std::collections::HashMap;
use std::io::Read;
use std::net::{Shutdown, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use crate::daemon_process::{built_binary, hidden, port_of, reachable, stamp};

const COMMON_OPTIONS: [&str; 10] = [
    "-o",
    "BatchMode=yes",
    // Never bind the LocalForward/RemoteForward ports from the user's config for this host.
    "-o",
    "ClearAllForwardings=yes",
    "-o",
    "ConnectTimeout=15",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
];

/// `alias`, `user@host`, `user@host:port` or `user@[v6]:port`, as typed or read from ~/.ssh/config.
#[derive(Debug, Clone, PartialEq)]
pub struct Destination {
    pub host: String,
    pub port: Option<u16>,
}

impl Destination {
    pub fn parse(input: &str) -> Result<Self, String> {
        let s = input.trim();
        let s = s.strip_prefix("ssh://").unwrap_or(s).trim_end_matches('/');
        if s.is_empty() {
            return Err("Enter an SSH host alias or user@host[:port]".into());
        }
        // The destination is an argv entry, never a shell word, but a leading `-` would be an option.
        if s.starts_with('-') || s.chars().any(|c| c.is_whitespace() || c.is_control() || "\"'`$;&|<>(),\\%^!".contains(c)) {
            return Err(format!("Not a valid SSH destination: {s}"));
        }
        let (host, port) = if let Some(i) = s.rfind("]:") {
            (&s[..=i], Some(&s[i + 2..]))
        } else if !s.contains('[') && s.matches(':').count() == 1 {
            let (h, p) = s.split_once(':').unwrap_or((s, ""));
            (h, Some(p))
        } else {
            (s, None)
        };
        let port = match port {
            Some(p) => Some(p.parse::<u16>().ok().filter(|p| *p > 0).ok_or(format!("Not a valid port: {p}"))?),
            None => None,
        };
        let host = host.replace(['[', ']'], "");
        if host.is_empty() || host.ends_with('@') {
            return Err(format!("Not a valid SSH destination: {s}"));
        }
        Ok(Self { host, port })
    }

    /// VS Code's `ssh-remote+<authority>` cannot carry a port; a non-default one needs an alias.
    pub fn vscode_authority(&self) -> Result<&str, String> {
        match self.port {
            Some(port) if port != 22 => Err(format!(
                "VS Code needs a Host alias for {}:{port}: add one to ~/.ssh/config and connect through it",
                self.host
            )),
            _ => Ok(&self.host),
        }
    }
}

/// Full ssh argv: shared options, `extra`, the port, then the destination and remote command.
pub fn ssh_argv(dest: &Destination, extra: &[&str], remote: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = COMMON_OPTIONS.iter().chain(extra).map(|s| s.to_string()).collect();
    if let Some(port) = dest.port {
        args.extend(["-p".to_string(), port.to_string()]);
    }
    // OpenSSH stops reading options at `--`.
    args.extend(["--".to_string(), dest.host.clone()]);
    args.extend(remote.map(str::to_string));
    args
}

pub fn posix_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// sshd hands the command to the user's login shell (maybe fish or zsh), so the script is wrapped
/// for `sh` and its arguments are passed positionally, never spliced into it.
pub fn remote_command(script: &str, args: &[&str]) -> String {
    let mut command = format!("sh -c {} sh", posix_quote(script));
    for arg in args {
        command.push(' ');
        command.push_str(&posix_quote(arg));
    }
    command
}

/// Markers keep the probe readable through whatever a shell rc file prints to stdout.
const MARK: &str = "@acp:";

const PROBE_SCRIPT: &str = r#"L="$HOME/.acp-harness"
echo "@acp:os=$(uname -s)"
echo "@acp:arch=$(uname -m)"
echo "@acp:stamp=$(cat "$L/bin/acp-harness-daemon.stamp" 2>/dev/null)"
pid=$(sed -n 's/.*"pid":\([0-9][0-9]*\).*/\1/p' "$L/daemon.json" 2>/dev/null)
if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && { [ ! -r "/proc/$pid/cmdline" ] || grep -q acp-harness "/proc/$pid/cmdline"; }; then
  echo "@acp:alive=yes"
else
  echo "@acp:alive=no"
fi
echo "@acp:info=$(cat "$L/daemon.json" 2>/dev/null)""#;

/// $1 = stamp, $2 = byte count; the binary arrives on stdin. Stops the old daemon, as WSL upgrades do.
const INSTALL_SCRIPT: &str = r#"set -e
L="$HOME/.acp-harness"; t="$L/bin/acp-harness-daemon"
mkdir -p "$L/bin"
cat > "$t.new"
size=$(wc -c < "$t.new" | tr -d ' ')
if [ "$size" != "$2" ]; then rm -f "$t.new"; echo "upload incomplete ($size of $2 bytes)" >&2; exit 3; fi
chmod +x "$t.new"
pkill -f "$t --port" 2>/dev/null || true
mv -f "$t.new" "$t"
echo "$1" > "$t.stamp""#;

/// Port 0: a shared remote may have other users' daemons, so the kernel picks a free port and the
/// daemon records it in daemon.json. A login shell gives it the user's PATH (claude in ~/.local/bin).
const START_SCRIPT: &str = r#"L="$HOME/.acp-harness"; t="$L/bin/acp-harness-daemon"
rm -f "$L/daemon.json"
cd "$HOME"
S="${SHELL:-/bin/sh}"
if command -v setsid >/dev/null 2>&1; then D=setsid; else D=; fi
$D nohup "$S" -lc "exec '$t' --port=0" > "$L/daemon.log" 2>&1 < /dev/null &
i=0
while [ $i -lt 120 ]; do
  if grep -q '"pid"' "$L/daemon.json" 2>/dev/null; then echo "@acp:info=$(cat "$L/daemon.json")"; exit 0; fi
  sleep 0.25; i=$((i+1))
done
echo "The daemon did not start within 30 seconds. Last lines of ~/.acp-harness/daemon.log:" >&2
tail -n 15 "$L/daemon.log" >&2
exit 4"#;

/// Only stops a daemon this app installed; daemon.json goes with it.
const STOP_SCRIPT: &str = r#"pkill -f "$HOME/.acp-harness/bin/acp-harness-daemon --port" && rm -f "$HOME/.acp-harness/daemon.json""#;

#[derive(Debug, Default, PartialEq)]
pub struct Probe {
    pub os: String,
    pub arch: String,
    pub stamp: String,
    pub alive: bool,
    pub info: Option<String>,
}

pub fn parse_probe(stdout: &str) -> Result<Probe, String> {
    let mut probe = Probe::default();
    let mut seen = false;
    for line in stdout.lines() {
        let Some((key, value)) = line.trim_end_matches('\r').strip_prefix(MARK).and_then(|l| l.split_once('=')) else {
            continue;
        };
        seen = true;
        match key {
            "os" => probe.os = value.trim().to_string(),
            "arch" => probe.arch = value.trim().to_string(),
            "stamp" => probe.stamp = value.trim().to_string(),
            "alive" => probe.alive = value.trim() == "yes",
            "info" => probe.info = Some(value.trim()).filter(|v| v.starts_with('{')).map(str::to_string),
            _ => {}
        }
    }
    if !seen {
        return Err("The host's shell gave no answer to the platform probe".into());
    }
    Ok(probe)
}

/// The dist/ binary for `uname -sm`.
pub fn binary_for(os: &str, arch: &str) -> Result<&'static str, String> {
    match (os, arch) {
        ("Linux", "x86_64" | "amd64") => Ok("acp-harness-daemon-linux-x64"),
        ("Linux", "aarch64" | "arm64") => Ok("acp-harness-daemon-linux-arm64"),
        _ => Err(format!("SSH hosts running {os} {arch} are not supported yet (Linux x64 and arm64 are)")),
    }
}

/// Turns ssh's stderr into what the user should do about it.
pub fn describe_ssh_failure(stderr: &str, alias: &str) -> String {
    let has = |needle: &str| stderr.contains(needle);
    if has("Host key verification failed") || has("REMOTE HOST IDENTIFICATION HAS CHANGED") {
        return format!(
            "The host key of {alias} is not trusted yet, or it changed. Run `ssh {alias}` once in a terminal to check and accept it."
        );
    }
    if has("Permission denied") || has("passphrase") || has("Too many authentication failures") {
        return format!(
            "{alias} asked for a password or key passphrase, which this app never handles. Set up key authentication \
             (ssh-copy-id, or load the key into ssh-agent) so `ssh {alias}` connects without a prompt."
        );
    }
    let last = stderr
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with("Warning: Permanently added"))
        .last();
    if has("Could not resolve hostname") {
        return format!("Could not resolve {alias}: {}", last.unwrap_or_default());
    }
    match last {
        Some(line) => format!("ssh {alias}: {line}"),
        None => format!("ssh {alias} failed without a message"),
    }
}

/// What a failure says about the remote daemon: `live`, `exited`, or `unverifiable` when the host
/// could not be reached — loss of contact is never evidence the daemon died.
#[derive(Debug, PartialEq)]
pub struct HostError {
    pub verdict: Option<&'static str>,
    pub reason: String,
}

impl HostError {
    fn unverifiable(reason: String) -> Self {
        Self { verdict: Some("unverifiable"), reason }
    }
    pub fn to_json(&self) -> String {
        serde_json::json!({ "verdict": self.verdict, "reason": self.reason }).to_string()
    }
}

#[derive(Debug, PartialEq)]
pub enum RemoteError {
    /// ssh itself failed (exit 255, spawn error, timeout): the host was not reached.
    NoContact(String),
    /// The host answered but the script failed.
    Script(String),
}

/// Runs a shell script on a host. The real one is ssh; tests use a local `sh`.
pub trait Transport {
    fn run(&self, script: &str, args: &[&str], upload: Option<&Path>, timeout: Duration) -> Result<String, RemoteError>;
}

/// `ssh` from PATH, else Windows' bundled OpenSSH (absent from PATH in some app launch contexts).
fn ssh_program() -> PathBuf {
    let exe = if cfg!(windows) { "ssh.exe" } else { "ssh" };
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let candidate = dir.join(exe);
            if candidate.is_file() {
                return candidate;
            }
        }
    }
    #[cfg(windows)]
    if let Some(root) = std::env::var_os("SystemRoot") {
        let bundled = PathBuf::from(root).join(r"System32\OpenSSH\ssh.exe");
        if bundled.is_file() {
            return bundled;
        }
    }
    PathBuf::from(exe)
}

/// Runs `command` to completion with stdin fed from `upload`, killing it after `timeout`.
fn run_with_timeout(
    mut command: std::process::Command,
    upload: Option<&Path>,
    timeout: Duration,
) -> Result<(Option<i32>, String, String), String> {
    command
        .stdin(if upload.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|e| format!("could not run ssh: {e}"))?;
    if let (Some(path), Some(mut stdin)) = (upload, child.stdin.take()) {
        let mut file = std::fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
        // A remote that fails early closes the pipe; its exit status says why.
        std::thread::spawn(move || {
            let _ = std::io::copy(&mut file, &mut stdin);
        });
    }
    let stdout = drain_full(child.stdout.take());
    let stderr = drain_full(child.stderr.take());
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(e) => return Err(e.to_string()),
        }
    };
    let out = stdout.join().unwrap_or_default();
    let err = stderr.join().unwrap_or_default();
    match status {
        Some(status) => Ok((status.code(), out, err)),
        None => Err(format!("timed out after {}s", timeout.as_secs())),
    }
}

fn drain_full(pipe: Option<impl Read + Send + 'static>) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut out = Vec::new();
        if let Some(mut pipe) = pipe {
            let _ = pipe.read_to_end(&mut out);
        }
        String::from_utf8_lossy(&out).to_string()
    })
}

pub struct SshTransport<'a> {
    pub dest: &'a Destination,
}

impl Transport for SshTransport<'_> {
    fn run(&self, script: &str, args: &[&str], upload: Option<&Path>, timeout: Duration) -> Result<String, RemoteError> {
        let remote = remote_command(script, args);
        let mut command = hidden(&ssh_program().to_string_lossy());
        command.args(ssh_argv(self.dest, &["-T"], Some(&remote)));
        // Never fall back to a GUI askpass either.
        command.env("SSH_ASKPASS_REQUIRE", "never");
        match run_with_timeout(command, upload, timeout) {
            Err(e) => Err(RemoteError::NoContact(format!("ssh {}: {e}", self.dest.host))),
            Ok((Some(0), out, _)) => Ok(out),
            Ok((Some(255) | None, _, err)) => Err(RemoteError::NoContact(describe_ssh_failure(&err, &self.dest.host))),
            Ok((code, _, err)) => {
                let detail = err.trim();
                Err(RemoteError::Script(if detail.is_empty() {
                    format!("the remote command exited with {}", code.unwrap_or(-1))
                } else {
                    detail.to_string()
                }))
            }
        }
    }
}

pub struct Prepared {
    pub info: String,
    /// The probe found a daemon record whose process was gone, so this start replaced it.
    pub previous_exited: bool,
    pub platform: String,
}

/// Probe, upload when the stamp differs, and start the daemon when it is not running.
pub fn prepare_daemon(
    transport: &dyn Transport,
    source_for: impl Fn(&str) -> Result<PathBuf, String>,
) -> Result<Prepared, HostError> {
    let probe = transport
        .run(PROBE_SCRIPT, &[], None, Duration::from_secs(40))
        .map_err(|e| match e {
            RemoteError::NoContact(reason) => HostError::unverifiable(reason),
            RemoteError::Script(reason) => HostError { verdict: None, reason },
        })
        .and_then(|out| parse_probe(&out).map_err(|reason| HostError { verdict: None, reason }))?;
    // Past the probe, the host answered: its daemon's state is known.
    let known = if probe.alive { "live" } else { "exited" };
    let fail = |e: RemoteError| match e {
        RemoteError::NoContact(reason) => HostError::unverifiable(reason),
        RemoteError::Script(reason) => HostError { verdict: Some(known), reason },
    };
    let platform = format!("{} {}", probe.os, probe.arch);
    let name = binary_for(&probe.os, &probe.arch).map_err(|reason| HostError { verdict: Some(known), reason })?;
    let source = source_for(name).map_err(|reason| HostError { verdict: Some(known), reason })?;
    let build = stamp(&source).map_err(|reason| HostError { verdict: Some(known), reason })?;
    let upgrade = probe.stamp != build;

    if !upgrade && probe.alive {
        if let Some(info) = probe.info {
            return Ok(Prepared { info, previous_exited: false, platform });
        }
    }
    if upgrade {
        let size = std::fs::metadata(&source).map(|m| m.len().to_string()).unwrap_or_default();
        transport
            .run(INSTALL_SCRIPT, &[&build, &size], Some(&source), Duration::from_secs(15 * 60))
            .map_err(fail)?;
    }
    let out = transport.run(START_SCRIPT, &[], None, Duration::from_secs(60)).map_err(|e| match e {
        RemoteError::NoContact(reason) => HostError::unverifiable(reason),
        RemoteError::Script(reason) => HostError { verdict: Some("exited"), reason },
    })?;
    let info = parse_probe(&out)
        .ok()
        .and_then(|p| p.info)
        .ok_or_else(|| HostError { verdict: Some("exited"), reason: "The daemon started without a connection record".into() })?;
    Ok(Prepared { info, previous_exited: probe.info.is_some() && !probe.alive, platform })
}

/// The remote record with its url pointed at the local end of the tunnel.
pub fn tunneled_info(info: &str, local_port: u16, previous_exited: bool, platform: &str) -> Result<String, String> {
    let mut value: serde_json::Value = serde_json::from_str(info).map_err(|e| format!("daemon record: {e}"))?;
    let object = value.as_object_mut().ok_or("daemon record is not an object")?;
    object.insert("url".into(), format!("ws://127.0.0.1:{local_port}/acp").into());
    object.insert("daemon".into(), "live".into());
    object.insert("previousExited".into(), previous_exited.into());
    object.insert("platform".into(), platform.into());
    Ok(value.to_string())
}

/// A loopback port relaying each accepted connection through its own `ssh -W` to the daemon.
struct Tunnel {
    local_port: u16,
    remote_port: u16,
    closed: Arc<AtomicBool>,
    children: Arc<Mutex<Vec<Child>>>,
}

impl Tunnel {
    fn usable_for(&mut self, remote_port: u16) -> bool {
        self.remote_port == remote_port && !self.closed.load(Ordering::SeqCst) && reachable(self.local_port)
    }
    fn close(self) {
        self.closed.store(true, Ordering::SeqCst);
        // Wakes the blocking accept so the relay thread sees `closed` and exits.
        let _ = TcpStream::connect(("127.0.0.1", self.local_port));
        if let Ok(mut children) = self.children.lock() {
            for mut child in children.drain(..) {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

static TUNNELS: LazyLock<Mutex<HashMap<String, Tunnel>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
/// Per-host, so a slow host never holds up connecting another.
static LOCKS: LazyLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
/// Hosts this app ensured a daemon on, to stop on quit.
static USED: Mutex<Vec<String>> = Mutex::new(Vec::new());
/// The daemon pid each host last served this app; a cleanly stopped daemon deletes its record,
/// so a new pid is the only sign the old one (and its terminals) went away.
static LAST_PIDS: LazyLock<Mutex<HashMap<String, u64>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn pid_of(info: &str) -> Option<u64> {
    serde_json::from_str::<serde_json::Value>(info).ok()?.get("pid")?.as_u64()
}

/// Pipes one local socket through `ssh -W` to the daemon; ends when either side closes.
fn relay_connection(socket: TcpStream, dest: &Destination, remote_port: u16, children: &Mutex<Vec<Child>>) {
    let target = format!("127.0.0.1:{remote_port}");
    let mut command = hidden(&ssh_program().to_string_lossy());
    command
        .args(ssh_argv(dest, &["-W", &target], None))
        .env("SSH_ASKPASS_REQUIRE", "never")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let Ok(mut child) = command.spawn() else { return };
    let (Some(mut to_ssh), Some(mut from_ssh)) = (child.stdin.take(), child.stdout.take()) else {
        let _ = child.kill();
        return;
    };
    let (Ok(mut socket_read), mut socket_write) = (socket.try_clone(), socket) else { return };
    if let Ok(mut list) = children.lock() {
        list.retain_mut(|c| matches!(c.try_wait(), Ok(None)));
        list.push(child);
    }
    std::thread::spawn(move || {
        let _ = std::io::copy(&mut socket_read, &mut to_ssh);
    });
    std::thread::spawn(move || {
        let _ = std::io::copy(&mut from_ssh, &mut socket_write);
        let _ = socket_write.shutdown(Shutdown::Both);
    });
}

/// Listens on a free loopback port and relays each connection to the daemon's port on the host.
fn open_tunnel(dest: &Destination, remote_port: u16) -> Result<Tunnel, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| format!("no free local port: {e}"))?;
    let local_port = listener.local_addr().map(|a| a.port()).map_err(|e| e.to_string())?;
    let closed = Arc::new(AtomicBool::new(false));
    let children: Arc<Mutex<Vec<Child>>> = Arc::default();
    let (dest, stop, active) = (dest.clone(), closed.clone(), children.clone());
    std::thread::spawn(move || {
        for socket in listener.incoming() {
            if stop.load(Ordering::SeqCst) {
                break;
            }
            if let Ok(socket) = socket {
                relay_connection(socket, &dest, remote_port, &active);
            }
        }
    });
    Ok(Tunnel { local_port, remote_port, closed, children })
}

/// Ensures a daemon runs on `target` and returns its connection JSON with a tunneled url. Errors are
/// JSON `{verdict, reason}` so the UI can say whether the remote daemon is live, exited or unknown.
pub fn ensure(target: &str) -> Result<String, String> {
    let dest = Destination::parse(target).map_err(|reason| HostError { verdict: None, reason }.to_json())?;
    let lock = {
        let mut locks = LOCKS.lock().map_err(|e| e.to_string())?;
        locks.entry(target.to_string()).or_default().clone()
    };
    let _held = lock.lock().map_err(|e| e.to_string())?;
    if let Ok(mut used) = USED.lock() {
        if !used.iter().any(|t| t == target) {
            used.push(target.to_string());
        }
    }
    let prepared = prepare_daemon(&SshTransport { dest: &dest }, built_binary).map_err(|e| e.to_json())?;
    let remote_port = port_of(&prepared.info)
        .ok_or_else(|| HostError { verdict: Some("live"), reason: "The daemon record has no port".into() }.to_json())?;

    let mut tunnels = TUNNELS.lock().map_err(|e| e.to_string())?;
    let reuse = tunnels.get_mut(target).is_some_and(|t| t.usable_for(remote_port));
    if !reuse {
        if let Some(old) = tunnels.remove(target) {
            old.close();
        }
        // The probe just saw the daemon running; only the path to it failed.
        let tunnel = open_tunnel(&dest, remote_port)
            .map_err(|reason| HostError { verdict: Some("live"), reason }.to_json())?;
        tunnels.insert(target.to_string(), tunnel);
    }
    let local_port = tunnels.get(target).map(|t| t.local_port).ok_or("tunnel vanished")?;
    let replaced = match (pid_of(&prepared.info), LAST_PIDS.lock()) {
        (Some(pid), Ok(mut last)) => last.insert(target.to_string(), pid).is_some_and(|old| old != pid),
        _ => false,
    };
    tunneled_info(&prepared.info, local_port, prepared.previous_exited || replaced, &prepared.platform)
}

/// Closes the tunnel; the remote daemon keeps running so its terminals and agent turns survive.
pub fn disconnect(target: &str) {
    if let Some(tunnel) = TUNNELS.lock().ok().and_then(|mut t| t.remove(target)) {
        tunnel.close();
    }
}

/// On quit: stop the daemons this app used (in parallel, bounded) and close every tunnel.
pub fn shutdown() {
    let targets = USED.lock().map(|u| u.clone()).unwrap_or_default();
    let stops: Vec<_> = targets
        .into_iter()
        .filter_map(|target| Destination::parse(&target).ok())
        .map(|dest| {
            std::thread::spawn(move || {
                let _ = SshTransport { dest: &dest }.run(STOP_SCRIPT, &[], None, Duration::from_secs(8));
            })
        })
        .collect();
    for stop in stops {
        let _ = stop.join();
    }
    let tunnels: Vec<Tunnel> = TUNNELS.lock().map(|mut t| t.drain().map(|(_, v)| v).collect()).unwrap_or_default();
    for tunnel in tunnels {
        tunnel.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_destinations() {
        assert_eq!(Destination::parse("dgx").unwrap(), Destination { host: "dgx".into(), port: None });
        assert_eq!(
            Destination::parse(" ssh://me@box.example:2222/ ").unwrap(),
            Destination { host: "me@box.example".into(), port: Some(2222) }
        );
        assert_eq!(Destination::parse("me@[fe80::1]:22").unwrap(), Destination { host: "me@fe80::1".into(), port: Some(22) });
        assert_eq!(Destination::parse("fe80::1").unwrap(), Destination { host: "fe80::1".into(), port: None });
        for bad in ["", "-oProxyCommand=x", "a b", "me@", "host:0", "host:x", "a;b", "$(x)"] {
            assert!(Destination::parse(bad).is_err(), "{bad} should be rejected");
        }
    }

    #[test]
    fn vscode_needs_an_alias_for_custom_ports() {
        assert_eq!(Destination::parse("me@h").unwrap().vscode_authority(), Ok("me@h"));
        assert_eq!(Destination::parse("me@h:22").unwrap().vscode_authority(), Ok("me@h"));
        assert!(Destination::parse("me@h:2222").unwrap().vscode_authority().is_err());
    }

    #[test]
    fn builds_argv_with_options_before_the_destination() {
        let dest = Destination::parse("me@h:2200").unwrap();
        let argv = ssh_argv(&dest, &["-N", "-L", "127.0.0.1:5:127.0.0.1:6"], None);
        let tail: Vec<&str> = argv.iter().map(String::as_str).skip(COMMON_OPTIONS.len()).collect();
        assert_eq!(tail, ["-N", "-L", "127.0.0.1:5:127.0.0.1:6", "-p", "2200", "--", "me@h"]);
        assert!(argv.windows(2).any(|w| w[0] == "-o" && w[1] == "BatchMode=yes"));
        let with_command = ssh_argv(&Destination::parse("dgx").unwrap(), &["-T"], Some("echo hi"));
        assert_eq!(with_command.last().map(String::as_str), Some("echo hi"));
    }

    #[test]
    fn quotes_remote_commands() {
        assert_eq!(posix_quote("it's"), r"'it'\''s'");
        assert_eq!(remote_command("echo \"$1\"", &["a b", "c'd"]), r#"sh -c 'echo "$1"' sh 'a b' 'c'\''d'"#);
    }

    #[test]
    fn parses_probe_output_through_noise() {
        let out = "Welcome!\n@acp:os=Linux\r\n@acp:arch=aarch64\n@acp:stamp=12-34\n@acp:alive=yes\n@acp:info={\"url\":\"ws://127.0.0.1:4100/acp\"}\n";
        let probe = parse_probe(out).unwrap();
        assert_eq!(
            probe,
            Probe {
                os: "Linux".into(),
                arch: "aarch64".into(),
                stamp: "12-34".into(),
                alive: true,
                info: Some("{\"url\":\"ws://127.0.0.1:4100/acp\"}".into())
            }
        );
        assert_eq!(parse_probe("@acp:os=Linux\n@acp:info=\n").unwrap().info, None);
        assert!(parse_probe("motd only\n").is_err());
    }

    #[test]
    fn maps_platforms_to_binaries() {
        assert_eq!(binary_for("Linux", "x86_64"), Ok("acp-harness-daemon-linux-x64"));
        assert_eq!(binary_for("Linux", "aarch64"), Ok("acp-harness-daemon-linux-arm64"));
        assert!(binary_for("Darwin", "arm64").is_err());
    }

    #[test]
    fn explains_ssh_failures() {
        assert!(describe_ssh_failure("me@h: Permission denied (publickey).", "h").contains("key authentication"));
        assert!(describe_ssh_failure("Host key verification failed.", "h").contains("ssh h"));
        assert!(describe_ssh_failure("ssh: Could not resolve hostname nope: No such host", "nope").starts_with("Could not resolve"));
        assert_eq!(
            describe_ssh_failure("ssh: connect to host h port 22: Connection timed out\n", "h"),
            "ssh h: ssh: connect to host h port 22: Connection timed out"
        );
    }

    #[test]
    fn rewrites_the_url_to_the_tunnel() {
        let info = r#"{"url":"ws://127.0.0.1:41234/acp","token":"t","protocolPrefix":"p","pid":7}"#;
        let out: serde_json::Value = serde_json::from_str(&tunneled_info(info, 5555, true, "Linux x86_64").unwrap()).unwrap();
        assert_eq!(out["url"], "ws://127.0.0.1:5555/acp");
        assert_eq!(out["token"], "t");
        assert_eq!(out["previousExited"], true);
        assert_eq!(port_of(info), Some(41234));
    }

    /// A fake host: the same scripts run by a local `sh` against a temporary HOME.
    struct LocalSh {
        home: PathBuf,
        sh: PathBuf,
    }

    impl Transport for LocalSh {
        fn run(&self, script: &str, args: &[&str], upload: Option<&Path>, timeout: Duration) -> Result<String, RemoteError> {
            let mut command = std::process::Command::new(&self.sh);
            command.arg("-c").arg(script).arg("sh").args(args).env("HOME", &self.home).env("SHELL", &self.sh);
            match run_with_timeout(command, upload, timeout) {
                Ok((Some(0), out, _)) => Ok(out),
                Ok((_, _, err)) => Err(RemoteError::Script(err)),
                Err(e) => Err(RemoteError::NoContact(e)),
            }
        }
    }

    fn local_sh() -> Option<PathBuf> {
        std::env::split_paths(&std::env::var_os("PATH")?)
            .map(|d| d.join(if cfg!(windows) { "sh.exe" } else { "sh" }))
            .find(|p| p.is_file())
    }

    struct NoHost;
    impl Transport for NoHost {
        fn run(&self, _: &str, _: &[&str], _: Option<&Path>, _: Duration) -> Result<String, RemoteError> {
            Err(RemoteError::NoContact("ssh h: Connection timed out".into()))
        }
    }

    #[test]
    fn unreachable_host_is_unverifiable_not_exited() {
        let err = prepare_daemon(&NoHost, |_| Err("unused".into())).err().unwrap();
        assert_eq!(err.verdict, Some("unverifiable"));
    }

    #[test]
    fn installs_starts_and_reuses_through_a_fake_host() {
        let Some(sh) = local_sh() else { return };
        let root = std::env::temp_dir().join(format!("acp-ssh-daemon-test-{}", std::process::id()));
        let home = root.join("home");
        std::fs::create_dir_all(&home).unwrap();
        // A stand-in daemon: records its connection like the real one, then exits.
        let fake = root.join("fake-daemon");
        std::fs::write(
            &fake,
            "#!/bin/sh\nprintf '{\"url\":\"ws://127.0.0.1:4321/acp\",\"token\":\"t\",\"protocolPrefix\":\"p\",\"pid\":%s}' $$ > \"$HOME/.acp-harness/daemon.json\"\n",
        )
        .unwrap();
        let host = LocalSh { home: home.clone(), sh };
        let uname = host.run("uname -sm", &[], None, Duration::from_secs(10)).unwrap();
        let mut parts = uname.split_whitespace();
        let (os, arch) = (parts.next().unwrap_or("").to_string(), parts.next().unwrap_or("").to_string());
        // Pretend the fake host is Linux x64 whatever this machine is, by answering for its uname.
        let source_for = |_: &str| Ok(fake.clone());
        let supported = binary_for(&os, &arch).is_ok();

        if supported {
            let first = prepare_daemon(&host, source_for).unwrap_or_else(|e| panic!("{}", e.reason));
            assert_eq!(port_of(&first.info), Some(4321));
            assert!(!first.previous_exited);
            let installed = home.join(".acp-harness/bin/acp-harness-daemon");
            assert_eq!(std::fs::read(&installed).unwrap(), std::fs::read(&fake).unwrap());
            assert_eq!(
                std::fs::read_to_string(installed.with_extension("stamp")).unwrap().trim(),
                stamp(&fake).unwrap()
            );
            // The fake exited, so the next ensure finds a stale record and restarts without uploading.
            let second = prepare_daemon(&host, source_for).unwrap_or_else(|e| panic!("{}", e.reason));
            assert!(second.previous_exited);
        } else {
            // Not Linux (Windows' Git sh, macOS): the scripts still run and the probe still parses.
            let out = host.run(PROBE_SCRIPT, &[], None, Duration::from_secs(10)).unwrap();
            let probe = parse_probe(&out).unwrap();
            assert_eq!(probe.os, os);
            assert!(!probe.alive);
            let err = prepare_daemon(&host, source_for).err().unwrap();
            assert_eq!(err.verdict, Some("exited"));
            host.run(INSTALL_SCRIPT, &["s1", &std::fs::metadata(&fake).unwrap().len().to_string()], Some(&fake), Duration::from_secs(20))
                .unwrap();
            let out = host.run(START_SCRIPT, &[], None, Duration::from_secs(40)).unwrap_or_else(|e| panic!("{e:?}"));
            assert_eq!(parse_probe(&out).unwrap().info.as_deref().and_then(port_of), Some(4321));
            let truncated = host.run(INSTALL_SCRIPT, &["s2", "999999999"], Some(&fake), Duration::from_secs(20));
            assert!(matches!(truncated, Err(RemoteError::Script(e)) if e.contains("upload incomplete")));
        }
        let _ = std::fs::remove_dir_all(&root);
    }
}
