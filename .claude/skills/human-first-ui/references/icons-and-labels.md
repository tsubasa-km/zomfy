# Icons, labels, signifiers

The evidence here pulls *toward* text for commands. Read it before removing labels.

## When an icon alone works

NN/g: only a few icons are close to universally recognised — home, print, search (magnifier).
In practice, also: close (×), add (+), play/pause, settings gear, trash, back arrow, share on its
own platform. Most others (hamburger, heart, star, clock, bell, lightning, sparkle) change meaning
between products. A clock icon used for history was clicked by no test participant.

An icon alone is acceptable when it is one of those universal ones, or when it is used constantly
in the same place so it is learned (spatial memory plus repetition), and it has an accessible name
and a tooltip.

## When a label is needed

- Commands whose icon isn't universal, or which are used rarely.
- Navigation destinations.
- Anything whose icon took you more than 5 seconds to think of (NN/g's 5-second rule: if you can't
  think of an icon quickly, it won't communicate).
- Destructive actions.

NN/g's own recommendation is a visible text label alongside icons, visible at all times. Hover-only
labels cost an interaction and fail on touch. Tooltips are a supplement for compact, frequent,
learned controls — not a substitute for a label on an ambiguous one.

Test icons: ask people what they think it means (recognition); check again weeks later
(memorability).

## States are different from commands

The icon research is about commands — "what will happen if I press this". States — "what is
going on with this item" — are where visual encoding shines and words are usually redundant:

- A dot or ring in a fixed slot, its colour and fill carrying the state.
- The object's own look: a selected row tinted, an active input glowing, a disabled button dimmed,
  a busy item with a subtle spinner or pulse, an unread item in bold.
- These are learned in a few exposures because they repeat, sit in the same place and map to one
  meaning each.

Keep the set of states small (people will learn 3–4, not 9), give each one a distinct shape or
fill as well as a colour, and give each an accessible name.

## Signifiers and feedback (Norman)

A signifier is the perceivable cue that says where an action is possible and what it does.
Norman moved designers from "affordances" to "signifiers" (Interactions, 2008). A door that needs
a PUSH sign has a design that failed to signify; the sign is a patch. In UI: a button that looks
pressable, an input that looks typeable, a drag handle that looks draggable — then the
explanation sentence ("Click the button to…") isn't needed.

Feedback: every action gets an immediate, visible response at the place it happened (within
~0.1 s to feel caused). The response is the object changing, not a sentence appearing elsewhere.

## Indicators live on the item

NN/g: indicators are passive cues tied to a specific element, shown "in close proximity to that
element"; they don't demand action; overused, they become noise. So a status belongs on or right
next to the thing it describes — not in a sentence in a header, a toast in a corner, or a
separate legend.

## Sources

- NN/g, Icon Usability — https://www.nngroup.com/articles/icon-usability/
- NN/g, Recognition and Recall — https://www.nngroup.com/articles/recognition-and-recall/
- NN/g, Indicators, Validations, and Notifications — https://www.nngroup.com/articles/indicators-validations-notifications/
- Norman, Signifiers, not affordances (2008) — https://jnd.org/signifiers-not-affordances/
- Norman, The Design of Everyday Things, revised 2013 (book)
- Apple HIG, Icons / SF Symbols — https://developer.apple.com/design/human-interface-guidelines/icons
  (not fetched; summary from general knowledge: simple consistent symbols, accessibility labels for
  icon-only buttons, no text inside icons)
