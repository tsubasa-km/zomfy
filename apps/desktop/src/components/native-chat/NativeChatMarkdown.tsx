import React from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { File, MessageSquare, SquareTerminal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MENTION_TITLE, parseChatMentions, type ChatMention } from '@/lib/chat-mentions'
import { openChatMention } from '@/lib/chat-attachments'
import { NativeChatCodeBlock } from './NativeChatCodeBlock'
import { NativeChatMarkdownRowKeyContext } from './native-chat-disclosure-store'
import { t } from '@/i18n/i18n'
import './native-chat-markdown.css'

// Classes follow Orca's document-variant renderers (sidebar/comment-markdown-element-renderers.tsx);
// mermaid, file links, image lightbox and word fade are left out until they are needed.
const DOCUMENT_COMPONENTS: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  a: ({ href, children }) => (
    <a
      href={href || undefined}
      target="_blank"
      rel="noreferrer"
      className="break-all text-primary underline underline-offset-2 hover:text-primary/80"
    >
      {children}
    </a>
  ),
  code: ({ children }) =>
    typeof children === 'string' && children.startsWith(MENTION_MARK) ? (
      <MentionChip mention={decodeMention(children)} />
    ) : (
    <code className="rounded bg-accent px-1.5 py-0.5 font-mono text-[0.92em] [overflow-wrap:anywhere]">
      {children}
    </code>
    ),
  pre: ({ node, children }) => {
    const child = React.Children.only(children) as React.ReactElement<{ className?: string; children?: React.ReactNode }>
    const language = /language-([\w-]+)/.exec(child.props.className ?? '')?.[1]
    return (
      <NativeChatCodeBlock language={language} sourceLine={node?.position?.start.line}>
        {child.props.children}
      </NativeChatCodeBlock>
    )
  },
  ul: ({ children }) => <ul className="my-2 ml-5 list-disc space-y-1">{children}</ul>,
  ol: ({ children, start }) => (
    <ol start={start} className="my-2 ml-5 list-decimal space-y-1">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="leading-relaxed [&>input]:pointer-events-none">{children}</li>
  ),
  h1: ({ children }) => (
    <h1 className="mt-4 mb-2 text-[18px] leading-tight font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-4 mb-2 text-[16px] leading-tight font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3 mb-2 text-[15px] leading-tight font-semibold first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => <h4 className="mt-3 mb-1 font-semibold first:mt-0">{children}</h4>,
  hr: () => <hr className="my-4 border-border/60" />,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-border/70 pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-3 max-w-full overflow-x-auto rounded-md border border-border/60">
      <table className="min-w-full border-collapse text-[13px] [&_td]:border [&_td]:border-border/50 [&_td]:px-2 [&_td]:py-1.5 [&_th]:border [&_th]:border-border/50 [&_th]:bg-muted/60 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold">
        {children}
      </table>
    </div>
  )
}

/** Prefixes the inline code a mention becomes (JSON after it); private use, so never typed. */
const MENTION_MARK = '\uE000'
const MENTION_ICONS = { file: File, terminal: SquareTerminal, chat: MessageSquare } as const

function decodeMention(code: string): ChatMention {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: written by remarkChatMentions below.
  return JSON.parse(code.slice(MENTION_MARK.length)) as ChatMention
}

function MentionChip({ mention }: { mention: ChatMention }) {
  const Icon = MENTION_ICONS[mention.kind]
  return (
    <span
      role="button"
      tabIndex={0}
      className="chat-mention-chip"
      title={t('{kind}: click to open', { kind: MENTION_TITLE[mention.kind] })}
      onClick={(event) => {
        const workspaceId = event.currentTarget.closest<HTMLElement>('[data-link-workspace-id]')?.dataset.linkWorkspaceId ?? null
        openChatMention(mention, workspaceId)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.currentTarget.click()
      }}
    >
      <Icon className="size-3" />
      <span>{mention.label}</span>
    </span>
  )
}

type MdNode = { type: string; value?: string; children?: MdNode[] }

/** Turns mentions in a sent message into inline code the `code` renderer draws as chips. */
function remarkChatMentions() {
  const visit = (node: MdNode): void => {
    if (!node.children) return
    node.children = node.children.flatMap((child): MdNode[] => {
      if (child.type !== 'text' || !child.value) {
        visit(child)
        return [child]
      }
      const text = child.value
      const mentions = parseChatMentions(text, { sent: true })
      if (mentions.length === 0) return [child]
      const parts: MdNode[] = []
      let at = 0
      for (const m of mentions) {
        if (m.from > at) parts.push({ type: 'text', value: text.slice(at, m.from) })
        parts.push({ type: 'inlineCode', value: `${MENTION_MARK}${JSON.stringify(m)}` })
        at = m.to
      }
      if (at < text.length) parts.push({ type: 'text', value: text.slice(at) })
      return parts
    })
  }
  return visit
}

export function NativeChatMarkdown({
  content,
  rowKey,
  className,
  mentions = false
}: {
  content: string
  rowKey?: string
  className?: string
  /** A user's message: its @ mentions show as chips. */
  mentions?: boolean
}): React.JSX.Element {
  return (
    <NativeChatMarkdownRowKeyContext.Provider value={rowKey}>
      <div
        className={cn(
          'native-chat-markdown',
          '[&_pre_code]:rounded-none [&_pre_code]:bg-transparent [&_pre_code]:p-0',
          'max-w-full min-w-0 [overflow-wrap:anywhere]',
          className
        )}
      >
        <Markdown remarkPlugins={mentions ? [remarkGfm, remarkChatMentions] : [remarkGfm]} rehypePlugins={[rehypeSanitize]} components={DOCUMENT_COMPONENTS}>
          {content}
        </Markdown>
      </div>
    </NativeChatMarkdownRowKeyContext.Provider>
  )
}
