import { useEffect, useState, type ReactNode } from 'react'
import type { OnMount } from '@monaco-editor/react'
import { monaco } from '@/lib/monaco-setup'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { t } from '@/i18n/i18n'
import { editorStatusButtonClass } from './EditorStatus'

// What a Monaco editor says about itself in the status bar: where the cursor is, how the file is
// indented, and the language it is read as.

type MonacoEditor = Parameters<OnMount>[0]

interface Snapshot {
  line: number
  column: number
  /** Characters selected; 0 with a bare cursor. */
  selected: number
  /** More than one cursor. */
  cursors: number
  spaces: boolean
  tabSize: number
  languageId: string
}

function snapshot(editor: MonacoEditor): Snapshot | null {
  const model = editor.getModel()
  const position = editor.getPosition()
  if (!model || !position) return null
  const selections = editor.getSelections() ?? []
  const options = model.getOptions()
  return {
    line: position.lineNumber,
    column: position.column,
    selected: selections.reduce((sum, range) => sum + model.getValueLengthInRange(range), 0),
    cursors: selections.length,
    spaces: options.insertSpaces,
    tabSize: options.tabSize,
    languageId: model.getLanguageId()
  }
}

function languageName(id: string): string {
  if (id === 'plaintext') return t('Plain Text')
  return monaco.languages.getLanguages().find((language) => language.id === id)?.aliases?.[0] ?? id
}

/** `children` go where VS Code has the encoding and the line endings: after the indentation, before the language. */
export function EditorStatusSegments({ editor, children }: { editor: MonacoEditor; children?: ReactNode }) {
  const [state, setState] = useState(() => snapshot(editor))
  useEffect(() => {
    const read = (): void => setState(snapshot(editor))
    read()
    const subs = [
      editor.onDidChangeCursorSelection(read),
      editor.onDidChangeModel(read),
      editor.onDidChangeModelLanguage(read),
      editor.onDidChangeModelOptions(read)
    ]
    return () => subs.forEach((sub) => sub.dispose())
  }, [editor])
  if (!state) return null

  const run = (action: string): void => {
    editor.focus()
    void editor.getAction(action)?.run()
  }
  const position =
    state.cursors > 1
      ? t('{count} selections', { count: state.cursors })
      : t('Ln {line}, Col {column}', { line: state.line.toLocaleString(), column: state.column.toLocaleString() }) +
        (state.selected > 0 ? ` (${t('{count} selected', { count: state.selected.toLocaleString() })})` : '')

  return (
    <>
      <button type="button" className={editorStatusButtonClass} data-editor-position title={t('Go to Line/Column')} onClick={() => run('editor.action.gotoLine')}>
        {position}
      </button>
      <IndentMenu editor={editor} spaces={state.spaces} tabSize={state.tabSize} />
      {children}
      <LanguageMenu editor={editor} languageId={state.languageId} />
    </>
  )
}

const TAB_SIZES = [1, 2, 3, 4, 5, 6, 7, 8]

/** VS Code's indentation picker: what Tab inserts from here on, and rewriting what the file has. */
function IndentMenu({ editor, spaces, tabSize }: { editor: MonacoEditor; spaces: boolean; tabSize: number }) {
  const run = (action: string): void => {
    editor.focus()
    void editor.getAction(action)?.run()
  }
  const sizes = (insertSpaces: boolean) => (
    <DropdownMenuSubContent>
      <DropdownMenuRadioGroup
        value={spaces === insertSpaces ? String(tabSize) : ''}
        onValueChange={(size) => editor.getModel()?.updateOptions({ insertSpaces, tabSize: Number(size), indentSize: Number(size) })}
      >
        {TAB_SIZES.map((size) => (
          <DropdownMenuRadioItem key={size} value={String(size)} data-indent-size={`${insertSpaces ? 'spaces' : 'tabs'}:${size}`}>
            {size}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuSubContent>
  )
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" className={editorStatusButtonClass} data-editor-indent title={t('Indentation')}>
          {spaces ? t('Spaces: {size}', { size: tabSize }) : t('Tab Size: {size}', { size: tabSize })}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4} className="min-w-56">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-indent-menu="spaces">{t('Indent Using Spaces')}</DropdownMenuSubTrigger>
          {sizes(true)}
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-indent-menu="tabs">{t('Indent Using Tabs')}</DropdownMenuSubTrigger>
          {sizes(false)}
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => run('editor.action.detectIndentation')}>{t('Detect Indentation from Content')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run('editor.action.indentationToSpaces')}>{t('Convert Indentation to Spaces')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run('editor.action.indentationToTabs')}>{t('Convert Indentation to Tabs')}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => run('editor.action.trimTrailingWhitespace')}>{t('Trim Trailing Whitespace')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The language a path would open as, were nothing chosen for it. */
function languageOfPath(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot) : ''
  const found = monaco.languages
    .getLanguages()
    .find((language) => language.filenames?.some((f) => f.toLowerCase() === name) || (extension !== '' && language.extensions?.some((e) => e.toLowerCase() === extension)))
  return found?.id ?? 'plaintext'
}

/** VS Code's language mode picker: reads this file as another language until its tab closes. */
function LanguageMenu({ editor, languageId }: { editor: MonacoEditor; languageId: string }) {
  const [open, setOpen] = useState(false)
  const choose = (id: string): void => {
    const model = editor.getModel()
    if (model) monaco.editor.setModelLanguage(model, id)
    setOpen(false)
    editor.focus()
  }
  const languages = open
    ? monaco.languages
        .getLanguages()
        .map((language) => ({ id: language.id, name: languageName(language.id) }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : []
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={editorStatusButtonClass} data-editor-language={languageId} title={t('Select Language Mode')}>
          {languageName(languageId)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" sideOffset={6} className="w-64 p-0">
        <Command density="menu">
          <CommandInput placeholder={t('Select Language Mode')} />
          <CommandList className="max-h-72">
            <CommandEmpty>{t('No matching language')}</CommandEmpty>
            <CommandItem
              value="auto detect"
              data-language-option="auto"
              onSelect={() => {
                const model = editor.getModel()
                // Model paths end with the file's own path, extension and all.
                choose(model ? languageOfPath(model.uri.path) : 'plaintext')
              }}
            >
              {t('Auto Detect')}
            </CommandItem>
            {languages.map((language) => (
              <CommandItem key={language.id} value={`${language.name} ${language.id}`} data-language-option={language.id} onSelect={() => choose(language.id)}>
                <span className="truncate">{language.name}</span>
                {language.id === languageId && <span className="ml-auto text-muted-foreground">{t('Current')}</span>}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
