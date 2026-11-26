---
name: human-first-ui
description: >-
  How people actually look at screens, and how to design for that instead of for a text-reading
  model. Use whenever you design, build, change or review any UI — a screen, component, list row,
  card, dialog, settings page, empty state, status or state indicator, badge, label, heading,
  tooltip or helper text — and whenever you look at a UI screenshot, even if nobody says "design".
  UI を作る・変える・見直すとき、状態の見せ方やラベル・見出し・補足文を決めるとき、スクリーンショットを
  確認するときは、「デザイン」と言われなくても必ず使う。
---

# Human-first UI

## 1. You read; people look

You take in a UI as text: code, DOM strings, a list of labels. You check your work by reading
("the row shows `Your turn`" — verified). So text feels like the safe, complete way to say
anything, and you drift toward labelling every state, giving every block a heading that explains
it, and adding a helper sentence under every field. The context from building the screen leaks
onto the screen.

People do the opposite. They see layout, colour, shape, motion and position first, recognise
things they have seen before, and only then read a few words — about 20% of the words on a page.
Text is the slowest and lowest-priority channel on a screen. Treat your urge to label and explain
as a known bias, and correct for it on every UI change.

## 2. How a person sees a screen, in order

1. **Glance (< ~250 ms, one look).** Only pre-attentive features register: colour/hue, lightness
   contrast, size, shape, orientation, enclosure, motion/flicker. Words do not pop out — finding
   one label among many is a serial, line-by-line search.
2. **Shape, colour, position.** The eye lands on the biggest, most contrasting thing, then moves
   along the layout. Groups are seen from spacing and shared regions before any heading is read.
   Peripheral vision is low resolution: a small grey word at the edge is just "something grey";
   a coloured dot or a glow is noticed.
3. **Recognise.** People remember where things are and what they look like. Same place, same
   look, every time, and they stop searching.
4. **Read a few words.** Only where the eye has already been led, and only as many as needed.
   They scan and take the first good-enough option (satisficing); they don't study the screen.

Rules that follow:

- **One thing to notice, one distinct feature.** A state that matters gets a feature nothing else
  near it has (a colour, a glow, a filled shape). Colour × shape combinations do not pop out.
- **State lives on the object.** Show "this needs you" by changing the thing itself — the row's
  dot, the input's glow, the button's fill — not with a label beside it.
- **Group with space and regions, not headings.** Proximity and common region already say "these
  belong together".
- **Keep positions fixed.** Change appearance in place; don't move, insert or reorder elements
  with state. Spatial memory beats visual search.
- **Scarce emphasis.** What is always highlighted is never noticed (habituation after 2–3
  exposures). Strong signals only when something really needs the person.
- **Periphery for status, centre for action** (calm technology). Status sits quietly at the edges;
  only what needs the person now moves to the centre, by colour or motion, then calms down.

## 3. Procedure for a UI change

1. **Decide what the person must notice, and in what order.** Write it down as 1–3 items:
   "first: which thread needs me; second: where to type". If there are more, the design is wrong
   before it is drawn.
2. **Encode it visually first**, in this order of preference: position (where it is) → size and
   weight → colour/lightness contrast → shape or a universal icon → grouping (space, region) →
   motion (only for the one thing that needs attention now, briefly).
3. **Add words only for content and where words are irreplaceable**: the person's own data,
   names, numbers, errors, destructive confirmations, ambiguous commands, first-run/empty states.
4. **Cut.** Remove every heading that names what the block below obviously is, every helper
   sentence that restates its label, every state label that the object already shows. Then cut
   once more.
5. **Check it as a picture**, not as text (section 4). Look at a screenshot; don't grep the DOM.

### Example

A thread list where one thread waits for the person's reply.

