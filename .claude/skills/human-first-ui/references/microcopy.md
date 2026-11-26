# Words that earn their place

## Cognitive load and progressive disclosure

Working memory holds about four chunks. Every visible element — and every sentence — costs some of
it, whether or not it is read. Progressive disclosure (NN/g): show the few most important things
first, the rest on request. What is on the first screen tells people it is important. Keep to two
levels; past that people get lost. Make the way to the second level obvious (a visible control
with an honest label).

## Where words are irreplaceable

- **Content.** Names, messages, numbers, dates, the person's own data. That is what the screen is
  for.
- **Labels on form fields and navigation.** Short nouns. Keep the label, drop the helper sentence
  unless it carries a constraint people will otherwise get wrong (format, limit, consequence).
- **Errors.** Visible, next to the source, plain language, what happened and how to fix it. Never
  colour or a shake alone; no raw codes except as a secondary detail (NN/g).
- **Destructive or irreversible actions.** Name the action and object on the button ("Delete
  project", "Discard 3 changes"), say what will be lost if it isn't obvious. Not "Are you sure?" /
  "OK".
- **Empty and first-run states.** One short line saying what will appear here, or one action to
  start. Not a paragraph, not a tour; tutorials aren't remembered.
- **Ambiguous commands.** A short visible label beside a non-universal icon.

## Where words usually are not needed

- State that the object's look already shows (selected, active, running, waiting, done).
- Headings that name what is obviously below ("Details", "Your settings", "What you should do").
- Helper text that restates the label; "You can…", "Click here to…", "This section shows…".
- Confirmation sentences after an action whose result is visible on the spot.
- Explanations of why the UI is like this, or how it was built.

## Writing the words that stay

Front-load the meaningful word ("3 files failed", not "There was a problem with 3 of your files").
Use the person's words, not internal names. Sentence case, no trailing period on labels. Prefer
verbs on buttons ("Send", "Merge") over "OK". Say each fact once.

## Why an LLM over-labels — and how to catch it

No study measures this directly; these are observed tendencies, consistent with NN/g's review of
AI prototyping output (redundant elements, the same information shown several times, hierarchy
that contradicts priority) and practitioner reports that "the context from building the screen
ended up on the screen".

1. **You don't see the screen.** You know a UI through code and DOM text, so state written as text
   feels like the only state that exists. A coloured dot is, to you, a class name.
2. **You verify by reading.** "The row contains `Your turn`" is easy to assert in a test or spot in
   a DOM dump; "the dot stands out" needs a look. You drift toward what is easy to check.
3. **You explain to yourself.** The reasoning from the conversation ("this block is where the user
   answers") becomes a heading or a helper line.
4. **Training material is explanatory.** Tutorials, docs and templates are full of instructional
   text; adding an explanation feels safe.

Catch it: after writing UI, list every string you added that is not content. For each, ask: does
the object's look already say this? would a person who has used the screen twice need it? would
deleting it lose anything a screen reader user needs (then make it an `aria-label`, not visible
text)? Then look at a screenshot, not the markup.

Separately, the generic "AI look" (purple–blue gradients, everything rounded with soft shadows,
three-column icon feature grids, big-number stat cards) is reported widely but only anecdotally;
treat it as a smell of defaults, not as evidence.

## Sources

- NN/g, Progressive Disclosure — https://www.nngroup.com/articles/progressive-disclosure/
- NN/g, Error-Message Guidelines — https://www.nngroup.com/articles/error-message-guidelines/
- NN/g, Recognition and Recall (tutorials not rehearsed) — https://www.nngroup.com/articles/recognition-and-recall/
- NN/g, Prompt to Design Interfaces: Why Vague Prompts Fail (2025) — https://www.nngroup.com/articles/vague-prototyping/
- deeflect, Why AI Agents Keep Designing Interfaces for Themselves Instead of Humans (HackerNoon, 2026) —
  https://hackernoon.com/why-ai-agents-keep-designing-interfaces-for-themselves-instead-of-humans
- Krug, Don't Make Me Think, Revisited, ch. 5 "Omit needless words" (book)
- Cowan (2001), The magical number 4 in short-term memory, Behavioral and Brain Sciences (not fetched)
- Built In, AI Makes Bad Design Look Good Enough — https://builtin.com/articles/ai-design-slop-era (opinion)
