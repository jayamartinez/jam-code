import { tagHighlighter, tags } from '@lezer/highlight';

/**
 * JAM's code highlighter.
 *
 * Grammar tags map to semantic classes (`syntax-keyword`, `syntax-string`…),
 * and `styles/code.css` colours each class from the theme's `--syntax-*`
 * role. The same highlighter drives the CodeMirror editor and fenced code in
 * the Markdown preview, so a keyword is the same colour everywhere and a theme
 * change needs no JavaScript at all.
 */
export const jamHighlighter = tagHighlighter([
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.moduleKeyword,
      tags.operatorKeyword,
      tags.definitionKeyword,
      tags.modifier,
      tags.self,
    ],
    class: 'syntax-keyword',
  },
  {
    tag: [tags.string, tags.docString, tags.character, tags.attributeValue],
    class: 'syntax-string',
  },
  {
    tag: [
      tags.number,
      tags.integer,
      tags.float,
      tags.bool,
      tags.null,
      tags.atom,
      tags.unit,
      tags.constant(tags.variableName),
      tags.standard(tags.variableName),
    ],
    class: 'syntax-number',
  },
  {
    tag: [tags.regexp, tags.escape, tags.special(tags.string), tags.monospace],
    class: 'syntax-code',
  },
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.function(tags.definition(tags.variableName)),
    ],
    class: 'syntax-function',
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace, tags.labelName],
    class: 'syntax-type',
  },
  { tag: tags.propertyName, class: 'syntax-property' },
  { tag: [tags.definition(tags.propertyName)], class: 'syntax-property' },
  { tag: tags.variableName, class: 'syntax-variable' },
  { tag: tags.definition(tags.variableName), class: 'syntax-definition' },
  {
    tag: [
      tags.operator,
      tags.derefOperator,
      tags.arithmeticOperator,
      tags.logicOperator,
      tags.bitwiseOperator,
      tags.compareOperator,
      tags.updateOperator,
      tags.definitionOperator,
      tags.typeOperator,
      tags.controlOperator,
    ],
    class: 'syntax-operator',
  },
  {
    tag: [
      tags.punctuation,
      tags.separator,
      tags.bracket,
      tags.angleBracket,
      tags.squareBracket,
      tags.paren,
      tags.brace,
    ],
    class: 'syntax-punctuation',
  },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
    class: 'syntax-comment',
  },
  { tag: tags.tagName, class: 'syntax-tag' },
  { tag: tags.attributeName, class: 'syntax-attribute' },
  { tag: [tags.meta, tags.annotation, tags.macroName], class: 'syntax-meta' },
  {
    tag: [
      tags.heading,
      tags.heading1,
      tags.heading2,
      tags.heading3,
      tags.heading4,
      tags.heading5,
      tags.heading6,
    ],
    class: 'syntax-heading',
  },
  { tag: [tags.link, tags.url], class: 'syntax-link' },
  { tag: tags.emphasis, class: 'syntax-emphasis' },
  { tag: tags.strong, class: 'syntax-strong' },
  { tag: tags.strikethrough, class: 'syntax-strikethrough' },
  { tag: tags.quote, class: 'syntax-quote' },
  // Markdown's #, *, -, > and ``` marks, and horizontal rules. `tags.list`
  // covers a whole list item, so it is deliberately left uncoloured.
  { tag: [tags.processingInstruction, tags.contentSeparator], class: 'syntax-marker' },
  { tag: tags.inserted, class: 'syntax-inserted' },
  { tag: tags.deleted, class: 'syntax-deleted' },
  { tag: tags.changed, class: 'syntax-changed' },
  { tag: tags.invalid, class: 'syntax-invalid' },
]);
