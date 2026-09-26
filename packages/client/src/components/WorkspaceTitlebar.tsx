import {
  AppWindow,
  Columns2,
  FileDiff,
  Globe,
  MessageSquare,
  Plus,
  Settings,
  Terminal,
  X,
} from 'lucide-react';
import type { Project, Resource, ResourceKind, WorkspaceSnapshot } from '@jam/protocol';
import type { DesktopServices } from '../desktop';
import type { LayoutState, ResourceView } from '../state/layout';
import { Brand, IconButton, Shortcut, WindowControls } from './Controls';

interface WorkspaceTitlebarProps {
  desktop: DesktopServices;
  layout: Pick<LayoutState, 'views' | 'activeViewId' | 'mode' | 'focus'>;
  workspace: Pick<WorkspaceSnapshot, 'resources' | 'sessions'>;
  visibleViews: ResourceView[];
  project?: Project;
  activeResource?: Resource;
  shortcut: string;
  onOpen(resourceId: string): void;
  onClose(viewId: string): void;
  onNewResource(): void;
  onExitFocus(): void;
  onMode(mode: LayoutState['mode']): void;
}

export function WorkspaceTitlebar({
  desktop,
  layout,
  workspace,
  visibleViews,
  project,
  activeResource,
  shortcut,
  onOpen,
  onClose,
  onNewResource,
  onExitFocus,
  onMode,
}: WorkspaceTitlebarProps) {
  return (
    <header className="titlebar">
      {desktop.platform === 'macos' && <WindowControls desktop={desktop} />}
      {layout.focus ? (
        <div className="focus-title">
          <Brand />
          <span className="muted">{project?.name}</span>
          <span className="subtle">/</span>
          <span>{activeResource?.title ?? 'New chat'}</span>
        </div>
      ) : (
        <>
          <div className="resource-tabs" role="tablist" aria-label="Open resources">
            {layout.views.map((view) => {
              const resource = workspace.resources.find((item) => item.id === view.resourceId);
              const draft = view.resourceId.startsWith('draft:');
              if (!resource && !draft) return null;
              const isActive = view.id === layout.activeViewId;
              const session = workspace.sessions.find((item) => item.id === resource?.sessionId);
              return (
                <div
                  key={view.id}
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={0}
                  className={`resource-tab ${isActive ? 'active' : ''} ${visibleViews.some((item) => item.id === view.id) ? 'visible' : ''}`}
                  onClick={() => onOpen(view.resourceId)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onOpen(view.resourceId);
                    }
                  }}
                >
                  <ResourceIcon kind={resource?.kind ?? 'conversation'} />
                  <span className="truncate">
                    {draft
                      ? 'New chat'
                      : resource?.kind === 'diff'
                        ? 'PaneHost.tsx'
                        : resource?.kind === 'terminal'
                          ? 'pnpm dev'
                          : resource?.title}
                  </span>
                  {session?.status === 'running' && <span className="status-dot running" />}
                  <button
                    className="tab-close"
                    aria-label={`Close ${draft ? 'New chat' : resource?.title} view`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onClose(view.id);
                    }}
                  >
                    <X size={10} />
                  </button>
                </div>
              );
            })}
          </div>
          <IconButton label="Open new resource" onClick={onNewResource}>
            <Plus size={14} />
          </IconButton>
        </>
      )}
      <div
        className="title-drag"
        onMouseDown={(event) => {
          if (event.button === 0) void desktop.startDragging();
        }}
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

function ResourceIcon({ kind }: { kind: ResourceKind }) {
  if (kind === 'terminal') return <Terminal size={12} />;
  if (kind === 'diff') return <FileDiff size={12} />;
  if (kind === 'settings') return <Settings size={12} />;
  if (kind === 'browser') return <Globe size={12} />;
  return <MessageSquare size={12} />;
}
