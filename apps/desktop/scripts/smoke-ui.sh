#!/usr/bin/env bash
# End-to-end UI check against a running `bun run tauri:debug` + daemon. Usage: scripts/smoke-ui.sh "<prompt>"
# NEW_SESSION=1 opens a fresh Claude tab in the floating workspace; AUTO_ALLOW=1 answers approvals with "allow".
set -euo pipefail
cd "$(dirname "$0")/.."
cdp() { bun scripts/cdp.ts "$@"; }
last='window.__harness.state().sessions.at(-1)'

if [ -n "${NEW_SESSION:-}" ]; then
  cdp eval "location.reload()" >/dev/null; sleep 4
  cdp eval "window.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyA', ctrlKey:true, metaKey:true, altKey:true})); window.__harness.createSession(window.__harness.state().harness.floatingWorkspaceId).then(()=>'session ok')"
  sleep 1
fi
cdp type '[data-floating-workspace] textarea[aria-label="Message the agent"]' "$1"
cdp click '[data-floating-workspace] button[aria-label="Send"]'
s='""'
for _ in $(seq 1 120); do
  s=$(cdp eval "$last?.status")
  case "$s" in
    '"idle"'|'"error"') break ;;
    '"needs-you"') [ -n "${AUTO_ALLOW:-}" ] && cdp click '[data-approval-option="allow"]' || true ;;
  esac
  sleep 2
done
echo "status=$s"
cdp eval "document.querySelector('[data-floating-workspace] .native-chat-appearance').innerText.slice(-1500)"
