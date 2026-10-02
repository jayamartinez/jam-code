import MarkdownIt, { type Token } from 'markdown-it';
import { Fragment, type ReactNode } from 'react';
import {
  classifyImage,
  classifyLink,
  headingId,
  resolveProjectPath,
  type LinkTarget,
} from './links';
import { fileReference, lineFromHash, type FileReference } from './file-refs';

/**
 * Markdown → React elements, with no HTML string in between.
 *
 * markdown-it parses CommonMark plus GitHub tables and strikethrough with raw
 * HTML disabled, so `<script>`, `<iframe>` or `onerror=` in a README is shown
 * as the text it is. Its token stream is then turned into React elements
 * here, one allowed element per token type; anything unrecognised becomes
 * text. Nothing is ever assigned to `innerHTML`, attributes are never copied
 * from the source, and every link and image goes through `links.ts`.
 */

const parser = new MarkdownIt('default', {
  html: false,
  linkify: true,
  typographer: false,
});
// Destinations are classified by `links.ts`, which is stricter; letting every
// destination parse means a refused link still shows its label, not raw syntax.
parser.validateLink = () => true;

/** Rendering stops beyond this many characters; the rest is summarised. */
export const MARKDOWN_LIMIT = 1_000_000;
const FRONTMATTER = /^---\r?\n([\s\S]{0,8000}?)\r?\n---\r?\n/;
const TASK = /^\[([ xX])\][ \t]/;

export interface MarkdownOptions {
  /** The document's folder, project-relative, used to resolve relative links. */
  directory: string;
  onLink(target: LinkTarget): void;
  /** Renders a fenced or indented code block; highlighting is the caller's. */
  code(content: string, info: string, key: number): ReactNode;
  /**
   * Renders a link to a project file. When given, file links use it, and
   * inline code that names a project file (`src/a.ts:18`) becomes one too.
   */
  fileLink?(file: FileReference, label: ReactNode, key: number): ReactNode;
  /**
   * Asked first about each inline code span outside a link; a node it returns
   * replaces the span. For names only the caller knows, such as attachments.
   */
  inlineCode?(content: string, key: number): ReactNode | undefined;
}

interface Context extends MarkdownOptions {
  key: number;
  headingIds: Map<Token, string>;
  tasks: Map<Token, boolean>;
}

/** Task items and heading anchors are found before rendering, while tokens are still flat. */
function prepare(tokens: Token[]) {
  const headingIds = new Map<Token, string>();
  const tasks = new Map<Token, boolean>();
  const used = new Map<string, number>();
  tokens.forEach((token, index) => {
    if (token.type === 'heading_open') {
      headingIds.set(token, headingId(tokens[index + 1]?.content ?? '', used));
    }
    if (token.type === 'list_item_open') {
      const inline = tokens[index + 2];
      const match = inline?.type === 'inline' ? TASK.exec(inline.content) : null;
      const first = inline?.children?.[0];
      if (match && first?.type === 'text') {
        tasks.set(token, match[1] !== ' ');
        first.content = first.content.replace(TASK, '');
      }
    }
  });
  return { headingIds, tasks };
}

const ALIGN = /^text-align:(left|center|right)$/;

