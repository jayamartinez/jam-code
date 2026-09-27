import { useCallback, useRef, useState } from 'react';
import { AppWindow, Columns2, Plus, X } from 'lucide-react';
import type { Presentation, Project, Resource, WorkspaceSnapshot } from '@jam/protocol';
import type { DesktopServices } from '../desktop';
import type { LayoutState } from '../state/layout';
import { Brand, IconButton, Shortcut, WindowControls } from './Controls';
import { ProjectBadge } from './ProjectBadge';
import { ResourceIcon } from './icons';

interface WorkspaceTitlebarProps {
  desktop: DesktopServices;
  layout: Pick<LayoutState, 'tabs' | 'activeTabId' | 'mode' | 'focus'>;
  workspace: Pick<WorkspaceSnapshot, 'resources' | 'sessions' | 'projects'>;
  drafts: Record<string, { projectId: string; presentation: Presentation }>;
  project?: Project;
  activeResource?: Resource;
  shortcut: string;
  launcherOpen: boolean;
  onSelectTab(resourceId: string): void;
  onCloseTab(tabId: string): void;
  onMoveTab(from: number, to: number): void;
  onNewResource(anchor: Element): void;
  onExitFocus(): void;
  onMode(mode: LayoutState['mode']): void;
}

export function WorkspaceTitlebar({
  desktop,
  layout,
  workspace,
  drafts,
  project,
  activeResource,
  shortcut,
  launcherOpen,
  onSelectTab,
  onCloseTab,
  onMoveTab,
  onNewResource,
  onExitFocus,
  onMode,
}: WorkspaceTitlebarProps) {
  const strip = useRef<HTMLDivElement>(null);
  /** Set when a press turned into a drag, so the release does not also select. */
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState<{
    from: number;
    over: number;
    dx: number;
    /** Distance a displaced neighbour slides: the dragged tab plus the gap. */
    step: number;
  } | null>(null);

  /**
   * Browser-style reordering. A press selects only if it is released without
   * moving; once it moves past a small threshold it becomes a drag, the tab
   * follows the pointer and its neighbours slide aside to show where it will
   * land. It is pointer-driven rather than HTML5 drag-and-drop, which would
   * hand the tab to the operating system as an item droppable into other apps.
   */
  const startDrag = useCallback(
    (index: number) => (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      if ((event.target as HTMLElement).closest('.tab-close')) return;
      const tabs = [...(strip.current?.querySelectorAll<HTMLElement>('.resource-tab') ?? [])];
      const own = tabs[index]?.getBoundingClientRect();
      if (!own) return;
      // Midpoints are measured once, before anything moves.
      const midpoints = tabs.map((tab) => {
        const box = tab.getBoundingClientRect();
        return box.left + box.width / 2;
      });
      const gap =
        tabs[1] && tabs[0]
          ? tabs[1].getBoundingClientRect().left - tabs[0].getBoundingClientRect().right
          : 2;
      const origin = event.clientX;
      // WebKit otherwise begins a text selection from the press, which takes
      // over the pointer stream so the tab never follows it. Capturing keeps
      // moves arriving even once the pointer leaves the strip.
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      let moved = false;
      let over = index;
      suppressClick.current = false;
      const onMove = (move: PointerEvent) => {
        const dx = move.clientX - origin;
        if (!moved && Math.abs(dx) < 5) return;
        moved = true;
        suppressClick.current = true;
        const centre = own.left + own.width / 2 + dx;
        over = midpoints.filter((mid, i) => i !== index && mid < centre).length;
        setDrag({ from: index, over, dx, step: own.width + gap });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        setDrag(null);
        if (moved && over !== index) onMoveTab(index, over);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [onMoveTab],
  );

  /** Where each tab should sit while another is being dragged. */
  const dragOffset = (index: number) => {
    if (!drag) return 0;
    if (index === drag.from) return drag.dx;
    if (drag.from < index && index <= drag.over) return -drag.step;
    if (drag.over <= index && index < drag.from) return drag.step;
    return 0;
  };

  // Labels tighten as tabs accumulate rather than the strip silently scrolling
  // a tab out of reach behind the layout controls.
  const density = layout.tabs.length >= 9 ? 'tight' : layout.tabs.length >= 6 ? 'compact' : '';
  /** Which project a tab belongs to is only ambiguous once several are open. */
  const projectsInPlay = new Set(
    layout.tabs
      .map(
        (tab) =>
          workspace.resources.find((item) => item.id === tab.resourceId)?.projectId ??
          drafts[tab.resourceId]?.projectId,
      )
      .filter(Boolean),
  );
  const showProject = projectsInPlay.size > 1;

  return (
    <header className="titlebar">
      {/*
        On macOS the native traffic lights sit in the sidebar header, so the
        titlebar starts at its own left edge. Windows keeps its controls on the
        right. All platform geometry lives in the chrome, never in a resource.
      */}
      {layout.focus ? (
        <div className="focus-title">
          <Brand />
          <span className="muted">{project?.name}</span>
          <span className="subtle">/</span>
          <span>{activeResource?.title ?? 'New chat'}</span>
        </div>
      ) : (
        <div
          className={`resource-tabs ${density} ${drag ? 'reordering' : ''}`}
          role="tablist"
          aria-label="Open resources"
          ref={strip}
          onWheel={(event) => {
            // A vertical wheel scrolls the strip horizontally, so a trackpad
            // or a plain mouse can both reach an overflowing tab.
            const element = strip.current;
            if (!element || element.scrollWidth <= element.clientWidth) return;
            const delta =
              Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
            if (!delta) return;
            element.scrollLeft += delta;
          }}
        >
          {layout.tabs.map((tab, index) => {
            const resource = workspace.resources.find((item) => item.id === tab.resourceId);
            const draft = drafts[tab.resourceId];
            if (!resource && !draft) return null;
            const isActive = tab.id === layout.activeTabId;
            const session = workspace.sessions.find((item) => item.id === resource?.sessionId);
            const title = draft ? 'New chat' : (resource?.title ?? 'Resource');
            const project = workspace.projects.find(
              (item) => item.id === (resource?.projectId ?? draft?.projectId),
            );
            const projectName = project?.name;
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                tabIndex={0}
                className={`resource-tab ${isActive ? 'active' : ''} ${
                  drag?.from === index ? 'dragging' : drag ? 'shifting' : ''
                }`}
                style={drag ? { transform: `translateX(${dragOffset(index)}px)` } : undefined}
                title={projectName ? `${title} · ${projectName}` : title}
                onPointerDown={startDrag(index)}
                onClick={() => {
                  // A drag ends on this tab too; only a plain click selects.
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  onSelectTab(tab.resourceId);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectTab(tab.resourceId);
                  }
                  // Reordering stays reachable without a pointer.
                  if (event.key === 'ArrowLeft' && event.altKey) {
                    event.preventDefault();
                    onMoveTab(index, index - 1);
                  }
                  if (event.key === 'ArrowRight' && event.altKey) {
                    event.preventDefault();
                    onMoveTab(index, index + 1);
                  }
                }}
              >
                <ResourceIcon
                  kind={resource?.kind ?? 'conversation'}
                  presentation={session?.presentation ?? draft?.presentation}
                  density="tab"
                />
                <span className="tab-title truncate">{title}</span>
                {showProject && project && <ProjectBadge project={project} size={13} />}
                {session?.status === 'running' && <span className="status-dot running" />}
                <button
                  className="tab-close"
                  aria-label={`Close ${title} tab`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                >
                  <X size={10} />
                </button>
              </div>
            );
          })}
          <IconButton
            label="Open a new resource in a new tab"
            className="icon-button new-resource"
            aria-expanded={launcherOpen}
            aria-haspopup="dialog"
            onClick={(event) => onNewResource(event.currentTarget)}
          >
            <Plus size={14} />
          </IconButton>
        </div>
      )}
      <div
        className="title-drag"
        onMouseDown={(event) => {
          // Only noninteractive titlebar space starts a native window drag.
          if (event.button === 0 && event.target === event.currentTarget)
            void desktop.startDragging();
        }}
        onDoubleClick={() => void desktop.toggleMaximize()}
      />
      <span
        className="chrome-demo"
        title={
          desktop.platform === 'web'
            ? 'Browser preview · in-memory data only'
            : 'Isolated demo database · no tools execute'
        }
      >
        {desktop.platform === 'web' ? 'Preview · Demo' : 'Demo'}
      </span>
      {layout.focus ? (
        <button className="focus-exit" onClick={onExitFocus}>
          Exit focus<Shortcut>{shortcut} .</Shortcut>
        </button>
      ) : (
        <div className="layout-toggle">
          <button
            className={layout.mode === 'single' ? 'active' : ''}
            onClick={() => onMode('single')}
            aria-pressed={layout.mode === 'single'}
          >
            <AppWindow size={11} />
            Single
          </button>
          <button
            className={layout.mode === 'tiles' ? 'active' : ''}
            onClick={() => onMode('tiles')}
            aria-pressed={layout.mode === 'tiles'}
          >
            <Columns2 size={11} />
            Tiles
          </button>
        </div>
      )}
      {desktop.platform !== 'macos' && <WindowControls desktop={desktop} />}
    </header>
  );
}
