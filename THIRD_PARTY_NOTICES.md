# Third-party notices

Parts of `apps/desktop/src` (the theme in `assets/main.css`, `components/ui/`, status indicators,
native-chat components, syntax highlighting, and the Geist font usage) are copied or adapted from
Orca (https://github.com/stablyai/orca), distributed under the MIT License:

```
MIT License

Copyright (c) 2026 Lovecast Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Geist font

`apps/desktop/src/assets/fonts/Geist-Variable.woff2` is Geist by Vercel, licensed under the SIL Open Font
License 1.1 (https://github.com/vercel/geist-font/blob/main/OFL.txt).

## Material Icon Theme

The file and folder icons in the app (`/file-icons/*.svg` in the built app) are from Material Icon Theme
(https://github.com/material-extensions/vscode-material-icon-theme), distributed under the MIT License:

```
The MIT License (MIT)
Copyright (c) 2025 Material Extensions

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

```

---

## Open Knowledge Format agent skills

`.claude/skills/okf-generate` and `.claude/skills/okf-consume` are copied unchanged from
https://github.com/open-knowledge-format/open-knowledge-format (commit 527e81a, `skills/`),
Copyright Google LLC, licensed under the Apache License, Version 2.0
(https://www.apache.org/licenses/LICENSE-2.0).

## Zomfy for Android and the remote gateway

The phone app (`apps/mobile`) follows T3 Code's client design (https://github.com/pingdotgg/t3code):
ordered connection routes with a preferred route and jittered backoff, one connection owner per
host, one-time scoped pairing links, and its approval and question cards. The pairing offer
(`packages/protocol/src/remote-devices.ts`), the per-scope method allowlist and Settings → Devices
follow Orca's mobile pairing (MIT, notice above). The phone relay's end-to-end encryption
(`packages/protocol/src/phone-e2ee.ts`) copies Orca's paired E2EE v2: the hello/ready transcript
encoding, the HKDF-SHA256 key schedule, the counter nonce layout and the device proof
(`src/shared/remote-runtime/e2ee/` and `pairing/device-key-proof.ts`, MIT, notice above). The app's
relay route, wakeups (`apps/mobile/src/lib/host-connection.ts`, `routes.ts`) and offline prompt
queue (`prompt-queue.ts`) follow T3 Code's connection supervisor, connection wakeups and composer
queue. T3 Code is distributed under the MIT License:

```
MIT License

Copyright (c) 2026 T3 Tools Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