function element(token: Token, children: ReactNode[], context: Context): ReactNode {
  const key = context.key++;
  switch (token.type) {
    case 'paragraph_open':
      // Tight list items hide their paragraphs.
      return token.hidden ? <Fragment key={key}>{children}</Fragment> : <p key={key}>{children}</p>;
    case 'heading_open': {
      const Tag = (/^h[1-6]$/.test(token.tag) ? token.tag : 'h6') as 'h1';
      return (
        <Tag key={key} id={context.headingIds.get(token)}>
          {children}
        </Tag>
      );
    }
    case 'bullet_list_open':
      return <ul key={key}>{children}</ul>;
    case 'ordered_list_open': {
      const start = Number(token.attrGet('start'));
      return (
        <ol key={key} start={Number.isSafeInteger(start) && start > 0 ? start : undefined}>
          {children}
        </ol>
      );
    }
    case 'list_item_open': {
      const task = context.tasks.get(token);
      if (task === undefined) return <li key={key}>{children}</li>;
      return (
        <li key={key} className="md-task">
          <input type="checkbox" checked={task} disabled aria-label={task ? 'Done' : 'Not done'} />
          <span>{children}</span>
        </li>
      );
    }
    case 'blockquote_open':
      return <blockquote key={key}>{children}</blockquote>;
    case 'table_open':
      return (
        <div key={key} className="md-table">
          <table>{children}</table>
        </div>
      );
    case 'thead_open':
      return <thead key={key}>{children}</thead>;
    case 'tbody_open':
      return <tbody key={key}>{children}</tbody>;
    case 'tr_open':
      return <tr key={key}>{children}</tr>;
    case 'th_open':
    case 'td_open': {
      const align = ALIGN.exec(String(token.attrGet('style') ?? ''))?.[1] as
        'left' | 'center' | 'right' | undefined;
      const Cell = token.type === 'th_open' ? 'th' : 'td';
      return (
        <Cell key={key} style={align ? { textAlign: align } : undefined}>
          {children}
        </Cell>
      );
    }
    case 'em_open':
      return <em key={key}>{children}</em>;
    case 'strong_open':
      return <strong key={key}>{children}</strong>;
    case 's_open':
      return <del key={key}>{children}</del>;
    case 'link_open': {
      const href = String(token.attrGet('href') ?? '');
      const target = classifyLink(href, context.directory);
      if (target.kind === 'none')
        return (
          <span key={key} className="md-link-inert" title={`Not opened: ${href.slice(0, 200)}`}>
            {children}
          </span>
        );
      if (target.kind === 'file' && context.fileLink) {
        const line = lineFromHash(target.hash);
        return context.fileLink(
          line ? { path: target.path, line } : { path: target.path },
          children,
          key,
        );
      }
      const shown =
        target.kind === 'web' ? target.url : target.kind === 'file' ? target.path : `#${target.id}`;
      return (
        // The real destination is never an `href`: JAM's own window must not
        // navigate, even on a middle-click or a modified click.
        <a
          key={key}
          href="#"
          title={target.kind === 'web' ? `${shown} — opens in a JAM browser` : shown}
          className={`md-link md-link-${target.kind}`}
          onClick={(event) => {
            event.preventDefault();
            context.onLink(target);
          }}
          onAuxClick={(event) => event.preventDefault()}
          draggable={false}
        >
          {children}
        </a>
      );
    }
    default:
      return <Fragment key={key}>{children}</Fragment>;
  }
}

function leaf(token: Token, context: Context, inLink = false): ReactNode {
  const key = context.key++;
  switch (token.type) {
    case 'text':
      return context.fileLink && !inLink ? linkPaths(token.content, context, key) : token.content;
    case 'softbreak':
      return '\n';
    case 'hardbreak':
      return <br key={key} />;
    case 'code_inline': {
      const custom = inLink ? undefined : context.inlineCode?.(token.content, key);
      if (custom !== undefined) return custom;
      const file = context.fileLink && !inLink ? fileReference(token.content) : null;
      const path = file && resolveProjectPath(context.directory, file.path);
      if (file && path && context.fileLink)
        return context.fileLink({ ...file, path }, token.content, key);
      return <code key={key}>{token.content}</code>;
    }
    case 'hr':
      return <hr key={key} />;
    case 'fence':
      return context.code(token.content, token.info, key);
    case 'code_block':
      return context.code(token.content, '', key);
    case 'inline':
      return <Fragment key={key}>{tree(token.children ?? [], context)}</Fragment>;
    case 'image': {
      const src = String(token.attrGet('src') ?? '');
      const alt = token.children?.map((child) => child.content).join('') || token.content;
      const image = classifyImage(src, context.directory);
      if (image.kind === 'inline')
        return <img key={key} src={image.src} alt={alt} loading="lazy" decoding="async" />;
      const note =
        image.kind === 'web'
          ? 'Remote image not loaded'
          : image.kind === 'file'
            ? 'Project image not shown yet'
            : 'Image not shown';
      return (
        <span
          key={key}
          className="md-image-placeholder"
          title={image.kind === 'web' ? image.url : image.kind === 'file' ? image.path : undefined}
        >
          <span aria-hidden="true">▢</span>
          <span>{alt || 'Image'}</span>
          <small>{note}</small>
        </span>
      );
    }
    default:
      // html_block/html_inline cannot occur with html disabled; if a future
      // rule produced one, its source would still render only as text.
      return token.content || null;
  }
}

