import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { classifyImage, classifyLink, resolveProjectPath } from './links';
import { renderMarkdown } from './render';

function html(source: string, onLink = vi.fn()) {
  return renderToStaticMarkup(
    createElement(
      'article',
      null,
      renderMarkdown(source, {
        directory: 'docs',
        onLink,
        code: (content: string, info: string, key: number): ReactNode =>
          createElement('pre', { key, 'data-info': info }, content),
      }),
    ),
  );
}

describe('Markdown rendering is safe for untrusted repository content', () => {
  const attacks = [
    '<script>alert(1)</script>',
    '<img src=x onerror="alert(1)">',
    '<iframe src="https://evil.example"></iframe>',
    '<a href="javascript:alert(1)">click</a>',
    '<svg onload=alert(1)><circle/></svg>',
    '<style>body{display:none}</style>',
    '<div onclick="steal()">x</div>',
  ];

  it.each(attacks)('shows raw HTML as text: %s', (attack) => {
    const output = html(`before\n\n${attack}\n\nafter ${attack}`);
    expect(output).not.toMatch(/<(script|iframe|style|svg|img)\b/i);
    // No element carries an event handler; the text may mention one.
    expect(output).not.toMatch(/<[a-z][^>]*\son[a-z]+=/i);
    expect(output).toContain('&lt;');
  });

  it('never emits a real destination as an href', () => {
    const output = html(
      [
        '[js](javascript:alert(1)) [vb](vbscript:msgbox) [data](data:text/html;base64,PHNjcmlwdD4=)',
        '[file](file:///etc/passwd) [tauri](tauri://localhost) [ipc](ipc://localhost/cmd)',
        '[web](https://example.com/docs) [rel](../README.md) [anchor](#usage) <https://jam.dev>',
        '[tab](java\tscript:alert(1)) [spaced]( JAVASCRIPT:alert(1))',
      ].join('\n\n'),
    );
    const hrefs = [...output.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    expect(new Set(hrefs)).toEqual(new Set(['#']));
    // Refused destinations appear only as text and in a tooltip, never as a target.
    expect(output).not.toMatch(/(href|src|action)="[^"#]/i);
    expect(output).toContain('md-link-inert');
  });

  it('loads only inline raster images and labels every other image', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const output = html(
      `![logo](${png}) ![remote](https://tracker.example/pixel.gif) ![local](./diagram.png) ![svg](data:image/svg+xml;base64,PHN2Zz4=)`,
    );
    expect(output.match(/<img /g)).toHaveLength(1);
    expect(output).toContain(`src="${png}"`);
    expect(output).toContain('Remote image not loaded');
    expect(output).toContain('Project image not shown yet');
    const sources = [...output.matchAll(/src="([^"]*)"/g)].map((match) => match[1]);
    expect(sources).toEqual([png]);
  });
});

describe('Markdown rendering covers the documents agents write', () => {
  const report = `---
title: Report
---

# Pane restore

Intro with **strong**, *emphasis*, ~~gone~~ and \`inline code\`.

## Steps

1. First
2. Second

- [x] Done task
- [ ] Open task

> A quoted note.

| Check | Result |
| :---- | -----: |
| lint  | pass   |

---

\`\`\`ts
const a = 1;
\`\`\`

## Steps
`;

  it('renders headings with stable, prefixed anchors', () => {
    const output = html(report);
    expect(output).toContain('<h1 id="md-pane-restore">Pane restore</h1>');
    expect(output).toContain('<h2 id="md-steps">Steps</h2>');
    expect(output).toContain('<h2 id="md-steps-1">Steps</h2>');
  });

  it('renders emphasis, lists, tasks, quotes, tables, rules, code and front matter', () => {
    const output = html(report);
    expect(output).toContain('<strong>strong</strong>');
    expect(output).toContain('<em>emphasis</em>');
    expect(output).toContain('<del>gone</del>');
    expect(output).toContain('<code>inline code</code>');
    expect(output).toMatch(/<ol><li>First<\/li><li>Second<\/li><\/ol>/);
    expect(output).toMatch(
      /<li class="md-task"><input type="checkbox" disabled="" aria-label="Done" checked=""/,
    );
    expect(output).toContain('Open task');
    expect(output).not.toContain('[ ]');
    expect(output).toContain('<blockquote><p>A quoted note.</p></blockquote>');
    expect(output).toContain('<th style="text-align:left">Check</th>');
    expect(output).toContain('<td style="text-align:right">pass</td>');
    expect(output).toContain('<hr/>');
    expect(output).toContain('<pre data-info="ts">const a = 1;\n</pre>');
    expect(output).toContain('<pre data-info="yaml">title: Report</pre>');
  });

  it('hands link clicks to JAM classified, never to the window', () => {
    const onLink = vi.fn();
    const nodes = renderMarkdown('[guide](./guide.md#setup) [site](https://jam.dev)', {
      directory: 'docs',
      onLink,
      code: () => null,
    });
    const paragraph = (nodes as ReactNode[])[0] as { props: { children: ReactNode } };
    const inline = paragraph.props.children as { props: { children: ReactNode[] } }[];
    const anchors = (
      inline[0]!.props.children as { props: { onClick(event: unknown): void } }[]
    ).filter((child) => typeof child === 'object' && child && 'props' in child);
    const event = { preventDefault: vi.fn() };
    anchors[0]!.props.onClick(event);
    anchors[1]!.props.onClick(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
    expect(onLink).toHaveBeenNthCalledWith(1, {
      kind: 'file',
      path: 'docs/guide.md',
      hash: 'setup',
    });
    expect(onLink).toHaveBeenNthCalledWith(2, { kind: 'web', url: 'https://jam.dev/' });
  });
});

describe('link classification', () => {
  it('resolves project paths without leaving the project', () => {
    expect(resolveProjectPath('docs/adr', '../ARCHITECTURE.md')).toBe('docs/ARCHITECTURE.md');
    expect(resolveProjectPath('docs', './img/a%20b.png')).toBe('docs/img/a b.png');
    expect(resolveProjectPath('docs', '/README.md')).toBe('README.md');
    expect(resolveProjectPath('docs', '../../etc/passwd')).toBeNull();
    expect(resolveProjectPath('', '..')).toBeNull();
    expect(resolveProjectPath('docs', 'a\\..\\..\\b')).toBeNull();
    expect(resolveProjectPath('docs', '%zz')).toBeNull();
  });

  it('classifies destinations into anchors, web pages, project files or nothing', () => {
    expect(classifyLink('#Usage', 'docs')).toEqual({ kind: 'anchor', id: 'md-usage' });
    expect(classifyLink('http://localhost:5173/a', '')).toEqual({
      kind: 'web',
      url: 'http://localhost:5173/a',
    });
    expect(classifyLink('mailto:a@b.c', '')).toEqual({ kind: 'none' });
    expect(classifyLink('//evil.example/x', '')).toEqual({ kind: 'none' });
    expect(classifyLink('https:', '')).toEqual({ kind: 'none' });
    expect(classifyLink('src/lib.rs?plain=1', '')).toEqual({ kind: 'file', path: 'src/lib.rs' });
    expect(classifyImage('//cdn.example/a.png', '')).toEqual({
      kind: 'web',
      url: 'https://cdn.example/a.png',
    });
  });
});

describe('file links in agent replies', () => {
  const links = (source: string) =>
    renderToStaticMarkup(
      createElement(
        'article',
        null,
        renderMarkdown(source, {
          directory: '',
          onLink: vi.fn(),
          code: (content: string, _info: string, key: number): ReactNode =>
            createElement('pre', { key }, content),
          fileLink: (file, label, key) =>
            createElement('a', { key, 'data-file': `${file.path}#${file.line ?? ''}` }, label),
        }),
      ),
    ).match(/data-file="[^"]*"/g) ?? [];

  it('links project files in inline code and unambiguous prose', () => {
    expect(
      links('Added it at math.ts:20, see `src/math.test.ts` and (docs/PROVIDERS.md).'),
    ).toEqual([
      'data-file="math.ts#20"',
      'data-file="src/math.test.ts#"',
      'data-file="docs/PROVIDERS.md#"',
    ]);
  });

  it('leaves words, code and existing links alone', () => {
    expect(links('Node.js and `pty.kill` stay text; e.g. a/b too.')).toEqual([]);
    expect(links('[the guide](https://example.com/src/a.ts)')).toEqual([]);
  });
});

describe('inline code a caller recognises', () => {
  const render = (source: string) =>
    renderToStaticMarkup(
      createElement(
        'article',
        null,
        renderMarkdown(source, {
          directory: '',
          onLink: vi.fn(),
          code: (content: string, _info: string, key: number): ReactNode =>
            createElement('pre', { key }, content),
          fileLink: (file, label, key) =>
            createElement('a', { key, 'data-file': file.path }, label),
          inlineCode: (content, key) =>
            content === 'My Resume.pdf'
              ? createElement('button', { key, 'data-attachment': content }, content)
              : undefined,
        }),
      ),
    );

  it('replaces the span it claims and leaves the rest to the usual rules', () => {
    const html = render('Read `My Resume.pdf`, then `src/a.ts` and `pty.kill`.');
    expect(html).toContain('<button data-attachment="My Resume.pdf">My Resume.pdf</button>');
    expect(html).toContain('data-file="src/a.ts"');
    expect(html).toContain('<code>pty.kill</code>');
  });

  it('is not asked about code inside a link, a code block or plain prose', () => {
    const html = render(
      '[`My Resume.pdf`](https://example.com) and My Resume.pdf\n\n```\nMy Resume.pdf\n```',
    );
    expect(html).not.toContain('data-attachment');
  });
});
