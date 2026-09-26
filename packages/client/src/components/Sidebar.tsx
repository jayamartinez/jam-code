import {
  Asterisk,
  Check,
  CircleDashed,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
} from 'lucide-react';
import type { Project, Resource, Session, WorkspaceSnapshot } from '@jam/protocol';
import { Brand, IconButton, Shortcut } from './Controls';

export function ProviderGlyph({ presentation = 'claude' }: { presentation?: 'claude' | 'codex' }) {
  return (
    <span className={`provider-glyph ${presentation}`} aria-hidden="true">
      {presentation === 'claude' ? <Asterisk size={15} /> : <CircleDashed size={13} />}
    </span>
  );
}

export function ProjectBadge({ project, index = 0 }: { project?: Project; index?: number }) {
  return <span className={`project-badge tone-${index % 4}`}>{project?.initials ?? 'JC'}</span>;
}

export interface SidebarProps {
  workspace: WorkspaceSnapshot;
  collapsed: boolean;
  projectId: string;
  activeResourceId: string | null;
  projectFilter: string;
  providerFilter: string;
  shortcut: string;
  onProject(id: string): void;
  onProjectFilter(id: string): void;
  onProviderFilter(id: string): void;
  onOpen(resourceId: string): void;
  onSearch(): void;
  onNew(): void;
  onSettings(): void;
  onCollapse(): void;
}

export function Sidebar(props: SidebarProps) {
  const { workspace, collapsed, projectId, activeResourceId, shortcut } = props;
  const conversations = workspace.resources.filter((resource) => resource.kind === 'conversation');
  const sessionFor = (resource: Resource) =>
    workspace.sessions.find((session) => session.id === resource.sessionId);
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
        <Brand />
        <IconButton label="Expand sidebar" onClick={props.onCollapse}>
          <PanelLeftOpen size={16} />
        </IconButton>
        <IconButton label="Search history" onClick={props.onSearch}>
          <Search size={16} />
        </IconButton>
        <IconButton label="New chat" onClick={props.onNew}>
          <Plus size={16} />
        </IconButton>
        {workspace.projects.map((project, index) => (
          <button
            key={project.id}
            className={`rail-project ${project.id === projectId ? 'active' : ''}`}
            title={project.name}
            aria-label={`Switch to ${project.name}`}
            onClick={() => props.onProject(project.id)}
          >
            <ProjectBadge project={project} index={index} />
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
          <IconButton label="Adding local projects is planned" disabled>
            <Plus size={12} />
          </IconButton>
        </div>
        {workspace.projects.map((project, index) => (
          <button
            key={project.id}
            className={`project-row ${project.id === projectId ? 'selected' : ''}`}
            onClick={() => props.onProject(project.id)}
          >
            <ProjectBadge project={project} index={index} />
            <span className="name truncate">{project.name}</span>
            <span className="branch mono">{project.branch}</span>
          </button>
        ))}
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
          <select
            aria-label="Filter history by project"
            value={props.projectFilter}
            onChange={(event) => props.onProjectFilter(event.target.value)}
          >
            <option value="">Any project</option>
            {workspace.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter history by provider"
            value={props.providerFilter}
            onChange={(event) => props.onProviderFilter(event.target.value)}
          >
            <option value="">Any provider</option>
            <option value="mock">Mock</option>
            <option value="claude">Claude Code</option>
            <option value="codex">Codex</option>
          </select>
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
      </footer>
    </aside>
  );
}

function ChatRow({
  resource,
  session,
  project,
  active,
  pinned,
  onOpen,
}: {
  resource: Resource;
  session?: Session;
  project?: Project;
  active: boolean;
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
      <ProviderGlyph presentation={session?.presentation} />
      <span className="row-copy">
        <span className="row-title truncate">{resource.title}</span>
        {!pinned && (
          <span className="row-meta truncate">
            {project?.name} · {session?.status === 'idle' ? 'done' : (session?.status ?? 'saved')}
          </span>
        )}
      </span>
      <span className="row-status">
        {session?.status === 'running' ? (
          <span className="status-dot running" />
        ) : session?.status === 'failed' ? (
          <span className="status-dot failed" />
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
