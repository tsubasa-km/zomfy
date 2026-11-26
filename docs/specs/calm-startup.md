---
type: Spec
title: The window opens in one step
description: At startup the window shows the shell it had last time (sidebar, threads, tabs, composer, status bar) from a local snapshot while the hosts connect, keeps Monaco off the startup path, and a script records a startup filmstrip to check it.
status: stable
x-zomfy-implementation: done
tags: [desktop, performance, startup]
generated: { by: "claude-code/opus-5.5", at: "2026-11-26T00:00:00Z" }
---

# Problem

Starting Zomfy built the screen in visible stages. Recorded on a production build in a preview
(13 threads, one 40-turn thread open), the window showed a boot spinner, then an empty shell saying
"No threads yet" and "Choose what to open", then the threads, tabs and a composer that said it was
reconnecting, a blank transcript, the transcript, and finally the usage meter, which shifted the
status bar: six visible steps over about two seconds (five on a slower first run). Before the shell could mount it loaded 9.4 MB of script, Monaco's 3.5 MB
included, for an editor no tab showed.

# What it does

- **Restores the last listing.** `lib/host-snapshots.ts` keeps each host's state (projects,
  workspaces) and its chat list in `localStorage`; the main window writes them, chats at most once a
  second. `session-store` starts with them, each host marked connecting, so the first frame of the
  shell has the sidebar, thread list, tabs and composer in place. The host's own answer replaces the
  snapshot; a restored chat's status change is not a notification or an unread mark, since it
  happened while the window was closed. Removing a host drops its snapshot.
- **Connects in one round.** After `initialize`, the state, chat, terminal and shell lists are asked
  together and applied in one render.
- **Keeps Monaco for when it is needed.** The file and diff tab views are loaded on the first such
  tab (`React.lazy`), with an editor-coloured placeholder meanwhile.
- **Says only what lasts.** The composer's "Reconnecting to …" notice and placeholder show once a
  host has been unreachable for 1.5 s, so a connect at startup does not grow and shrink the composer.
- **Holds the transcript's place.** A chat whose history is still being replayed shows a pulsing
  outline of a question and answer instead of a blank pane.
- **Keeps the status bar still.** The last usage limits per host are saved and shown at startup
  until the host answers again.
- **Boots in the final frame.** The boot screen has the sidebar at its saved width, the main area and
  the status bar, in the shell's colours; the UI font is preloaded with the page.

# What it does not do

- It does not cache transcripts: a thread's history still comes from its host (`session/load`).
- Rendering a long transcript still takes one long task (about 450 ms for 40 turns with code).

# Results

`bun scripts/record-startup.ts`, production build, same preview data, median of three runs each, ms
from navigation:

| | before | after |
| --- | ---: | ---: |
| Shell appears | 1000 (empty, then filled in) | 781 (complete) |
| Threads, tabs, composer, right sidebar | 1177 | 781 |
| Usage meter in the status bar | 1910 (4831 on the first run) | 781 |
| Transcript | 1612 (blank until then) | 1137 (outline from 781) |
| Last layout change (stable layout) | 1922 | 1190 |
| Visually complete | 1932 | 1344 |
| Layout shifts | 6 | 2 |
| Long tasks (total) | 6 (894 ms) | 4 (473 ms) |
| React commits | 47 | 34 |
| Script and styles loaded | 9.4 MB | 4.6 MB |

The remaining large shift (0.36) is counted when the transcript is inserted and scrolled to its end
in the same frame; the filmstrip shows no movement.

# Recording a startup

In `apps/desktop`, with a preview running (`bun scripts/preview.ts start <slot> --prod` serves a
production build, as the app ships):

```bash
HARNESS_CDP_PORT=9309 bun scripts/record-startup.ts record "$TEMP/zomfy-startup/after"
bun scripts/record-startup.ts compare "$TEMP/zomfy-startup/before" "$TEMP/zomfy-startup/after"
```

`record` reloads the page with the cache off and writes a frame every 100 ms (`frames/`), an MP4 and
GIF when ffmpeg is on `PATH`, a DevTools trace (`trace.json`), and `timeline.md`/`metrics.json`:
when each part of the window appeared, every daemon request with its timing, long tasks, layout
shifts and React commits. Load the page once after a code change before recording, so the
snapshots the new build writes are in place.

# Acceptance

- After a restart, the first frame of the shell shows the threads, tabs and composer of last time.
- No Monaco chunk is fetched at startup unless a file or diff tab is open.
- The composer shows no reconnecting notice during a normal startup.
- `record-startup.ts` produces the filmstrip and timeline above.
