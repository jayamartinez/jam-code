import { useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Plus,
  Search,
  Settings,
} from 'lucide-react';
import type { Project, Resource, Session, WorkspaceSnapshot } from '@jam/protocol';
import { Brand, IconButton, Shortcut, TrafficLightInset } from './Controls';
import { ProviderIcon } from './icons';
import { ProjectBadge } from './ProjectBadge';
import { MenuSelect } from './MenuSelect';
import { HelpMenu, type FeedbackKind } from './HelpMenu';
import { SessionDot } from './SessionDot';
import { compactAge, daysSince, orderProjects, suggestsClosing, threadsOf } from '../state/threads';

export { ProjectBadge };

export interface SidebarProps {
  workspace: WorkspaceSnapshot;
  /** Chats that finished out of sight, shown with a blue dot until seen. */
  finishedSessions: ReadonlySet<string>;
  collapsed: boolean;
  /** Only the chrome knows about platform window geometry. */
  platform: 'windows' | 'macos' | 'web';
  projectId: string;
  activeResourceId: string | null;
  projectFilter: string;
  providerFilter: string;
  shortcut: string;
  /** Selects a project and shows or hides its threads. */
  onProject(id: string): void;
  /** Projects whose threads are listed under them; several can be open. */
  expandedProjectIds: string[];
  /** Days idle before suggesting a thread be closed; null never suggests. */
  idleThreadDays: number | null;
  onCloseThread(resourceId: string): void;
  onKeepThreadOpen(resourceId: string): void;
  onThreadMenu(resource: Resource, event: React.MouseEvent): void;
  onProjectFilter(id: string): void;
  onProviderFilter(id: string): void;
  onOpen(resourceId: string): void;
  onSearch(): void;
  onNew(): void;
  onSettings(): void;
  onCollapse(): void;
  /** Right-click (or the context-menu key) on a project. */
  onProjectMenu(projectId: string, event: React.MouseEvent): void;
  /** Opens the folder picker; absent where the host has none. */
  onAddProject?(): void;
  /** JAM Code's GitHub pages; absent where the host cannot open them. */
  onFeedback?(kind: FeedbackKind): void;
  onCopyDiagnostics(): Promise<void>;
}

