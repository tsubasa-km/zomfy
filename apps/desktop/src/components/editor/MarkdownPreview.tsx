import React, { useEffect, useRef, useState } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { Check, Copy } from 'lucide-react'
import { HARNESS_METHODS } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { openEditorTab } from '@/session-store'
import { NativeChatHighlightedCode } from '@/components/native-chat/NativeChatHighlightedCode'
import { imageMimeType } from './editor-file-kind'
import './markdown-preview.css'

/** Resolves a link or image path in a markdown file to a workspace-relative path, or null for URLs. */
export function resolveMarkdownTarget(markdownPath: string, target: string): string | null {
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//') || target.startsWith('#')) return null
  const clean = decodeURIComponent(target.split(/[?#]/)[0])
  const base = clean.startsWith('/') ? [] : markdownPath.split('/').slice(0, -1)
  for (const part of clean.split('/')) {
    if (part === '..') base.pop()
    else if (part && part !== '.') base.push(part)
  }
  return base.join('/')
}

/** GitHub-style heading anchors so `#section` links resolve. */
function headingSlug(children: React.ReactNode): string {
  const text = React.Children.toArray(children)
    .map((child) => (typeof child === 'string' || typeof child === 'number' ? String(child) : ''))
    .join('')
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

function codeText(children: React.ReactNode): string {
  return React.Children.toArray(children)
    .map((child) =>
      typeof child === 'string'
        ? child
        : React.isValidElement<{ children?: React.ReactNode }>(child)
          ? codeText(child.props.children)
          : ''
    )
    .join('')
}

function CodeBlock({ language, code }: { language?: string; code: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <div className="code-block-wrapper">
      <pre>
        <code>{language ? <NativeChatHighlightedCode code={code} language={language} /> : code}</code>
      </pre>
      <button
        type="button"
        className="code-block-copy-btn"
        aria-label="Copy code"
        onClick={() =>
          void navigator.clipboard.writeText(code).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1200)
          })
        }
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  )
}

/** Local images go through the daemon; the app's CSP only allows data: images. */
function LocalImage({ workspaceId, path, alt, title }: { workspaceId: string; path: string; alt?: string; title?: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const mime = imageMimeType(path)
  useEffect(() => {
    if (!mime) return
    let cancelled = false
    void harnessRequest(HARNESS_METHODS.fsReadBinary, { workspaceId, path })
      .then((file) => !cancelled && setSrc(`data:${mime};base64,${file.base64}`))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [workspaceId, path, mime])
  return src ? <img src={src} alt={alt} title={title} /> : <span className="text-muted-foreground">{alt || path}</span>
}

/** Orca's MarkdownPreview: GFM rendered with its `.markdown-body` typography. */
export function MarkdownPreview({
  content,
  workspaceId,
  filePath
}: {
  content: string
  workspaceId: string
  filePath: string
}): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const heading =
    (Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') =>
    ({ children }: { children?: React.ReactNode }) => <Tag id={headingSlug(children)}>{children}</Tag>

  const components: Components = {
    h1: heading('h1'),
    h2: heading('h2'),
    h3: heading('h3'),
    h4: heading('h4'),
    h5: heading('h5'),
    h6: heading('h6'),
    pre: ({ children }) => {
      const child = React.Children.toArray(children)[0]
      const props = React.isValidElement<{ className?: string; children?: React.ReactNode }>(child) ? child.props : {}
      const language = /language-([\w-]+)/.exec(props.className ?? '')?.[1]
      return <CodeBlock language={language} code={codeText(props.children).replace(/\n$/, '')} />
    },
    a: ({ href, children }) => (
      <a
        href={href}
        target={href?.startsWith('#') ? undefined : '_blank'}
        rel="noreferrer"
        onClick={(event) => {
          if (!href) return
          if (href.startsWith('#')) {
            event.preventDefault()
            rootRef.current?.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`)?.scrollIntoView()
            return
          }
          const target = resolveMarkdownTarget(filePath, href)
          if (target !== null) {
            event.preventDefault()
            openEditorTab({ workspaceId, kind: 'file', path: target, staged: false })
          }
        }}
      >
        {children}
      </a>
    ),
    img: ({ src, alt, title }) => {
      const target = typeof src === 'string' ? resolveMarkdownTarget(filePath, src) : null
      return target !== null ? (
        <LocalImage workspaceId={workspaceId} path={target} alt={alt} title={title} />
      ) : (
        <img src={typeof src === 'string' ? src : undefined} alt={alt} title={title} />
      )
    }
  }

  return (
    <div ref={rootRef} className="scrollbar-sleek h-full min-h-0 overflow-auto bg-editor-surface" data-markdown-preview>
      <div className="markdown-preview markdown-body mx-auto max-w-[900px] text-sm text-foreground">
        <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components}>
          {content}
        </Markdown>
      </div>
    </div>
  )
}
