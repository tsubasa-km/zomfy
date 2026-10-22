//! Reads the concrete `Host` aliases from the user's OpenSSH config (read-only), the list VS Code's
//! Remote-SSH and Orca's host picker offer. Wildcard and negated patterns are not hosts one can
//! connect to, so they are left out; `Include` files are inlined first, as OpenSSH reads them.

use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SshConfigHost {
    pub alias: String,
    pub hostname: Option<String>,
    pub user: Option<String>,
    pub port: Option<u16>,
}

/// OpenSSH's `argv_split`: whitespace-separated, `"`/`'` group, a backslash escapes only quotes,
/// backslashes and (unquoted) spaces — so Windows paths keep theirs — and an unquoted `#` at the
/// start of an argument ends the line.
pub fn split_args(input: &str) -> Vec<String> {
    let chars: Vec<char> = input.chars().collect();
    let mut args = Vec::new();
    let mut current = String::new();
    let mut started = false;
    let mut quote: Option<char> = None;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        if quote.is_none() && c.is_whitespace() {
            if started {
                args.push(std::mem::take(&mut current));
                started = false;
            }
        } else if quote.is_none() && !started && c == '#' {
            break;
        } else if c == '\\' && (matches!(next, Some('\'' | '"' | '\\')) || (quote.is_none() && next == Some(' '))) {
            current.extend(next);
            started = true;
            i += 1;
        } else if quote == Some(c) {
            quote = None;
        } else if quote.is_none() && (c == '"' || c == '\'') {
            quote = Some(c);
            started = true;
        } else {
            current.push(c);
            started = true;
        }
        i += 1;
    }
    if started {
        args.push(current);
    }
    args
}

/// `Key value` or `Key=value`, with the key lowercased.
fn directive(line: &str) -> Option<(String, &str)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let split = line.find(|c: char| c.is_whitespace() || c == '=')?;
    let (key, rest) = line.split_at(split);
    let value = rest.trim_start().strip_prefix('=').unwrap_or(rest).trim();
    Some((key.to_ascii_lowercase(), value))
}

