# Scanning, reading, memory

## How little people read

Nielsen's log study (45,237 page views): people read at most 28% of the words on an average page,
about 20% in practice. Each extra 100 words adds ~4.4 s of visit time — about 18 more words read.
Only on pages of 111 words or fewer did people have time to read half. (2005 data, browser
instrumentation not eye tracking; averages.)

Krug: "We don't read pages. We scan them." "We don't make optimal choices. We satisfice." People
take the first reasonable option and muddle through without learning how things work. Designers
imagine "great literature"; the user sees "a billboard going by at 60 miles an hour". Krug's rule
for copy: get rid of half the words, then half of what is left; cut happy talk and instructions.

Every sentence you add competes with the ones that matter and lowers the odds any are read.

## Scanning patterns (NN/g eye tracking)

- **F-pattern** — the default when nothing guides the eye: fixations on the top and left, first
  words of lines. Content on the right is missed. Not inevitable; strong visual cues change it.
- **Spotted** — the eye jumps to things that stand out (bold, links, colour, numbers, capitals) or
  match the task.
- **Layer-cake** — eyes hit headings and read only under the one they need. The most effective
  scan for long content.
- **Commitment** — reads nearly everything; only when highly motivated.

For app screens the lesson is the spotted pattern: whatever stands out visually is what gets
"read". Make the important thing stand out; don't rely on sentences to be read in order.
Layer-cake headings help long documents, not every block of a control surface.

## Banner blindness

People ignore what looks like an ad or sits where ads sit (top banner, right rail) — found in
1997, 2007 and 2018. One user made 148 fixations on a page, one of them in the right rail.
Ignored: small boxes with coloured backgrounds, decorative styling, text in images. Ads also
"poison adjacent items". In app UI this hits coloured tip/info/announcement boxes and promo-like
cards: they are skipped.

## Recognition over recall

Recognising is easier than recalling because the screen supplies the cues. Show options rather
than asking people to remember them; show recent items; keep things visible. Long tutorials are
not rehearsed and are forgotten — a cue at the point of use works better than an explanation up
front. Note NN/g's caveat: unlabelled icons are hard to recognise at first; labels help early use.

## Spatial memory and consistent placement

People remember where things are, and once learned, they go there without searching.

- Data Mountain (Robertson et al., 1998): people who placed pages spatially retrieved them quickly
  six months later.
- Cockburn & McKenzie (2001): 2D vs 3D made no difference — the spatial layout is what helps.
- CommandMaps (Scarr et al., CHI 2012): showing commands flat in fixed positions was no slower for
  novices and significantly faster than menus and the Ribbon for experienced users.

Consequences: keep elements in fixed places across states; change look, not position. Don't
insert a status sentence that pushes the row's contents around, don't reorder lists on state
changes the person didn't ask for, don't move a button between screens. Adaptive menus that
reorder themselves are a known failure.

## Habituation

Repeated exposure dulls response: fMRI studies of security warnings show attention dropping after
2–3 exposures and keeping on falling with repetition; changing the warning's appearance slows the
decline. A badge, banner, glow or sentence that is always there becomes background. Reserve strong
signals for when they're true, and let them go away when they stop being true.

## Sources

- Nielsen, How Little Do Users Read? — https://www.nngroup.com/articles/how-little-do-users-read/
- NN/g, F-Shaped Pattern — https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/
- NN/g, Text Scanning Patterns — https://www.nngroup.com/articles/text-scanning-patterns-eyetracking/
- NN/g, Banner Blindness Revisited — https://www.nngroup.com/articles/banner-blindness-old-and-new-findings/
- NN/g, Recognition and Recall — https://www.nngroup.com/articles/recognition-and-recall/
- Krug, Don't Make Me Think, Revisited (2014), ch. 2 and 5 (book)
- Robertson et al., Data Mountain — https://www.microsoft.com/en-us/research/publication/data-mountain-using-spatial-memory-for-document-management/
- Cockburn & McKenzie, 3D or Not 3D? — https://www.cs.kent.edu/~jmaletic/cs63903/papers/Cockburn01.pdf
- Scarr et al., Improving Command Selection with CommandMaps — https://hci.cs.umanitoba.ca/publications/details/improving-command-selection-with-commandmaps
- Kirwan et al. (2020), habituation to security warnings — https://www.frontiersin.org/articles/10.3389/fpsyg.2020.528079/full
- Vance et al. (2017), polymorphic warnings — https://www.cl.cam.ac.uk/events/shb/2017/vance1.pdf
