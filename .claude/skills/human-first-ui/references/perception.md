# Perception: what the eye does before anyone reads

## Pre-attentive features

Some visual properties are detected across the whole field of view in a single look — roughly
under 200–250 ms, faster than an eye movement can start (eye movements take at least ~200 ms to
initiate). These "pop out" regardless of how many other items there are.

Shown to be pre-attentive (Healey; Treisman & Gelade; Wolfe & Horowitz):

- colour hue, lightness/intensity, contrast
- size, length/width, curvature, closure, line orientation
- number (rough count), density
- enclosure / added marks, intersections, terminators
- 3D depth cues, lighting direction
- flicker, direction and velocity of motion

What does **not** pop out:

- **Conjunctions.** A target that differs only by a combination ("red *and* round" among red
  squares and blue circles) needs a slow serial search. Give each important state one feature of
  its own.
- **Words.** Reading is not pre-attentive. A `Your turn` label among `Idle` labels is found by
  reading rows one by one. A single coloured dot among plain rows is found in one look.
- **Too many emphasised things.** Pop-out works because the target is unique. Three accent
  colours on one screen means nothing pops.

The "200–250 ms" boundary is a convention, not a hard threshold; attention plays some part even
early. The feature list and "unique features pop out, conjunctions don't" are well established.

## Visual hierarchy

The eye goes first to what is biggest, highest-contrast, most saturated, isolated by space, or
moving, then follows the layout (top-left first in left-to-right languages). Hierarchy is the
order you intend that path to take. Make it match importance: one strongest element, a few
secondary ones, everything else quiet. When hierarchy contradicts content priority, people get
lost (NN/g found AI-generated screens often do exactly this).

## Gestalt grouping — the layout already says what belongs together

- **Proximity.** Near things are related; space separates. It can outweigh colour or shape.
  Varying whitespace is the primary grouping tool. Keep a label tight to its field; keep a heading
  closer to its own section than to the one above.
- **Similarity.** Same colour, shape or size reads as "same kind". Use this to show that items
  share a state or role — and don't give unrelated things the same look.
- **Common region.** A shared background or border makes a strong group that can override
  proximity. But borders "added in an abundance of caution" clutter; check whether space suffices
  first. Full-width boxes can look like the end of the page ("false floor").
- **Continuity / alignment.** Items on a line or edge read as a sequence. A strong alignment grid
  does much of the work headings are often added to do.
- **Figure/ground and closure.** A raised or tinted surface reads as an object on a background;
  people complete partial shapes.

Consequence: a heading that names a group ("Details", "Actions") is usually redundant once space
and regions show the group. Headings earn their place in long content that people scan for a
section, not as labels on every block of an app screen.

## Peripheral vision

The fovea covers about 1% of the retina but gets about 50% of the visual cortex. Outside a few
degrees, vision is blurry and colour-weak toward the far edge — text cannot be read there.
Johnson: stationary, muted items in the periphery often go unnoticed; motion in the periphery is
usually noticed. Peripheral vision's job is to decide where the fovea goes next, from coarse cues.

So: a status that should be noticed without being looked at needs a coarse cue — a block of
colour, a lightness change, a shape, at most a brief motion. A grey word is invisible there.
Messages that appear far from where the person is looking (an error at the top of a long form)
are missed.

## Change blindness and inattentional blindness

People miss changes away from their focus, especially when the change has no motion or happens
during a blink, scroll, page transition or another change. In lab studies some needed 20–40
alternations to spot a large change. Inattentional blindness: people focused on a task fail to see
unexpected things in plain view.

Design consequences (NN/g):

- Change one thing at a time; group simultaneous changes in one region.
- Put the response near where the action happened.
- Use a brief motion or a contrast change to mark that something changed — not several at once.
- Dim what did not change if you need to direct attention.
- Don't rely on a change in a far corner being seen (a badge count ticking up off to the side).

## Sources

- Healey, Perception in Visualization — https://www.csc2.ncsu.edu/faculty/healey/PP/index.html
- Treisman & Gelade (1980), A feature-integration theory of attention —
  https://www.cs.princeton.edu/courses/archive/spring08/cos598B/Readings/TreismanGelade1980.pdf
- Wolfe & Horowitz (2004), What attributes guide the deployment of visual attention —
  https://search.bwh.harvard.edu/new/pubs/WolfeHorowitzNRN04.pdf
- NN/g, Proximity Principle — https://www.nngroup.com/articles/gestalt-proximity/
- NN/g, Common Region — https://www.nngroup.com/articles/common-region/
- NN/g, Change Blindness — https://www.nngroup.com/articles/change-blindness-definition/
- NN/g, Prompt to Design Interfaces (AI output and hierarchy) —
  https://www.nngroup.com/articles/vague-prototyping/
- Johnson, Designing with the Mind in Mind, "Our Peripheral Vision is Poor" —
  https://www.oreilly.com/library/view/designing-with-the/9780123750303/OEBPS/B9780123750303000065.htm
- Ware, Information Visualization: Perception for Design (book; Gestalt and pre-attentive chapters)
