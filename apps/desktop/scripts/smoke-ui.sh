#!/usr/bin/env bash
# End-to-end UI check against a running `bun run tauri:debug` + daemon. Usage: scripts/smoke-ui.sh <folder> "<prompt>"
# NEW_SESSION=1 opens a fresh session; AUTO_ALLOW=1 answers approval cards with "allow".
set -euo pipefail
cd "$(dirname "$0")/.."
cdp() { bun scripts/cdp.ts "$@"; }
status() { cdp eval "document.querySelector('[data-worktree-card-active] ')?.dataset.sessionStatus"; }

if [ -n "${NEW_SESSION:-}" ]; then
  cdp eval "location.reload()" >/dev/null; sleep 3
  cdp eval "window.__harness.createSession($(printf '%s' "$1" | bun -e 'console.log(JSON.stringify(await Bun.stdin.text()))')).then(()=>'session ok')"
fi
cdp type 'textarea[aria-label="Message the agent"]' "$2"
cdp click 'button[aria-label="Send"]'
s='""'
for _ in $(seq 1 120); do
  s=$(status)
  case "$s" in
    '"idle"'|'"error"') break ;;
    '"needs-you"') [ -n "${AUTO_ALLOW:-}" ] && cdp click '[data-approval-option="allow"]' || true ;;
  esac
  sleep 2
done
echo "status=$s"
cdp eval "document.querySelector('.native-chat-appearance').innerText.slice(-1500)"
