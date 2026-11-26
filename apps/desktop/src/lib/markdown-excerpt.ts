// A reply's Markdown as the plain text a one- or two-line preview shows (the dashboard's cards):
// the words the person would read in the transcript, without the marks that render them there.

/** Plain text of `markdown`, on one line, for a clamped excerpt. */
export function markdownExcerpt(markdown: string): string {
  return (
    markdown
      // Fences go; the code inside stays, as it is part of what the reply says.
      .replace(/^\s*(```|~~~)[^\n]*$/gm, '')
      // Table rules (|---|---|) say nothing; cells keep their words.
      .replace(/^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*:?-*:?\s*$/gm, '')
      .replace(/\|/g, ' ')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s*([-*+]|\d+[.)])\s+/gm, '')
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(^|[^\w*])([*_])(?!\s)(.+?)(?<!\s)\2(?!\w)/g, '$1$3')
      .replace(/~~(.+?)~~/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
  )
}