- Text-first (what you'll reach for): the row says `Your turn` in small grey text; the composer
  has a heading "What you should do" and a helper line "Type your answer below and press Enter."
- Human-first: the row gets an accent-coloured dot in a fixed slot (other rows: no dot or a muted
  one) and its title turns full-contrast; when it is opened, the composer's border glows softly
  for a moment and the cursor is in it. No words added. The dot has `aria-label="Waiting for your
  reply"` and a tooltip, and its shape (filled vs ring) differs from other states so it survives
  colour blindness and greyscale.

## 4. Review checklist (use on a screenshot)

**1-second glance test.** Look at the screenshot for one second, look away. What did you notice
first? Is it the thing from step 1? If you noticed a heading or a sentence first, the hierarchy
is upside down.

**Squint test.** Blur the screenshot (squint, or scale it to ~10%). The blobs that remain should
be the important things, in the right order, with groups visible as groups.

**Greyscale test.** Remove colour. Can every state still be told apart (shape, fill, position,
icon)? If not, colour is carrying meaning alone.

**Explanation-text smells** — each one is a candidate for deletion or a visual replacement:

- State labels: `Your turn`, `Needs your answer`, `Running`, `Idle`, `Active`, `Selected`, `Done`
  shown as words next to an item whose look could carry the state.
- Headings that describe the block below: "What you should do", "Your settings", "Details",
  "Actions", "Overview" — when spacing and content already make the group obvious.
- Helper sentences that restate the label: label `Name`, helper "Enter the name."
- "You can…" / "Click here to…" / "This shows…" / "Here you'll find…" sentences.
- Status sentences inside rows or cards: "This item is waiting for…", "Last updated 3 minutes ago
  by the system" where a relative time or a dot would do.
- The same fact said twice (label + badge + tooltip + sentence).
- Notes that explain why the UI exists or how it was built — conversation context leaking in.
- Coloured "tip" or "info" boxes — they read as ads and get skipped (banner blindness).

**Other checks**

- Is there exactly one strongest element? Does emphasis match importance?
- Did anything move, appear or disappear with state that the person had learned the place of?
- Does each colour mean one thing everywhere? Contrast ≥ 4.5:1 text, ≥ 3:1 UI parts?
- Is motion limited to one thing, ~100–300 ms, and does it stop?
- Do changes happen near where the person is looking? Far-away changes go unseen.

## 5. Guardrails — don't over-correct

The goal is less explaining, not no text. Keep words where they are irreplaceable:

- **Accessibility.** Every icon-only control and every visual-only state has an accessible name
  (`aria-label`, alt text) and, for pointer users, a tooltip. Never encode by colour alone
  (WCAG 1.4.1): pair colour with shape, fill, position or an icon.
- **Ambiguous icons need visible labels.** Only a few icons are universal (search, home, print,
  close, add, settings, play/pause, trash). Commands that aren't, or are rarely used, get a short
  visible label. If you can't think of an icon in 5 seconds, use a word.
- **Errors need words**: what went wrong, in plain language, next to where it happened, and how to
  fix it. Not colour or a shake alone.
- **Destructive or irreversible actions need words**: name the action and the thing ("Delete 3
  files"), not "Are you sure?".
- **First run and empty states** may need one short line and one action. One line, not a tour.
- **Content is text.** Names, messages, numbers and the person's own data are the point; this skill
  is about the chrome around them.
- **Labels for navigation and form fields stay.** Remove the helper sentence, not the label.

## 6. References

Load only what the task needs:

- `references/perception.md` — pre-attentive features, Gestalt grouping, peripheral vision,
  change and inattentional blindness, visual hierarchy.
- `references/scanning-and-reading.md` — how much people read, F / layer-cake / spotted
  patterns, banner blindness, satisficing, recognition over recall, spatial memory, habituation.
- `references/icons-and-labels.md` — when icons work alone, when labels are needed, tooltips,
  signifiers, state on the object.
- `references/colour.md` — colour meaning, consistency, colour-blind safety, contrast numbers.
- `references/motion-and-calm.md` — what motion does to attention, durations, when it annoys,
  calm technology.
- `references/microcopy.md` — cognitive load, progressive disclosure, words that earn their
  place (errors, destructive actions, empty states), and why LLMs over-label.
- `references/sources.md` — the sources behind all of this, with how well established each is.