const EDGE = /^([("'[]*)(.*?)([.,;:!?)"'\]]*)$/s;

/**
 * Paths an agent writes in plain prose, like "added it at math.ts:20".
 * Only unambiguous ones: a folder (`src/a.ts`) or a line (`a.ts:20`), so
 * words such as "Node.js" stay words.
 */
function linkPaths(text: string, context: Context, key: number): ReactNode {
  const parts = text.split(/(\s+)/);
  let linked = false;
  const nodes = parts.map((part, index) => {
    const [, lead = '', core = '', trail = ''] = EDGE.exec(part) ?? [];
    const file = core ? fileReference(core) : null;
    const path = file && resolveProjectPath(context.directory, file.path);
    if (!file || !path || !context.fileLink || (!core.includes('/') && !file.line)) return part;
    linked = true;
    return (
      <Fragment key={index}>
        {lead}
        {context.fileLink({ ...file, path }, core, index)}
        {trail}
      </Fragment>
    );
  });
  return linked ? <Fragment key={key}>{nodes}</Fragment> : text;
}

function tree(tokens: Token[], context: Context): ReactNode[] {
  const stack: { token: Token | null; children: ReactNode[] }[] = [{ token: null, children: [] }];
  for (const token of tokens) {
    if (token.nesting === 1) {
      stack.push({ token, children: [] });
    } else if (token.nesting === -1 && stack.length > 1) {
      const frame = stack.pop()!;
      stack.at(-1)!.children.push(element(frame.token!, frame.children, context));
    } else if (token.nesting === 0) {
      const inLink = stack.some((frame) => frame.token?.type === 'link_open');
      stack.at(-1)!.children.push(leaf(token, context, inLink));
    }
  }
  // An unclosed element (never produced by markdown-it) still renders its content.
  while (stack.length > 1) {
    const frame = stack.pop()!;
    stack.at(-1)!.children.push(element(frame.token!, frame.children, context));
  }
  return stack[0]!.children;
}

export function renderMarkdown(source: string, options: MarkdownOptions): ReactNode {
  const truncated = source.length > MARKDOWN_LIMIT;
  let text = truncated ? source.slice(0, MARKDOWN_LIMIT) : source;
  const context: Context = { ...options, key: 0, headingIds: new Map(), tasks: new Map() };
  const nodes: ReactNode[] = [];
  const frontmatter = FRONTMATTER.exec(text);
  if (frontmatter) {
    text = text.slice(frontmatter[0].length);
    nodes.push(
      <div key="frontmatter" className="md-frontmatter" aria-label="Front matter">
        {options.code(frontmatter[1] ?? '', 'yaml', -1)}
      </div>,
    );
  }
  const tokens = parser.parse(text, {});
  const prepared = prepare(tokens);
  context.headingIds = prepared.headingIds;
  context.tasks = prepared.tasks;
  nodes.push(...tree(tokens, context));
  if (truncated)
    nodes.push(
      <p key="truncated" className="md-truncated">
        The rest of this document is not rendered. Switch to Source to read all of it.
      </p>,
    );
  return nodes;
}
