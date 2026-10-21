#!/usr/bin/env bash
# End-to-end UI check against a running `bun run tauri:debug` + daemon. Usage: scripts/smoke-ui.sh <folder> "<prompt>"
set -euo pipefail
cd "$(dirname "$0")/.."
cdp() { bun scripts/cdp.ts "$@"; }
status() { cdp eval "document.querySelector('.row-active .row-meta, .row .row-meta')?.textContent"; }

if [ -n "${NEW_SESSION:-}" ]; then
  cdp eval "location.reload()" >/dev/null; sleep 3
  cdp eval "window.__harness.createSession($(printf '%s' "$1" | bun -e 'console.log(JSON.stringify(await Bun.stdin.text()))')).then(()=>'session ok')"
fi
cdp type ".composer-input" "$2"
cdp click ".composer .button-primary"
for _ in $(seq 1 90); do
  s=$(status)
  case "$s" in
    '"Idle"'|'"Error"') break ;;
    '"Needs you"') [ -n "${AUTO_ALLOW:-}" ] && cdp click ".permission .button-primary" || true ;;
  esac
  sleep 2
done
echo "status=$s"
cdp eval "[...document.querySelectorAll('.thread-body > *')].slice(-8).map(e=>e.className+': '+e.textContent.replace(/\s+/g,' ').slice(0,160))"
