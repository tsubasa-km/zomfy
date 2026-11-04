// Turns a selection in a rendered chat message back into Markdown: headings, emphasis, links, code,
// lists, quotes and tables come back as their Markdown, so a copied part keeps its formatting as text.
// Chrome around the content (code block headers, buttons, inline terminals) is left out.

const SKIP = 'button, svg, [data-md-skip], .xterm'

/** The selected part of the chat as Markdown; '' when nothing is selected. */
export function selectionMarkdown(selection: Selection | null = window.getSelection()): string {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return ''
  const parts: string[] = []
  for (let i = 0; i < selection.rangeCount; i++) parts.push(rangeMarkdown(selection.getRangeAt(i)))
  return parts.filter(Boolean).join('\n\n')
}

export function rangeMarkdown(range: Range): string {
  const holder = range.commonAncestorContainer
  const start = holder instanceof Element ? holder : holder.parentElement
  // A selection inside one code block is that code, fenced, whatever part of it was taken.
  const pre = start?.closest('pre')
  if (pre) return fence(range.toString(), pre.getAttribute('data-md-language') ?? '')
  const fragment = range.cloneContents()
  // Items or rows taken from the middle of a list or table come without it; put them back in one.
  if (start?.matches('ul, ol')) {
    const list = start.cloneNode(false) as HTMLElement
    list.append(fragment)
    return tidy(convert(list, false))
  }
  if (start?.matches('table, thead, tbody, tr')) {
    const table = document.createElement('table')
    if (start.matches('tr')) {
      const row = document.createElement('tr')
      row.append(fragment)
      table.append(row)
    } else table.append(fragment)
    return tidy(convert(table, false))
  }
  return tidy(convert(fragment, false))
}

function tidy(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function fence(code: string, language: string): string {
  const body = code.replace(/\n$/, '')
  // A fence longer than any run of backticks inside the code.
  const longest = Math.max(2, ...[...body.matchAll(/`+/g)].map((m) => m[0].length))
  const marks = '`'.repeat(longest + 1)
  return `${marks}${language}\n${body}\n${marks}`
}

function inlineCode(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length))
  const marks = '`'.repeat(longest + 1)
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return `${marks}${pad}${text}${pad}${marks}`
}

const block = (markdown: string) => `\n\n${markdown.trim()}\n\n`

function children(node: Node, inPre: boolean): string {
  return [...node.childNodes].map((child) => convert(child, inPre)).join('')
}

function wrap(mark: string, inner: string): string {
  const text = inner.trim()
  return text ? `${mark}${text}${mark}` : ''
}

function convert(node: Node, inPre: boolean): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? ''
    return inPre ? text : text.replace(/\s+/g, ' ')
  }
  if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) return children(node, inPre)
  if (!(node instanceof HTMLElement)) return ''
  if (node.matches(SKIP)) return ''
  // A file, terminal or chat mention reads as its label.
  if (node.classList.contains('chat-mention-chip')) return node.textContent ?? ''
  const tag = node.tagName.toLowerCase()
  const heading = /^h([1-6])$/.exec(tag)
  if (heading) return block(`${'#'.repeat(Number(heading[1]))} ${children(node, false).trim()}`)
  switch (tag) {
    case 'p':
      return block(children(node, false))
    case 'br':
      return '\n'
    case 'hr':
      return block('---')
    case 'strong':
    case 'b':
      return wrap('**', children(node, false))
    case 'em':
    case 'i':
      return wrap('*', children(node, false))
    case 'del':
    case 's':
      return wrap('~~', children(node, false))
    case 'code':
      return inPre ? children(node, true) : inlineCode(node.textContent ?? '')
    case 'pre':
      return block(fence(node.textContent ?? '', node.getAttribute('data-md-language') ?? ''))
    case 'a': {
      const text = children(node, false).trim()
      const href = node.getAttribute('href')
      return href && text && text !== href ? `[${text}](${href})` : text || (href ?? '')
    }
    case 'img': {
      const src = node.getAttribute('src')
      return src && !src.startsWith('data:') ? `![${node.getAttribute('alt') ?? ''}](${src})` : ''
    }
    case 'input':
      return node.getAttribute('type') === 'checkbox' ? (node.hasAttribute('checked') ? '[x] ' : '[ ] ') : ''
    case 'blockquote':
      return block(
        tidy(children(node, false))
          .split('\n')
          .map((line) => (line ? `> ${line}` : '>'))
          .join('\n')
      )
    case 'ul':
    case 'ol':
      return block(list(node, tag === 'ol'))
    case 'table':
      return block(table(node))
    default:
      return children(node, inPre)
  }
}

function list(element: HTMLElement, ordered: boolean): string {
  const first = Number(element.getAttribute('start') ?? 1) || 1
  return [...element.children]
    .filter((child) => child.tagName.toLowerCase() === 'li')
    .map((item, index) => {
      const marker = ordered ? `${first + index}. ` : '- '
      const text = tidy(children(item, false))
      // A tight item (no paragraphs of its own) keeps a nested list right under its line.
      const lines = item.querySelector(':scope > p') ? text : text.replace(/\n{2,}/g, '\n')
      const [head = '', ...rest] = lines.split('\n')
      // Lines under an item, a nested list among them, sit under its text.
      const indent = ' '.repeat(marker.length)
      return [marker + head, ...rest.map((line) => (line ? indent + line : ''))].join('\n')
    })
    .join('\n')
}

function table(element: HTMLElement): string {
  const rows = [...element.querySelectorAll('tr')].map((row) =>
    [...row.children].map((cell) => tidy(children(cell, false)).replace(/\n+/g, ' ').replaceAll('|', '\\|'))
  )
  if (rows.length === 0) return ''
  const width = Math.max(...rows.map((r) => r.length))
  const line = (cells: string[]) => `| ${[...cells, ...Array(width - cells.length).fill('')].join(' | ')} |`
  return [line(rows[0]!), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n')
}
