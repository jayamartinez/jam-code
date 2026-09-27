import { Suspense, lazy, useCallback, useRef, useState } from 'react';
import type { JamTransport, Project, Resource, TerminalSession } from '@jam/protocol';
import { PaneChrome, type PaneChromeProps, type PaneMenuItem } from './PaneChrome';

const TerminalView = lazy(() => import('./TerminalView'));

/**
 * A terminal resource in a pane.
 *
 * The pane is a view: mounting it attaches to the runtime's shell and
 * unmounting detaches. Closing the pane, switching tabs or changing layout
 * therefore never ends the shell. Terminating is a separate, explicit command
 * in the pane menu.
 */

export interface TerminalResourceProps extends Pick<
  PaneChromeProps,
  'focused' | 'onSplitRight' | 'onSplitDown' | 'onExpand' | 'expandLabel' | 'menu'
> {
  transport: JamTransport;
  resource: Resource;
  project?: Project;
  mac: boolean;
}

const TerminalGlyph = () => (
  <svg className="terminal-glyph" width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M3 4.5l3.5 3.5L3 11.5M8.5 12h4.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

function exitText(terminal: TerminalSession) {
  if (terminal.terminated) return 'Shell terminated';
  if (terminal.exitSignal) return `Shell ended by ${terminal.exitSignal}`;
  if (terminal.exitCode === undefined) return 'Shell ended';
  return `Shell exited with code ${terminal.exitCode}`;
}

export function TerminalResource({
  transport,
  resource,
  project,
  mac,
  menu,
  ...chrome
}: TerminalResourceProps) {
  /** Undefined until the runtime answers; null when no shell exists. */
  const [terminal, setTerminal] = useState<TerminalSession | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const size = useRef<{ cols: number; rows: number } | undefined>(undefined);

  const onSession = useCallback((session: TerminalSession | undefined) => {
    setTerminal(session ?? null);
    setError(null);
  }, []);
  const onSize = useCallback((next: { cols: number; rows: number }) => {
    size.current = next;
  }, []);

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      // The attached view receives the new session as an event.
      await transport.request('terminal.start', {
        resourceId: resource.id,
        ...(size.current ?? {}),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The shell could not be started.');
    } finally {
      setStarting(false);
    }
  }, [resource.id, transport]);

  const terminate = useCallback(async () => {
    try {
      await transport.request('terminal.kill', { resourceId: resource.id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The shell could not be stopped.');
    }
  }, [resource.id, transport]);

  const running = terminal?.status === 'running';
  const lifecycle: PaneMenuItem[] = running
    ? [{ label: 'Terminate shell', onSelect: () => void terminate(), danger: true }]
    : [
        {
          label: terminal ? 'Restart shell' : 'Start shell',
          ...(error && terminal === undefined
            ? { unavailable: error }
            : { onSelect: () => void start() }),
        },
      ];

  return (
    <PaneChrome
      {...chrome}
      menu={[...lifecycle, ...(menu ?? [])]}
      className="terminal-pane"
      label={`${terminal?.title ?? resource.title} terminal`}
      heading={
        <span className="terminal-heading">
          <TerminalGlyph />
          <span className="terminal-shell" title={terminal?.shell}>
            {terminal?.title ?? resource.title}
          </span>
          {terminal && (
            <span className="terminal-cwd" title={terminal.cwd}>
              {terminal.cwdLabel}
            </span>
          )}
          {terminal?.cwdSource === 'home' && (
            <span
              className="terminal-note"
              title="Add a folder to this project in Edit project details to start there."
            >
              {project ? `${project.name} has no folder` : 'no project folder'}
            </span>
          )}
        </span>
      }
      status={
        terminal ? (
          <span
            className={`terminal-state ${running ? 'running' : !terminal.terminated && terminal.exitCode ? 'failed' : ''}`}
            title={running ? `${terminal.cols}×${terminal.rows}` : exitText(terminal)}
          >
            <span>{running ? 'running' : 'exited'}</span>
          </span>
        ) : null
      }
    >
      <Suspense fallback={<div className="terminal-body" />}>
        <TerminalView
          transport={transport}
          resourceId={resource.id}
          mac={mac}
          autoFocus={!!chrome.focused}
          onSession={onSession}
          onError={setError}
          onSize={onSize}
        />
      </Suspense>
      {terminal === null && !error && (
        <div className="terminal-footer" role="status">
          <p>No shell is running here. Shells end when jam quits.</p>
          <button className="button" disabled={starting} onClick={() => void start()}>
            {starting ? 'Starting…' : 'Start shell'}
          </button>
        </div>
      )}
      {terminal && !running && !error && (
        <div className="terminal-footer" role="status">
          <p>{exitText(terminal)}.</p>
          <button className="button" disabled={starting} onClick={() => void start()}>
            {starting ? 'Starting…' : 'Restart shell'}
          </button>
        </div>
      )}
      {error && (
        <div className="terminal-footer error" role="alert">
          <p>{error}</p>
          {terminal !== undefined && !running && (
            <button className="button" disabled={starting} onClick={() => void start()}>
              Try again
            </button>
          )}
        </div>
      )}
    </PaneChrome>
  );
}