/// Parses already-inlined config text. OpenSSH keeps the first value of a repeated setting.
pub fn parse(content: &str) -> Vec<SshConfigHost> {
    let mut hosts: Vec<SshConfigHost> = Vec::new();
    let mut current: Vec<usize> = Vec::new();
    for line in content.lines() {
        let Some((key, value)) = directive(line) else { continue };
        match key.as_str() {
            "host" => {
                current.clear();
                for pattern in split_args(value) {
                    if pattern.starts_with('!') || pattern.contains(['*', '?']) {
                        continue;
                    }
                    if let Some(i) = hosts.iter().position(|h| h.alias == pattern) {
                        current.push(i);
                    } else {
                        hosts.push(SshConfigHost { alias: pattern, hostname: None, user: None, port: None });
                        current.push(hosts.len() - 1);
                    }
                }
            }
            "match" => current.clear(),
            "hostname" | "user" | "port" => {
                let Some(first) = split_args(value).into_iter().next() else { continue };
                for &i in &current {
                    let host = &mut hosts[i];
                    match key.as_str() {
                        "hostname" => {
                            host.hostname.get_or_insert_with(|| first.clone());
                        }
                        "user" => {
                            host.user.get_or_insert_with(|| first.clone());
                        }
                        _ => {
                            if host.port.is_none() {
                                host.port = first.parse().ok();
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
    hosts
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from)
}

/// Include paths: `~/` is home, relative paths are under ~/.ssh, `*`/`?` may appear in the file name.
fn include_targets(pattern: &str, ssh_dir: &Path) -> Vec<PathBuf> {
    let expanded = match pattern.strip_prefix("~/").or_else(|| pattern.strip_prefix("~\\")) {
        Some(rest) => ssh_dir.parent().map(|home| home.join(rest)).unwrap_or_else(|| PathBuf::from(pattern)),
        None => {
            let path = PathBuf::from(pattern);
            if path.is_absolute() { path } else { ssh_dir.join(path) }
        }
    };
    let name = expanded.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    if !name.contains(['*', '?']) {
        return vec![expanded];
    }
    let Some(dir) = expanded.parent() else { return vec![] };
    let mut matches: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| glob_match(&name, &e.file_name().to_string_lossy()))
                .map(|e| e.path())
                .collect()
        })
        .unwrap_or_default();
    matches.sort();
    matches
}

pub fn glob_match(pattern: &str, text: &str) -> bool {
    fn go(p: &[char], t: &[char]) -> bool {
        match p.first() {
            None => t.is_empty(),
            Some('*') => go(&p[1..], t) || (!t.is_empty() && go(p, &t[1..])),
            Some('?') => !t.is_empty() && go(&p[1..], &t[1..]),
            Some(c) => t.first() == Some(c) && go(&p[1..], &t[1..]),
        }
    }
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    go(&p, &t)
}

/// Reads `path` with its `Include`s inlined; depth-limited like OpenSSH's own recursion guard.
fn read_inlined(path: &Path, ssh_dir: &Path, depth: u8, out: &mut String) {
    if depth > 16 {
        return;
    }
    let Ok(content) = std::fs::read_to_string(path) else { return };
    for line in content.lines() {
        match directive(line) {
            Some((key, value)) if key == "include" => {
                for pattern in split_args(value) {
                    for target in include_targets(&pattern, ssh_dir) {
                        read_inlined(&target, ssh_dir, depth + 1, out);
                    }
                }
            }
            _ => {
                out.push_str(line);
                out.push('\n');
            }
        }
    }
}

/// The aliases in ~/.ssh/config; an absent or unreadable config is simply empty.
pub fn load_user_hosts() -> Vec<SshConfigHost> {
    let Some(home) = home_dir() else { return vec![] };
    let ssh_dir = home.join(".ssh");
    let mut content = String::new();
    read_inlined(&ssh_dir.join("config"), &ssh_dir, 0, &mut content);
    parse(&content)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_concrete_aliases_and_first_values() {
        let hosts = parse(
            "Host *\n  User everyone\n\
             Host box box-alt *.corp !bad\n  HostName 10.0.0.5\n  User alice\n  Port 2222\n  User ignored\n\
             Host=eq\n  Hostname=eq.example # trailing comment\n\
             Match host foo\n  User matched\n\
             Host \"quoted name\"\n",
        );
        assert_eq!(
            hosts,
            vec![
                SshConfigHost { alias: "box".into(), hostname: Some("10.0.0.5".into()), user: Some("alice".into()), port: Some(2222) },
                SshConfigHost { alias: "box-alt".into(), hostname: Some("10.0.0.5".into()), user: Some("alice".into()), port: Some(2222) },
                SshConfigHost { alias: "eq".into(), hostname: Some("eq.example".into()), user: None, port: None },
                SshConfigHost { alias: "quoted name".into(), hostname: None, user: None, port: None },
            ]
        );
    }

    #[test]
    fn settings_after_match_do_not_leak_into_previous_host() {
        let hosts = parse("Host a\nMatch all\n  User leaked\n");
        assert_eq!(hosts[0].user, None);
    }

    #[test]
    fn repeated_host_block_keeps_first_value() {
        let hosts = parse("Host a\n  Port 1\nHost a\n  Port 2\n  User u\n");
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].port, Some(1));
        assert_eq!(hosts[0].user.as_deref(), Some("u"));
    }

    #[test]
    fn splits_quoted_arguments() {
        assert_eq!(split_args(r#""C:\Program Files\x" b # c"#), vec![r"C:\Program Files\x", "b"]);
        assert_eq!(split_args(r#"a\ b 'c d' e\"f"#), vec!["a b", "c d", "e\"f"]);
        assert_eq!(split_args("a#b"), vec!["a#b"]);
        assert_eq!(split_args(r#""C:/Users/me/ssh config" other"#), vec!["C:/Users/me/ssh config", "other"]);
    }

    #[test]
    fn globs_file_names() {
        assert!(glob_match("*.conf", "work.conf"));
        assert!(glob_match("host?", "host1"));
        assert!(!glob_match("*.conf", "work.conf.bak"));
    }

    #[test]
    fn inlines_includes_relative_to_ssh_dir() {
        let dir = std::env::temp_dir().join(format!("acp-ssh-config-test-{}", std::process::id()));
        let ssh_dir = dir.join(".ssh");
        std::fs::create_dir_all(ssh_dir.join("conf.d")).unwrap();
        std::fs::write(ssh_dir.join("config"), "Include conf.d/*.conf\nHost main\n").unwrap();
        std::fs::write(ssh_dir.join("conf.d").join("a.conf"), "Host included\n  User inc\n").unwrap();
        let mut content = String::new();
        read_inlined(&ssh_dir.join("config"), &ssh_dir, 0, &mut content);
        let aliases: Vec<String> = parse(&content).into_iter().map(|h| h.alias).collect();
        assert_eq!(aliases, vec!["included", "main"]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
