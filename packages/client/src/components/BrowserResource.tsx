import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Resource } from '@jam/protocol';
import type {
  BrowserAnnotation,
  BrowserBounds,
  BrowserHost,
  BrowserHostEvent,
  BrowserPageState,
} from '../desktop';
import { PaneChrome, type PaneChromeProps } from './PaneChrome';
import { displayAddress, isLocalHost, parseAddress } from '../state/browser-address';
import { useNativeViewsOccluded } from '../state/native-occlusion';

/**
 * The Browser resource: Paper frame 2's bar, viewport and annotation tray.
 *
 * The page itself is a native view owned by the desktop host. This component
 * only measures where it belongs and forwards commands; it neither creates nor
 * destroys the page. Unmounting hides it, because closing a pane is
 * presentation, not lifecycle.
 */

type Chrome = Pick<
  PaneChromeProps,
  'focused' | 'onSplitRight' | 'onSplitDown' | 'onExpand' | 'expandLabel' | 'menu'
>;

export interface BrowserResourceProps {
  chrome: Chrome;
  resource: Resource;
  host: BrowserHost | undefined;
  /** Annotations made in this browser and not yet staged. */
  annotations: BrowserAnnotation[];
  /** Name of the conversation "Add to" stages into, if there is one. */
  destination?: string;
  onAnnotated(annotation: BrowserAnnotation): void;
  onClearAnnotations(): void;
  onStageAnnotations(): void;
  onError(error: unknown): void;
}

const BLANK: BrowserPageState = {
  url: 'about:blank',
  title: '',
  loading: false,
  canGoBack: null,
  canGoForward: null,
  blocked: null,
};

/**
 * One native view can be in one place. If a resource is shown in two panes,
 * the most recently mounted one presents it and the other says where it is.
 */
const claims = new Map<string, symbol[]>();
const claimListeners = new Set<() => void>();
function claim(resourceId: string, token: symbol) {
  claims.set(resourceId, [...(claims.get(resourceId) ?? []), token]);
  claimListeners.forEach((listener) => listener());
  return () => {
    const rest = (claims.get(resourceId) ?? []).filter((item) => item !== token);
    if (rest.length) claims.set(resourceId, rest);
    else claims.delete(resourceId);
    claimListeners.forEach((listener) => listener());
  };
}
function useOwnsView(resourceId: string) {
  const [token] = useState(() => Symbol(resourceId));
  const [owner, setOwner] = useState(true);
  useEffect(() => {
    const update = () => setOwner(claims.get(resourceId)?.at(-1) === token);
    claimListeners.add(update);
    const release = claim(resourceId, token);
    return () => {
      claimListeners.delete(update);
      release();
    };
  }, [resourceId, token]);
  return owner;
}

const same = (a: BrowserBounds | null, b: BrowserBounds | null) =>
  a === b ||
  (!!a &&
    !!b &&
    Math.round(a.x) === Math.round(b.x) &&
    Math.round(a.y) === Math.round(b.y) &&
    Math.round(a.width) === Math.round(b.width) &&
    Math.round(a.height) === Math.round(b.height));

