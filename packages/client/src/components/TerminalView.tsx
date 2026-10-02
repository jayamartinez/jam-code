import { useEffect, useRef, useState } from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';
import type { JamTransport, TerminalSession } from '@jam/protocol';
import { TerminalConnection } from '../state/terminal-connection';
import { terminalMetrics } from './terminal-metrics';
import { useAppearance } from '../appearance/store';

/**
 * xterm.js stays inside this module, which is loaded only when a terminal
 * pane is actually mounted. Everything outside deals in JAM's terminal
 * contract. Unmounting disposes xterm and detaches the view; the shell is
 * owned by the runtime and keeps running.
 */

export interface TerminalViewProps {
  transport: JamTransport;
  resourceId: string;
  /** Mac keyboards copy, paste and find with ⌘; others use Ctrl+Shift. */
  mac: boolean;
  autoFocus: boolean;
  onSession(terminal: TerminalSession | undefined): void;
  onError(message: string | null): void;
  /** The view's size in cells, for starting a shell at the right size. */
  onSize(size: { cols: number; rows: number }): void;
}

const SCROLLBACK = 5000;

/**
 * Applies the reader's terminal font, size and line to a live terminal. xterm
 * multiplies its own measured cell height, so the line is calibrated against
 * the rows it actually rendered to reach the requested pixel line. The screen
 * is sized on xterm's next frame, so this measures after one.
 */
async function applyTypography(term: Terminal, element: HTMLElement, isDisposed: () => boolean) {
  const metrics = terminalMetrics(element);
  // Measuring before the face loads would size cells for a fallback.
  await document.fonts?.load(`${metrics.fontSize}px ${metrics.fontFamily}`).catch(() => {});
  if (isDisposed()) return;
  term.options.fontFamily = metrics.fontFamily;
  term.options.fontSize = metrics.fontSize;
  for (let attempt = 0; attempt < 3 && !isDisposed(); attempt++) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const height = element.querySelector('.xterm-screen')?.getBoundingClientRect().height;
    if (!height || !term.rows) continue;
    const rendered = height / term.rows;
    term.options.lineHeight =
      (metrics.lineHeight + 0.25) / (rendered / (term.options.lineHeight ?? 1));
    break;
  }
}

/** Reads a color role from the pane and normalizes it for xterm. */
function resolveColor(probe: HTMLElement, role: string): string | undefined {
  probe.style.color = `var(${role})`;
  const value = getComputedStyle(probe).color.trim();
  // `color-mix()` computes to `color(srgb r g b / a)`, which xterm does not parse.
  const srgb = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/.exec(value);
  if (srgb) {
    const [r, g, b] = srgb.slice(1, 4).map((channel) => Math.round(Number(channel) * 255));
    return `rgba(${r}, ${g}, ${b}, ${srgb[4] ?? 1})`;
  }
  return value || undefined;
}

function themeFrom(element: HTMLElement): ITheme {
  const probe = document.createElement('span');
  probe.hidden = true;
  element.append(probe);
  const read = (role: string) => resolveColor(probe, `--terminal-${role}`);
  const theme: ITheme = {
    // The pane's translucent surface shows through.
    background: 'rgba(0, 0, 0, 0)',
    foreground: read('foreground'),
    cursor: read('cursor'),
    cursorAccent: read('cursor-accent'),
    selectionBackground: read('selection'),
    selectionInactiveBackground: read('selection-inactive'),
    scrollbarSliderBackground: read('scrollbar'),
    scrollbarSliderHoverBackground: read('scrollbar-hover'),
    scrollbarSliderActiveBackground: read('scrollbar-hover'),
    black: read('black'),
    red: read('red'),
    green: read('green'),
    yellow: read('yellow'),
    blue: read('blue'),
    magenta: read('magenta'),
    cyan: read('cyan'),
    white: read('white'),
    brightBlack: read('bright-black'),
    brightRed: read('bright-red'),
    brightGreen: read('bright-green'),
    brightYellow: read('bright-yellow'),
    brightBlue: read('bright-blue'),
    brightMagenta: read('bright-magenta'),
    brightCyan: read('bright-cyan'),
    brightWhite: read('bright-white'),
  };
  probe.remove();
  return theme;
}

