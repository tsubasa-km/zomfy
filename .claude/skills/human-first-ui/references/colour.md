# Colour

## Colour is a strong, cheap signal — so ration it

Hue and lightness are pre-attentive: one accent among neutrals is found in one look. That only
works if the accent is rare. A screen where many things are coloured has no pop-out left.

- Build on neutrals; spend accent colour on the one or two things that need noticing.
- **One meaning per colour, everywhere.** If red means error, it never means "recording" or
  "brand". If the accent means "needs you", don't also use it for decoration or links.
- Semantic colours (danger, warning, success, info) follow platform convention; don't invent new
  meanings for them.
- Saturated colour reads as louder than a lightness change. A muted tint is enough for "selected";
  a saturated dot for "needs you now".

## Never by colour alone (WCAG 2.2, SC 1.4.1, level A)

Colour must not be the only visual means of conveying information, indicating an action,
prompting a response or distinguishing an element. Colour coding is fine when another visual cue
goes with it: shape, fill vs outline, position, an icon, a pattern, text, or a lightness
difference of at least 3:1. Classic failure: required or error fields marked only by colour.

Why: red–green colour vision deficiency affects about 8% of men and 0.4–0.5% of women of Northern
European ancestry (about 1 in 12 men); about 4–6.5% of men of Chinese or Japanese ancestry. Also
older users, low vision, monochrome or washed-out displays, bright sunlight.

Practical pairings:

- State dots: filled vs ring vs half; plus colour.
- Errors: icon + colour + words next to the field.
- Charts and diffs: colour plus position, pattern or a +/- mark.

Run the greyscale test on every screenshot.

## Contrast numbers

- Body text: at least 4.5:1 against its background (SC 1.4.3); large text 3:1.
- UI components and meaningful graphics (borders of inputs, icons, focus rings, state dots):
  at least 3:1 against adjacent colours (SC 1.4.11).
- "Muted" secondary text still has to pass 4.5:1. Low-contrast grey text is both hard to read and
  a sign that the text probably shouldn't be there.

## Dark and light themes

Check each state colour in both. A glow that is obvious on dark can vanish on light; a pale tint
can disappear on dark. Keep the meaning identical across themes even if the exact value changes.

## Sources

- W3C, Understanding SC 1.4.1 Use of Color — https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html
- W3C, SC 1.4.3 Contrast (Minimum) and SC 1.4.11 Non-text Contrast — https://www.w3.org/TR/WCAG22/
- Birch (2012), Worldwide prevalence of red-green color deficiency — https://pubmed.ncbi.nlm.nih.gov/22472762/
- MedlinePlus, Color vision deficiency — https://medlineplus.gov/genetics/condition/color-vision-deficiency/
- NN/g, Error-Message Guidelines (never colour or animation alone for errors) — https://www.nngroup.com/articles/error-message-guidelines/
- Healey, Perception in Visualization (hue and intensity as pre-attentive) — https://www.csc2.ncsu.edu/faculty/healey/PP/index.html