export function BrowserResource({
  chrome,
  resource,
  host,
  annotations,
  destination,
  onAnnotated,
  onClearAnnotations,
  onStageAnnotations,
  onError,
}: BrowserResourceProps) {
  const page = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<BrowserPageState>(BLANK);
  const [attached, setAttached] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const occluded = useNativeViewsOccluded();
  const owner = useOwnsView(resource.id);
  const last = useRef<BrowserBounds | null | undefined>(undefined);
  const frame = useRef(0);
  const callbacks = useRef({ onAnnotated, onError });
  callbacks.current = { onAnnotated, onError };

  const blank = state.url === 'about:blank';
  const shown = !!host && attached && owner && !occluded && !blank;

  const measure = useCallback((): BrowserBounds | null => {
    const box = page.current?.getBoundingClientRect();
    if (!shown || !box || box.width < 2 || box.height < 2) return null;
    return { x: box.left, y: box.top, width: box.width, height: box.height };
  }, [shown]);

  /** Coalesced to one native update per frame, and only when it changed. */
  const sync = useCallback(() => {
    if (!host || !attached) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const next = measure();
      if (last.current !== undefined && same(last.current, next)) return;
      last.current = next;
      void host.setBounds(resource.id, next).catch(callbacks.current.onError);
    });
  }, [attached, host, measure, resource.id]);

  useEffect(() => {
    if (!host) return;
    let live = true;
    const listen = (event: BrowserHostEvent) => {
      if (!live) return;
      if (event.type === 'state') setState(event.state);
      else if (event.type === 'annotated') callbacks.current.onAnnotated(event.annotation);
      else setAnnotating(false);
    };
    host
      .attach(resource.id, null, listen)
      .then((initial) => {
        if (!live) return;
        setState(initial);
        last.current = null;
        setAttached(true);
      })
      .catch((error: unknown) => live && callbacks.current.onError(error));
    return () => {
      live = false;
      setAttached(false);
      cancelAnimationFrame(frame.current);
      last.current = undefined;
      // Hidden, not closed: the page survives its pane.
      void host.setBounds(resource.id, null).catch(() => {});
    };
  }, [host, resource.id]);

  // Any render may follow a layout change (a split drag, a tab switch, the
  // sidebar collapsing), so every render re-measures; unchanged bounds cost
  // nothing but a rectangle read.
  useLayoutEffect(sync);

  useEffect(() => {
    const element = page.current;
    if (!element || !host) return;
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    observer.observe(document.documentElement);
    window.addEventListener('resize', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [host, sync]);

  const act = (action: Parameters<BrowserHost['action']>[1]) =>
    host?.action(resource.id, action).catch(onError);

  const go = (input: string) => {
    const parsed = parseAddress(input);
    if ('error' in parsed) {
      setAddressError(parsed.error);
      return;
    }
    setAddressError(null);
    setAddress(null);
    void host?.navigate(resource.id, parsed.url).catch(onError);
  };

  const display = displayAddress(state.url);
  const editing = address !== null;
  const local = (() => {
    try {
      return isLocalHost(new URL(state.url).hostname);
    } catch {
      return false;
    }
  })();

  const bar = (
    <div className="browser-bar">
      <div className="browser-nav">
        <NavButton
          label="Back"
          disabled={!attached || blank || state.canGoBack === false}
          onClick={() => act('back')}
        >
          <path d="M10 3L5 8l5 5" />
        </NavButton>
        <NavButton
          label="Forward"
          disabled={!attached || blank || state.canGoForward === false}
          onClick={() => act('forward')}
        >
          <path d="M6 3l5 5-5 5" />
        </NavButton>
        {state.loading ? (
          <NavButton label="Stop loading" disabled={!attached} onClick={() => act('stop')}>
            <path d="M4 4l8 8M12 4l-8 8" />
          </NavButton>
        ) : (
          <NavButton label="Reload" disabled={!attached || blank} onClick={() => act('reload')}>
            <path d="M13 8a5 5 0 11-1.5-3.6M13 2.5V5h-2.5" />
          </NavButton>
        )}
      </div>
      <form
        className={`browser-address ${editing ? 'editing' : ''} ${addressError ? 'invalid' : ''}`}
        onSubmit={(event) => {
          event.preventDefault();
          go(address ?? state.url);
        }}
      >
        <span
          className={`browser-address-dot ${state.loading ? 'loading' : display.secure ? 'secure' : ''}`}
          aria-hidden="true"
        />
        {editing || blank ? (
          <input
            aria-label="Address"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            placeholder="localhost:5173 or an https address"
            value={address ?? ''}
            disabled={!host}
            autoFocus={editing}
            onFocus={() => setAddress((current) => current ?? (blank ? '' : state.url))}
            onChange={(event) => {
              setAddress(event.target.value);
              setAddressError(null);
            }}
            onBlur={() => {
              if (!addressError) setAddress(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setAddress(null);
                setAddressError(null);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="browser-address-display"
            title={state.url}
            onClick={() => setAddress(state.url)}
          >
            <span className="browser-origin">{display.origin}</span>
            <span className="browser-path">{display.rest}</span>
          </button>
        )}
      </form>
    </div>
  );

  const toggleAnnotate = () => {
    setAnnotating(!annotating);
    void act(annotating ? 'stopAnnotating' : 'annotate');
  };

  // One mode, not a tool per kind: in annotate mode a click marks an element
  // and a drag marks a region, each with a comment typed in the page.
  const tools = (
    <div className="browser-tools" role="toolbar" aria-label="Page tools">
      <button
        type="button"
        className={`browser-tool icon ${annotating ? '' : 'active'}`}
        aria-label="Interact with the page"
        aria-pressed={!annotating}
        title="Interact with the page"
        disabled={!attached || blank}
        onClick={() => (annotating ? toggleAnnotate() : void act('focus'))}
      >
        <Glyph>
          <path d="M3 2l9 5-4 1.2L6.5 13z" strokeLinejoin="round" />
        </Glyph>
      </button>
      <button
        type="button"
        className={`browser-tool ${annotating ? 'active' : ''}`}
        aria-pressed={annotating}
        title={`Annotate: click an element or drag a region, then comment.${
          local ? '' : ' Page contents are untrusted.'
        }`}
        disabled={!attached || blank}
        onClick={toggleAnnotate}
      >
        <Glyph>
          <path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z" strokeLinejoin="round" />
        </Glyph>
        <span>Annotate</span>
      </button>
    </div>
  );

  let placeholder: ReactNode = null;
  if (!host)
    placeholder = (
      <>
        <p>The browser runs in the desktop app.</p>
        <p className="subtle">
          This development preview cannot embed pages. Run <code>pnpm desktop</code> to browse.
        </p>
      </>
    );
  else if (!owner) placeholder = <p className="subtle">This page is showing in another pane.</p>;
  else if (blank)
    placeholder = (
      <>
        <p>Open a page</p>
        <p className="subtle">
          Type a dev server such as <code>localhost:5173</code> or any <code>https://</code>{' '}
          address. Sign-ins made here stay in jam&rsquo;s browser profile.
        </p>
      </>
    );

  return (
    <PaneChrome
      {...chrome}
      className="browser-pane"
      label={state.title ? `Browser · ${state.title}` : 'Browser'}
      heading={bar}
      status={tools}
    >
      <div className="browser-viewport">
        <div
          ref={page}
          className={`browser-page ${shown ? 'native' : ''} ${placeholder ? 'placeholder' : ''}`}
          data-browser-page={resource.id}
        >
          {placeholder && <div className="browser-placeholder">{placeholder}</div>}
        </div>
      </div>
      {(addressError || state.blocked) && (
        <div className="browser-notice" role="status">
          {addressError ?? state.blocked}
        </div>
      )}
      {(annotations.length > 0 || annotating) && (
        <div className="browser-tray">
          <div className="browser-tray-badges" aria-hidden="true">
            {annotations.slice(0, 6).map((annotation, index) => (
              <span key={index} className={annotation.kind}>
                {index + 1}
              </span>
            ))}
          </div>
          <div className="browser-tray-text">
            <strong>
              {annotations.length === 0
                ? 'Click an element, or drag to mark a region'
                : `${annotations.length} ${annotations.length === 1 ? 'annotation' : 'annotations'}`}
            </strong>
            <span>{trayDetail(annotations, annotating)}</span>
          </div>
          <button
            type="button"
            className="button ghost"
            disabled={!annotations.length}
            onClick={() => {
              onClearAnnotations();
              void act('clearAnnotations');
            }}
          >
            Clear
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!annotations.length || !destination}
            title={
              destination
                ? 'Stage these in the conversation. Nothing is sent until you press Send.'
                : 'Open a conversation to stage these annotations.'
            }
            onClick={() => {
              onStageAnnotations();
              void act('clearAnnotations');
            }}
          >
            {destination ? `Add to “${truncate(destination, 22)}”` : 'No conversation open'}
          </button>
        </div>
      )}
    </PaneChrome>
  );
}

const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

function trayDetail(annotations: BrowserAnnotation[], annotating: boolean) {
  if (!annotations.length)
    return annotating
      ? 'Each gets a comment · Esc in the page exits'
      : 'Staged, never sent automatically';
  const elements = annotations.filter((item) => item.kind === 'element').length;
  const regions = annotations.length - elements;
  const errors = annotations.reduce((count, item) => Math.max(count, item.consoleErrors), 0);
  return [
    elements && `${elements} ${elements === 1 ? 'element' : 'elements'}`,
    regions && `${regions} ${regions === 1 ? 'region' : 'regions'}`,
    `console${errors ? ` (${errors} ${errors === 1 ? 'error' : 'errors'})` : ''}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      focusable="false"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function NavButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="browser-nav-button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        aria-hidden="true"
      >
        {children}
      </svg>
    </button>
  );
}

/** An annotation as plain text for the staged context item. */
export function describeAnnotation(annotation: BrowserAnnotation): string {
  const { rect } = annotation;
  const lines = [
    annotation.comment && `Comment: ${annotation.comment}`,
    `Page: ${annotation.url}`,
    annotation.title && `Title: ${annotation.title}`,
    annotation.kind === 'element'
      ? `Element: ${annotation.selector}`
      : `Region: ${rect.width} × ${rect.height} at ${rect.x}, ${rect.y}${
          annotation.selector ? ` covering ${annotation.selector}` : ''
        }`,
    annotation.kind === 'element' && `Size: ${rect.width} × ${rect.height} at ${rect.x}, ${rect.y}`,
    annotation.text && `Text: ${annotation.text}`,
    Object.keys(annotation.styles).length > 0 &&
      `Styles: ${Object.entries(annotation.styles)
        .map(([name, value]) => `${name}: ${value}`)
        .join('; ')}`,
    annotation.html && `HTML: ${annotation.html}`,
    ...annotation.console.map((entry) => `Console ${entry.level}: ${entry.text}`),
    'Page details were reported by the page; untrusted.',
  ];
  return lines.filter(Boolean).join('\n').slice(0, 20_000);
}
