# Zomfy for Android

The phone app (docs/specs/mobile/app.md). It pairs with a Zomfy host over the LAN or a tailnet
(phase M1); the relay and push come later.

## Try it

1. In Zomfy, open Settings → Devices and turn on **Let phones connect**. Windows asks once whether
   the daemon may accept connections on private networks; allow it.
2. Run the app:
   - **Expo Go** (quickest): install Expo Go on the phone, run `bun run start` here, and scan the
     terminal's QR code with Expo Go. The phone must be on the same Wi-Fi or tailnet as the computer.
   - **Android Emulator**: start the daemon with `ZOMFY_REMOTE_BIND=127.0.0.1`, then
     `bun run android`; the pairing offer then lists `http://10.0.2.2:7802`.
   - **APK**: `bun run mobile:apk` from the repo root builds one on EAS (needs `eas login` first).
3. In Settings → Devices press **Pair a phone**, then in the app scan the code or paste the link.

## Develop

- `bun test` — the pure modules in `src/lib` (transcript reducer, routes, gateway client, asks).
- `bun run typecheck`
- `bun run web` — a browser build for layout checks.