export function Sidebar(props: SidebarProps) {
  const { workspace, collapsed, projectId, activeResourceId, shortcut } = props;
  // On macOS the native traffic lights occupy the sidebar header's left inset;
  // the brand follows them there, and yields to them on the narrow rail.
  const mac = props.platform === 'macos';
  const conversations = workspace.resources.filter((resource) => resource.kind === 'conversation');
  const sessionFor = (resource: Resource) =>
    workspace.sessions.find((session) => session.id === resource.sessionId);
  const projects = orderProjects(workspace.projects);
  const history = conversations
    .filter(
      (resource) =>
        !resource.pinned &&
        (!props.projectFilter || resource.projectId === props.projectFilter) &&
        (!props.providerFilter || sessionFor(resource)?.providerId === props.providerFilter),
    )
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  if (collapsed)
    return (
      <aside className="sidebar rail" aria-label="Workspace navigation">
        {mac ? <TrafficLightInset /> : <Brand compact />}
        <IconButton label="Expand sidebar" onClick={props.onCollapse}>
          <PanelLeftOpen size={16} />
        </IconButton>
        <IconButton label="Search history" onClick={props.onSearch}>
          <Search size={16} />
        </IconButton>
        <IconButton label="New chat" onClick={props.onNew}>
          <Plus size={16} />
        </IconButton>
        {projects.map((project) => (
          <button
            key={project.id}
            className={`rail-project ${project.id === projectId ? 'active' : ''}`}
            title={project.name}
            aria-label={`Switch to ${project.name}`}
            onClick={() => props.onProject(project.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              props.onProjectMenu(project.id, event);
            }}
          >
            <ProjectBadge project={project} />
          </button>
        ))}
        <IconButton label="Settings" className="icon-button rail-bottom" onClick={props.onSettings}>
          <Settings size={16} />
        </IconButton>
      </aside>
    );
  return (
    <aside className="sidebar" aria-label="Workspace navigation">
      <div className="sidebar-header">
        {mac && <TrafficLightInset />}
        <Brand />
        <IconButton label="New chat" onClick={props.onNew}>
          <Plus size={15} />
        </IconButton>
        <IconButton label="Collapse sidebar" onClick={props.onCollapse}>
          <PanelLeftClose size={15} />
        </IconButton>
      </div>
      <div className="sidebar-search">
        <button className="search-trigger" onClick={props.onSearch}>
          <Search size={14} />
          <span>Search all history</span>
          <Shortcut>{shortcut} K</Shortcut>
        </button>
      </div>
      <section className="sidebar-section">
        <div className="section-label">
          Projects
          <IconButton
            label={props.onAddProject ? 'Add project' : 'Adding a folder needs the desktop app'}
            disabled={!props.onAddProject}
            onClick={props.onAddProject}
          >
            <Plus size={12} />
          </IconButton>
        </div>
        {!projects.length && (
          <button className="project-row add-project" onClick={props.onAddProject}>
            <span className="project-add-badge" aria-hidden="true">
              <Plus size={11} />
            </span>
            <span className="name truncate">New project…</span>
          </button>
        )}
        {projects.map((project) => {
          const expanded = props.expandedProjectIds.includes(project.id);
          return (
            <div key={project.id} className="project-group">
              <button
                className={`project-row ${project.id === projectId ? 'selected' : ''} ${expanded ? 'expanded' : ''}`}
                aria-expanded={expanded}
                onClick={() => props.onProject(project.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  props.onProjectMenu(project.id, event);
                }}
              >
                <ProjectBadge project={project} />
                <span className="name truncate">{project.name}</span>
                {project.pinned && (
                  <span className="project-pin" title="Pinned">
                    <Pin size={11} />
                  </span>
                )}
                {project.folderMissing ? (
                  <span className="branch missing" title="This project's folder can't be found">
                    folder missing
                  </span>
                ) : (
                  <span className="branch mono">{project.branch}</span>
                )}
              </button>
              {expanded && (
                <ProjectThreads
                  resources={workspace.resources}
                  sessionFor={sessionFor}
                  finishedSessions={props.finishedSessions}
                  projectId={project.id}
                  activeResourceId={activeResourceId}
                  idleThreadDays={props.idleThreadDays}
                  onOpen={props.onOpen}
                  onClose={props.onCloseThread}
                  onKeepOpen={props.onKeepThreadOpen}
                  onMenu={props.onThreadMenu}
                />
              )}
            </div>
          );
        })}
      </section>
      <section className="sidebar-section">
        <div className="section-label">
          Pinned
          <span className="count">
            {conversations.filter((resource) => resource.pinned).length}
          </span>
        </div>
        {conversations
          .filter((resource) => resource.pinned)
          .map((resource) => (
            <ChatRow
              key={resource.id}
              resource={resource}
              session={sessionFor(resource)}
              project={workspace.projects.find((project) => project.id === resource.projectId)}
              active={resource.id === activeResourceId}
              finished={props.finishedSessions.has(resource.sessionId ?? '')}
              pinned
              onOpen={props.onOpen}
            />
          ))}
      </section>
      <section className="sidebar-section history-section">
        <div className="section-label">
          History<span className="count">{conversations.length} chats</span>
        </div>
        <div className="history-filters">
          <MenuSelect
            label="Filter history by project"
            value={props.projectFilter}
            options={[
              { value: '', label: 'Any project' },
              ...workspace.projects.map((project) => ({ value: project.id, label: project.name })),
            ]}
            onChange={props.onProjectFilter}
          />
          <MenuSelect
            label="Filter history by provider"
            value={props.providerFilter}
            options={[
              { value: '', label: 'Any provider' },
              ...(workspace.providers.some((provider) => provider.id === 'mock')
                ? [{ value: 'mock', label: 'Demo' }]
                : []),
              { value: 'claude', label: 'Claude Code' },
              { value: 'codex', label: 'Codex' },
            ]}
            onChange={props.onProviderFilter}
          />
        </div>
        <div className="history-scroll">
          <div className="history-group">Recent</div>
          {history.map((resource) => (
            <ChatRow
              key={resource.id}
              resource={resource}
              session={sessionFor(resource)}
              project={workspace.projects.find((project) => project.id === resource.projectId)}
              active={resource.id === activeResourceId}
              finished={props.finishedSessions.has(resource.sessionId ?? '')}
              onOpen={props.onOpen}
            />
          ))}
          {!history.length && <p className="history-group">No conversations match.</p>}
        </div>
      </section>
      <footer className="sidebar-footer">
        <button onClick={props.onSettings}>
          <Settings size={14} />
          <span>Settings</span>
          <Shortcut>{shortcut} ,</Shortcut>
        </button>
        {props.onFeedback && (
          <HelpMenu onFeedback={props.onFeedback} onCopyDiagnostics={props.onCopyDiagnostics} />
        )}
      </footer>
    </aside>
  );
}

