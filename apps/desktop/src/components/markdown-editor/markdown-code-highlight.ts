import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

// Classes rather than colours, so markdown-editor.css can give each token its Light+/Dark+ value.
// Markdown's own tags stay unmapped: live preview styles those from the syntax tree.
const codeHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.definitionKeyword, t.operatorKeyword, t.bool, t.null, t.self], class: 'tok-keyword' },
  { tag: [t.controlKeyword, t.moduleKeyword], class: 'tok-control' },
  { tag: [t.string, t.special(t.string), t.character, t.docString], class: 'tok-string' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: 'tok-comment' },
  { tag: [t.number, t.integer, t.float, t.unit], class: 'tok-number' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], class: 'tok-type' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], class: 'tok-function' },
  { tag: [t.variableName, t.propertyName, t.labelName], class: 'tok-variable' },
  { tag: [t.tagName, t.angleBracket], class: 'tok-tag' },
  { tag: [t.attributeName], class: 'tok-attribute' },
  { tag: [t.regexp, t.escape], class: 'tok-regexp' }
])

export const codeHighlighting = syntaxHighlighting(codeHighlightStyle)
