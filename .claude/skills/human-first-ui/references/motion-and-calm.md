# Motion and calm

## What motion does

Motion in peripheral vision triggers an involuntary, stimulus-driven shift of attention. It is the
one cue reliably noticed outside the fovea (Johnson; NN/g). Things that look self-propelled
(sliding in) grab attention faster than things that fade in. That makes motion the strongest and
most expensive signal you have.

Use it for:

- the one thing that needs the person now (a brief glow or pulse on the input that waits for them);
- feedback that an action took effect, at the place of the action;
- continuity — showing where something went or came from, so a change isn't missed
  (change blindness).

Don't use it for decoration, for many things at once, or for anything that repeats on every visit.
NN/g: animations that were "nice the first time" become annoying with repetition; motion that
can't be skipped wastes time.

## Durations (NN/g)

- Small feedback (toggle, checkbox): ~100 ms.
- Larger changes (panel, dialog): 200–300 ms.
- Up to 400 ms only for big movements across large screens.
- Entrances slightly longer than exits (e.g. 300 ms in, 200–250 ms out).
- Start within 0.1 s of the action for it to feel caused by it.

Attention-getting loops (pulse, glow) should settle: a few cycles, then a steady state that still
shows the state (a solid dot, a static border). A forever-pulsing element habituates and becomes
noise. Respect `prefers-reduced-motion`: keep the state visible with a static change instead.

## Calm technology

Weiser & Brown (Xerox PARC, 1995): calm technology moves easily between the periphery of attention
and the centre, and back. The periphery lets you stay aware of many things without being
overwhelmed; when something matters, it comes to the centre; then it goes back. Their example,
Natalie Jeremijenko's Dangling String: a plastic string on a motor that whirls when the network is
busy and twitches when quiet — readable from across the room, with no words.

Amber Case's principles (calmtech.com): technology should require the smallest possible amount of
attention; inform and create calm; make use of the periphery; it "can communicate, but doesn't need
to speak"; the right amount of technology is the minimum needed.

Applied to screens:

- Ambient status (running, idle, synced) lives in the periphery as quiet visual state: small dots,
  muted tints, steady.
- Only a change that needs the person moves to the centre — by colour, then if needed a brief
  motion — and calms down once acknowledged.
- Quiet is a valid state. Not everything needs to announce itself; a screen with nothing to do
  should look calm, not fill the space with messages.

## Sources

- NN/g, The Role of Animation and Motion in UX — https://www.nngroup.com/articles/animation-usability/
- NN/g, Executing UX Animations: Duration and Motion — https://www.nngroup.com/articles/animation-duration/
- NN/g, Change Blindness — https://www.nngroup.com/articles/change-blindness-definition/
- Johnson, Designing with the Mind in Mind, peripheral vision chapter — https://www.oreilly.com/library/view/designing-with-the/9780123750303/OEBPS/B9780123750303000065.htm
- Weiser & Brown, Designing Calm Technology (1995) — https://calmtech.com/papers/designing-calm-technology
- Amber Case, Principles of Calm Technology — https://calmtech.com/