function ChatRow({
  resource,
  session,
  project,
  active,
  finished,
  pinned,
  onOpen,
}: {
  resource: Resource;
  session?: Session;
  project?: Project;
  active: boolean;
  finished: boolean;
  pinned?: boolean;
  onOpen(id: string): void;
}) {
  return (
    <button
      className={`chat-row ${active ? 'active' : ''} ${pinned ? 'pinned' : ''}`}
      onClick={() => onOpen(resource.id)}
      title={resource.title}
      aria-current={active ? 'page' : undefined}
    >
      <ProviderIcon presentation={session?.presentation} providerId={session?.providerId} />
      <span className="row-copy">
        <span className="row-title truncate">{resource.title}</span>
        {!pinned && (
          <span className="row-meta truncate">
            {project?.name} ·{' '}
            {session?.needsInput
              ? 'needs input'
              : session?.status === 'idle'
                ? 'done'
                : (session?.status ?? 'saved')}
          </span>
        )}
      </span>
      <span className="row-status">
        {session?.needsInput ||
        session?.status === 'running' ||
        session?.status === 'failed' ||
        finished ? (
          <SessionDot session={session} finished={finished} />
        ) : pinned ? (
          <span className="mono subtle" style={{ fontSize: 9 }}>
            {project?.initials}
          </span>
        ) : session?.status === 'idle' ? (
          <Check size={11} className="success" />
        ) : null}
      </span>
    </button>
  );
}

/** How many closed threads show before "Show more". */
const CLOSED_PREVIEW = 3;

function ProjectThreads({
  resources,
  sessionFor,
  finishedSessions,
  projectId,
  activeResourceId,
  idleThreadDays,
  onOpen,
  onClose,
  onKeepOpen,
  onMenu,
}: {
  resources: Resource[];
  sessionFor(resource: Resource): Session | undefined;
  finishedSessions: ReadonlySet<string>;
  projectId: string;
  activeResourceId: string | null;
  idleThreadDays: number | null;
  onOpen(id: string): void;
  onClose(id: string): void;
  onKeepOpen(id: string): void;
  onMenu(resource: Resource, event: React.MouseEvent): void;
}) {
  const [closedOpen, setClosedOpen] = useState(false);
  const [showAllClosed, setShowAllClosed] = useState(false);
  const { open, closed } = threadsOf(resources, projectId);
  // Ages are read at render; the list re-renders on any activity, and an idle
  // workspace has nothing new to show, so no timer polls.
  const now = Date.now();
  const visibleClosed = showAllClosed ? closed : closed.slice(0, CLOSED_PREVIEW);
  // Only the longest-idle thread asks at a time; the rest just show an amber age.
  const idleIds = new Set(
    open
      .filter((thread) => suggestsClosing(thread, sessionFor(thread), now, idleThreadDays))
      .map((thread) => thread.id),
  );
  const asking = [...open].reverse().find((thread) => idleIds.has(thread.id))?.id;
  const row = (thread: Resource, isClosed: boolean) => {
    const idle = !isClosed && idleIds.has(thread.id);
    return (
      <div key={thread.id} className="thread-item">
        <button
          className={`thread-row ${thread.id === activeResourceId ? 'active' : ''} ${isClosed ? 'closed' : ''}`}
          title={thread.title}
          aria-current={thread.id === activeResourceId ? 'page' : undefined}
          onClick={() => onOpen(thread.id)}
          onContextMenu={(event) => {
            event.preventDefault();
            onMenu(thread, event);
          }}
        >
          <ProviderIcon
            presentation={sessionFor(thread)?.presentation}
            providerId={sessionFor(thread)?.providerId}
          />
          <span className="thread-title truncate">{thread.title}</span>
          {!isClosed && (
            <SessionDot
              session={sessionFor(thread)}
              finished={finishedSessions.has(thread.sessionId ?? '')}
            />
          )}
          <span className={`thread-age mono ${idle ? 'idle' : ''}`}>
            {isClosed
              ? `closed ${compactAge(thread.closedAt!, now)}`
              : compactAge(thread.updatedAt, now)}
          </span>
        </button>
        {thread.id === asking && (
          <div className="close-suggestion" role="group" aria-label={`Close ${thread.title}?`}>
            <p>
              Idle for {daysSince(thread.updatedAt, now)}{' '}
              {daysSince(thread.updatedAt, now) === 1 ? 'day' : 'days'} — close it?
            </p>
            <div>
              <button className="button" onClick={() => onClose(thread.id)}>
                Close thread
              </button>
              <button className="button quiet" onClick={() => onKeepOpen(thread.id)}>
                Keep open
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };
  return (
    <div className="project-threads">
      <div className="thread-group-label">
        Open<span className="count">{open.length}</span>
      </div>
      {open.map((thread) => row(thread, false))}
      {!open.length && <p className="thread-empty">No open threads.</p>}
      {closed.length > 0 && (
        <>
          <button
            className="thread-group-label toggle"
            aria-expanded={closedOpen}
            onClick={() => setClosedOpen((value) => !value)}
          >
            <span>
              {closedOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              Closed
            </span>
            <span className="count">{closed.length}</span>
          </button>
          {closedOpen && visibleClosed.map((thread) => row(thread, true))}
          {closedOpen && closed.length > CLOSED_PREVIEW && (
            <button className="thread-more" onClick={() => setShowAllClosed((value) => !value)}>
              {showAllClosed ? 'Show fewer' : `Show ${closed.length - CLOSED_PREVIEW} more`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