export default function TerminalView({
  transport,
  resourceId,
  mac,
  autoFocus,
  onSession,
  onError,
  onSize,
}: TerminalViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const search = useRef<SearchAddon | null>(null);
  const terminal = useRef<Terminal | null>(null);
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<{ index: number; count: number } | null>(null);
  // Callbacks change identity on every parent render; the effect must not.
  const callbacks = useRef({ onSession, onError, onSize });
  callbacks.current = { onSession, onError, onSize };
  const focusOnMount = useRef(autoFocus);
  const { appearance } = useAppearance();
  /** Re-fits after a typography change; set once the terminal is open. */
  const refit = useRef<(() => void) | null>(null);

  useEffect(() => {
    const element = screen.current;
    const pane = host.current;
    if (!element || !pane) return;
    let disposed = false;
    const metrics = terminalMetrics(pane);
    const term = new Terminal({
      allowProposedApi: true,
      allowTransparency: true,
      cursorBlink: false,
      cursorInactiveStyle: 'outline',
      fontFamily: metrics.fontFamily,
      fontSize: metrics.fontSize,
      scrollback: SCROLLBACK,
      macOptionIsMeta: false,
      rightClickSelectsWord: false,
      theme: themeFrom(pane),
    });
    const fit = new FitAddon();
    const finder = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(finder);
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = '11';
    terminal.current = term;
    search.current = finder;
    const results = finder.onDidChangeResults(({ resultIndex, resultCount }) =>
      setMatches({ index: resultIndex, count: resultCount }),
    );

    const connection = new TerminalConnection(
      transport,
      resourceId,
      {
        write: (data, rendered) => term.write(data, rendered),
        reset: () => term.reset(),
      },
      {
        onSession: (session) => callbacks.current.onSession(session),
        onError: (message) => callbacks.current.onError(message),
      },
    );

    const clipboard = (text: string) => {
      if (text) void navigator.clipboard?.writeText(text).catch(() => {});
    };
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const key = event.key.toLowerCase();
      const primary = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && event.shiftKey;
      if (primary && key === 'f') {
        event.preventDefault();
        setFinding(true);
        requestAnimationFrame(() => findInput.current?.select());
        return false;
      }
      if (mac) return true;
      // Windows and Linux: Ctrl+Shift+C/V copy and paste. Ctrl+C copies only
      // while text is selected; otherwise it interrupts, as in a terminal.
      if (event.ctrlKey && event.shiftKey && key === 'c') {
        event.preventDefault();
        clipboard(term.getSelection());
        return false;
      }
      if (event.ctrlKey && !event.shiftKey && key === 'c' && term.hasSelection()) {
        event.preventDefault();
        clipboard(term.getSelection());
        term.clearSelection();
        return false;
      }
      // Leave paste to the browser's paste event, which xterm handles.
      if (event.ctrlKey && key === 'v') return false;
      return true;
    });

    // Keys a shell needs must not trigger JAM's window shortcuts. On a Mac
    // those use ⌘, which a terminal does not, so only Ctrl and Escape stop.
    const keep = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || (!mac && event.ctrlKey)) event.stopPropagation();
    };
    element.addEventListener('keydown', keep);

    const input = term.onData((data) => connection.input(data));
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (disposed || !element.clientWidth || !element.clientHeight) return;
        fit.fit();
        callbacks.current.onSize({ cols: term.cols, rows: term.rows });
        connection.resize(term.cols, term.rows);
      });
    };
    const observer = new ResizeObserver(measure);

    const isDisposed = () => disposed;
    void (async () => {
      await document.fonts?.load(`${metrics.fontSize}px ${metrics.fontFamily}`).catch(() => {});
      if (disposed) return;
      term.open(element);
      await applyTypography(term, element, isDisposed);
      if (disposed) return;
      fit.fit();
      callbacks.current.onSize({ cols: term.cols, rows: term.rows });
      connection.resize(term.cols, term.rows);
      observer.observe(element);
      refit.current = () => {
        void applyTypography(term, element, isDisposed).then(measure);
      };
      if (focusOnMount.current) term.focus();
      await connection.open();
    })();

    return () => {
      disposed = true;
      refit.current = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener('keydown', keep);
      input.dispose();
      results.dispose();
      // Detach only: the shell belongs to the runtime.
      connection.close();
      term.dispose();
      terminal.current = null;
      search.current = null;
    };
  }, [mac, resourceId, transport]);

  // Appearance changes update the live terminal in place: colors are re-read
  // from the pane's roles, and a typography change re-measures and re-fits.
  // The terminal, its scrollback and its connection are never recreated.
  const typography = `${appearance.terminalFont}|${appearance.codeFont}|${appearance.terminalFontSize}|${appearance.terminalLineHeight}`;
  const colors = `${appearance.theme}|${appearance.accent}|${appearance.customAccent}`;
  useEffect(() => {
    const term = terminal.current;
    if (term && host.current) term.options.theme = themeFrom(host.current);
  }, [colors]);
  useEffect(() => {
    refit.current?.();
  }, [typography]);

  const decorations = () => {
    const probe = host.current;
    if (!probe) return undefined;
    const span = document.createElement('span');
    probe.append(span);
    const match = resolveColor(span, '--terminal-match') ?? 'rgba(111, 155, 255, 0.12)';
    const active = resolveColor(span, '--terminal-match-active') ?? match;
    span.remove();
    return {
      matchBackground: match,
      matchOverviewRuler: match,
      activeMatchBackground: active,
      activeMatchColorOverviewRuler: active,
    };
  };
  const find = (backwards = false, incremental = false) => {
    const options = { decorations: decorations(), incremental };
    if (!query) {
      search.current?.clearDecorations();
      setMatches(null);
      return;
    }
    if (backwards) search.current?.findPrevious(query, options);
    else search.current?.findNext(query, options);
  };
  const closeFind = () => {
    setFinding(false);
    search.current?.clearDecorations();
    setMatches(null);
    terminal.current?.focus();
  };

  return (
    <div className="terminal-body" ref={host}>
      <div className="terminal-screen" ref={screen} />
      {finding && (
        <div className="terminal-find" role="search">
          <input
            ref={findInput}
            aria-label="Find in terminal"
            placeholder="Find"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyUp={(event) => {
              if (event.key !== 'Enter' && event.key !== 'Escape') find(false, true);
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Escape') closeFind();
              else if (event.key === 'Enter') {
                event.preventDefault();
                find(event.shiftKey);
              }
            }}
          />
          <output aria-live="polite">
            {matches && query
              ? matches.count
                ? `${matches.index + 1}/${matches.count}`
                : 'None'
              : ''}
          </output>
          <button
            type="button"
            className="pane-button"
            aria-label="Previous match"
            onClick={() => find(true)}
          >
            ↑
          </button>
          <button
            type="button"
            className="pane-button"
            aria-label="Next match"
            onClick={() => find()}
          >
            ↓
          </button>
          <button type="button" className="pane-button" aria-label="Close find" onClick={closeFind}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
