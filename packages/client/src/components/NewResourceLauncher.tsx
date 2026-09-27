import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Folder } from 'lucide-react';
import type { OpenableKind, Presentation, Project } from '@jam/protocol';
import { IconSlot, ProviderIcon } from './icons';
import { ProjectBadge } from './ProjectBadge';

/**
 * The New Resource launcher answers "what do I want to open?".
 *
 * It is deliberately not a search field: the choices are a short, known list of
 * resource kinds, anchored to the resource tab bar it adds to. Global search
 * over history stays a separate interaction (Ctrl/Cmd+K).
 */

export interface LauncherAction {
  id: string;
  label: string;
  hint?: string;
  shortcut?: string;
  /** Why an entry is unavailable. Present means the row is disabled. */
  unavailable?: string;
  run?: () => void;
  icon: React.ReactNode;
}

export interface NewResourceLauncherProps {
  projects: Project[];
  projectId: string;
  shortcut: string;
  /** Whether choosing an entry opens a new tab or fills the targeted pane. */
  target: 'tab' | 'pane';
  /** Viewport point of the control that opened the launcher. */
  anchor?: { left: number; bottom: number };
  onClose(): void;
  onProject(id: string): void;
  onAgentChat(presentation: Presentation): void;
  onResource(kind: OpenableKind): void;
  /** Live terminals in this project, reopened rather than started again. */
  terminals?: { id: string; label: string; detail: string }[];
  onOpenTerminal?(resourceId: string): void;
}

