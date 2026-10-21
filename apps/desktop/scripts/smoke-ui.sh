#!/usr/bin/env bash
# End-to-end UI check against a running `bun run tauri:debug` + daemon. Usage: scripts/smoke-ui.sh "<prompt>"
#   NEW_SESSION=1  opens a fresh Claude tab first
#   TARGET=playground (default) runs in C:\dev\harness-playground; TARGET=floating uses the floating workspace
#   AUTO_ALLOW=1   answers approval cards with "allow"
set -euo pipefail
cd "$(dirname "$0")/.."
cdp() { bun scripts/cdp.ts "$@"; }
last='window.__harness.state().sessions.at(-1)'
target="${TARGET:-playground}"

if [ "$target" = floating ]; then
  scope='[data-floating-workspace]'
else
  scope='main'
fi

if [ -n "${NEW_SESSION:-}" ]; then
  cdp eval "location.reload()" >/dev/null; sleep 4
  if [ "$target" = floating ]; then
    workspace='window.__harness.state().harness.floatingWorkspaceId'
    cdp eval "if (!window.__harness.state().floating.open) window.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyA', ctrlKey:true, metaKey:true, altKey:true})); 'ok'" >/dev/null
  else
    id=$(cd ../../packages/daemon && bun scripts/ensure-playground.ts | bun -e 'console.log(JSON.parse(await Bun.stdin.text()).workspaceId)')
    workspace="'$id'"
    cdp eval "if (window.__harness.state().floating.open) window.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyA', ctrlKey:true, metaKey:true, altKey:true})); window.__harness.selectWorkspace('$id'); 'ok'" >/dev/null
  fi
  cdp eval "window.__harness.createSession($workspace).then(()=>'session ok')"
  sleep 1
fi
cdp type "$scope textarea[aria-label=\"Message the agent\"]" "$1"
cdp click "$scope button[aria-label=\"Send\"]"
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
cdp eval "document.querySelector('$scope .native-chat-appearance').innerText.slice(-1500)"