const SEARCH_GLYPH = (
  <svg viewBox="0 0 16 16" width="14" height="14" focusable="false">
    <circle cx="7" cy="7" r="4.5" fill="none" stroke="var(--color-accent)" strokeWidth="1.4" />
    <path
      d="M10.5 10.5L13.5 13.5"
      fill="none"
      stroke="var(--color-accent)"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

function ToolGlyph({ children }: { children: React.ReactNode }) {
  return (
    <IconSlot>
      <svg viewBox="0 0 16 16" width="12" height="12" focusable="false">
        {children}
      </svg>
    </IconSlot>
  );
}

export function NewResourceLauncher({
  projects,
  projectId,
  shortcut,
  target,
  anchor,
  onClose,
  onProject,
  onAgentChat,
  onResource,
  terminals,
  onOpenTerminal,
}: NewResourceLauncherProps) {
  const container = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  /**
   * Hang from the control that opened it, like a menu, rather than floating in
   * the middle of the window. It aligns its left edge just before the control
   * and clamps inside the main region so a `+` near either edge still opens a
   * fully visible launcher.
   */
  useLayoutEffect(() => {
    const element = container.current;
    const frame = element?.offsetParent?.getBoundingClientRect();
    if (!element || !frame || !anchor) return;
    const width = element.offsetWidth;
    const left = Math.min(
      Math.max(anchor.left - frame.left - 10, 8),
      Math.max(frame.width - width - 8, 8),
    );
    // Below the control, lifted just enough to stay inside the main region.
    const top = Math.max(
      Math.min(anchor.bottom - frame.top + 6, frame.height - element.offsetHeight - 8),
      8,
    );
    setPosition({ left, top });
    // Running terminals arrive after it opens and make it taller.
  }, [anchor, terminals?.length]);
  const trigger = useRef<Element | null>(null);
  const [switching, setSwitching] = useState(false);
  const project = projects.find((item) => item.id === projectId);

  const sections = useMemo<{ label: string; actions: LauncherAction[] }[]>(
    () => [
      {
        label: 'Agents',
        actions: [
          {
            id: 'claude',
            label: 'Claude Code chat',
            shortcut: `${shortcut} N`,
            icon: <ProviderIcon presentation="claude" />,
            run: () => onAgentChat('claude'),
          },
          {
            id: 'codex',
            label: 'Codex chat',
            shortcut: `${shortcut} ⇧ N`,
            icon: <ProviderIcon presentation="codex" />,
            run: () => onAgentChat('codex'),
          },
        ],
      },
      {
        label: 'Tools',
        actions: [
          {
            id: 'terminal',
            label: 'Terminal',
            hint: 'New shell',
            icon: (
              <ToolGlyph>
                <path
                  d="M3 4.5l3.5 3.5L3 11.5M8.5 12H13"
                  fill="none"
                  stroke="var(--color-text-muted)"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </ToolGlyph>
            ),
            run: () => onResource('terminal'),
          },
          {
            id: 'browser',
            label: 'Browser',
            hint: 'Planned',
            unavailable: 'The embedded browser resource is not implemented yet.',
            icon: (
              <ToolGlyph>
                <circle
                  cx="8"
                  cy="8"
                  r="5.8"
                  fill="none"
                  stroke="var(--color-text-muted)"
                  strokeWidth="1.2"
                />
                <path
                  d="M2.2 8h11.6M8 2.2c1.8 1.7 2.6 3.6 2.6 5.8S9.8 12.1 8 13.8C6.2 12.1 5.4 10.2 5.4 8S6.2 3.9 8 2.2z"
                  fill="none"
                  stroke="var(--color-text-muted)"
                  strokeWidth="1.2"
                />
              </ToolGlyph>
            ),
          },
          {
            id: 'open-file',
            label: 'Open file…',
            shortcut: `${shortcut} P`,
            unavailable: 'Quick open by name is planned. Use File browser to choose a file.',
            icon: (
              <ToolGlyph>
                <path
                  d="M4 2h5.5L12.5 5v9H4V2z"
                  fill="none"
                  stroke="var(--color-text-muted)"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              </ToolGlyph>
            ),
          },
          {
            id: 'file-browser',
            label: 'File browser',
            hint: 'Demo tree',
            icon: (
              <ToolGlyph>
                <path
                  d="M2 4h4.5l1.5 1.5H14v7.5H2z"
                  fill="none"
                  stroke="var(--color-text-muted)"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              </ToolGlyph>
            ),
            run: () => onResource('file-browser'),
          },
          {
            id: 'diff',
            label: 'Review changes',
            hint: 'Static demo',
            icon: (
              <ToolGlyph>
                <circle
                  cx="4.5"
                  cy="3.5"
                  r="1.8"
                  fill="none"
                  stroke="var(--color-text-muted)"
                  strokeWidth="1.3"
                />
                <circle
                  cx="11.5"
                  cy="12.5"
                  r="1.8"
                  fill="none"
                  stroke="var(--color-text-muted)"
                  strokeWidth="1.3"
                />
                <path
                  d="M4.5 5.3v7.2h5.2M11.5 10.7V3.5H6.3"
                  fill="none"
                  stroke="var(--color-text-muted)"
                  strokeWidth="1.3"
                />
              </ToolGlyph>
            ),
            run: () => onResource('diff'),
          },
        ],
      },
      ...(terminals?.length && onOpenTerminal
        ? [
            {
              // A closed pane leaves its shell running; this is how to get back to it.
              label: 'Running',
              actions: terminals.map((terminal) => ({
                id: terminal.id,
                label: terminal.label,
                hint: terminal.detail,
                icon: (
                  <ToolGlyph>
                    <path
                      d="M3 4.5l3.5 3.5L3 11.5M8.5 12H13"
                      fill="none"
                      stroke="var(--color-success)"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </ToolGlyph>
                ),
                run: () => onOpenTerminal(terminal.id),
              })),
            },
          ]
        : []),
    ],
    [onAgentChat, onOpenTerminal, onResource, shortcut, terminals],
  );

  useEffect(() => {
    trigger.current = document.activeElement;
    const first = container.current?.querySelector<HTMLElement>('.launcher-row:not(:disabled)');
    first?.focus();
    const returnFocus = trigger.current;
    return () => {
      if (returnFocus instanceof HTMLElement && document.contains(returnFocus)) returnFocus.focus();
    };
  }, []);

  useEffect(() => {
    // Pointer (any button) and context-menu presses outside dismiss it; capture
    // lets a click on a tab both dismiss this and reach the tab. Escape is
    // handled at the window, not only while focus sits inside the launcher —
    // in WKWebView focus can stay on the trigger.
    const onPointerDown = (event: Event) => {
      const target = event.target as Element;
      // The trigger toggles on its own click; closing here would reopen it.
      if (target.closest?.('.new-resource')) return;
      if (!container.current?.contains(target)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('contextmenu', onPointerDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('contextmenu', onPointerDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const move = (from: HTMLElement, delta: number) => {
    const rows = [
      ...(container.current?.querySelectorAll<HTMLElement>('.launcher-row:not(:disabled)') ?? []),
    ];
    const index = rows.indexOf(from);
    rows[(index + delta + rows.length) % rows.length]?.focus();
  };

  return (
    <div
      className={`new-resource-launcher ${position ? 'anchored' : ''}`}
      style={position ? { left: position.left, top: position.top } : undefined}
      role="dialog"
      aria-label="Open a resource"
      ref={container}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (event.target instanceof HTMLElement)
            move(event.target, event.key === 'ArrowDown' ? 1 : -1);
        }
      }}
    >
      <div className="launcher-open">
        <div className="launcher-title">
          {SEARCH_GLYPH}
          <span>
            {target === 'pane' ? 'Open in this pane · ' : 'Open in a new tab · '}
            {project?.name ?? 'this project'}
          </span>
        </div>
        {sections.map((section) => (
          <div className="launcher-section" key={section.label}>
            <div className="launcher-label">{section.label}</div>
            {section.actions.map((action) => (
              <button
                key={action.id}
                type="button"
                className="launcher-row"
                disabled={!action.run}
                title={action.unavailable}
                onClick={() => {
                  action.run?.();
                  onClose();
                }}
              >
                {action.icon}
                <span className="launcher-row-label truncate">{action.label}</span>
                {action.shortcut && <kbd>{action.shortcut}</kbd>}
                {(action.hint ?? action.unavailable) && (
                  <small className="launcher-hint">{action.hint ?? 'Unavailable'}</small>
                )}
              </button>
            ))}
          </div>
        ))}
        <p className="launcher-note">
          Agent replies come from the deterministic mock provider. No model is called and agents run
          no commands.
        </p>
      </div>

      <div className="launcher-project">
        <div className="launcher-label">Project</div>
        <div className="launcher-project-row current">
          <ProjectBadge project={project} size={14} />
          <span className="launcher-row-label truncate">{project?.name ?? 'No project'}</span>
          <small>current</small>
        </div>
        <button
          type="button"
          className="launcher-row launcher-project-row"
          aria-expanded={switching}
          onClick={() => setSwitching((value) => !value)}
        >
          <span className="launcher-row-label">Switch project</span>
          <kbd>{shortcut} O</kbd>
        </button>
        {switching &&
          projects
            .filter((item) => item.id !== projectId)
            .map((item) => (
              <button
                key={item.id}
                type="button"
                className="launcher-row launcher-project-row nested"
                onClick={() => {
                  onProject(item.id);
                  onClose();
                }}
              >
                <ProjectBadge project={item} size={14} />
                <span className="launcher-row-label truncate">{item.name}</span>
                <small className="mono">{item.branch}</small>
              </button>
            ))}

        <div className="launcher-divider" />
        <div className="launcher-subtitle">Add a project</div>
        <button
          type="button"
          className="launcher-row launcher-project-row dashed"
          disabled
          title="Choosing a local folder needs native folder access, which is not implemented yet."
        >
          <Folder size={12} />
          <span className="launcher-row-label">Open folder…</span>
        </button>
        <button
          type="button"
          className="launcher-row launcher-project-row field"
          disabled
          title="Cloning a repository is not implemented yet."
        >
          <span className="mono">git clone url or owner/repo</span>
        </button>
        <p className="launcher-note">
          Local folders on disk are not listed: detecting them needs native folder access. These are
          demo projects.
        </p>
      </div>
    </div>
  );
}
