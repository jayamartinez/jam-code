import {
  File,
  Folder,
  GitCompareArrows,
  Globe,
  MessageSquare,
  Search,
  Terminal,
} from 'lucide-react';
import type { Project } from '@jam/protocol';
import { Dialog, Shortcut } from './Controls';
import { ProjectBadge } from './Sidebar';

export function Launcher({
  projects,
  projectId,
  shortcut,
  onClose,
  onProject,
  onNew,
  onResource,
}: {
  projects: Project[];
  projectId: string;
  shortcut: string;
  onClose(): void;
  onProject(id: string): void;
  onNew(): void;
  onResource(kind: 'diff' | 'terminal'): void;
}) {
  return (
    <Dialog title="Open a resource" onClose={onClose}>
      <div className="launcher">
        <div className="launcher-list">
          <div className="launcher-heading">
            <Search size={14} />
            Open in {projects.find((project) => project.id === projectId)?.name}…
          </div>
          <div className="launcher-label">Agents</div>
          <button className="launcher-item" onClick={onNew}>
            <MessageSquare size={14} />
            <span>New mock chat</span>
            <Shortcut>{shortcut} N</Shortcut>
          </button>
          <button
            className="launcher-item"
            disabled
            title="Claude Code integration is not connected"
          >
            <MessageSquare size={14} />
            <span>Claude Code chat</span>
          </button>
          <button className="launcher-item" disabled title="Codex integration is not connected">
            <MessageSquare size={14} />
            <span>Codex chat</span>
          </button>
          <div className="launcher-label">Tools</div>
          <button className="launcher-item" onClick={() => onResource('terminal')}>
            <Terminal size={14} />
            <span>Terminal</span>
            <small className="subtle">Static demo</small>
          </button>
          <button
            className="launcher-item"
            disabled
            title="Embedded browser integration is planned"
          >
            <Globe size={14} />
            <span>Browser</span>
            <small className="subtle">Planned</small>
          </button>
          <button
            className="launcher-item"
            disabled
            title="Native file access and editor integration are planned"
          >
            <File size={14} />
            <span>Open file…</span>
            <Shortcut>{shortcut} P</Shortcut>
          </button>
          <button className="launcher-item" disabled title="File browser integration is planned">
            <Folder size={14} />
            <span>File browser</span>
          </button>
          <button className="launcher-item" onClick={() => onResource('diff')}>
            <GitCompareArrows size={14} />
            <span>Review changes</span>
            <small className="subtle">Static demo</small>
          </button>
        </div>
        <div className="launcher-projects">
          <div className="launcher-label">Project</div>
          {projects.map((project, index) => (
            <button
              className={`project-row ${project.id === projectId ? 'selected' : ''}`}
              key={project.id}
              onClick={() => onProject(project.id)}
            >
              <ProjectBadge project={project} index={index} />
              <span className="name truncate">{project.name}</span>
            </button>
          ))}
          <div className="launcher-label">Add a project</div>
          <button className="button" disabled title="Native project selection is planned">
            <Folder size={13} />
            Open folder…
          </button>
          <p>
            These are demo projects. Local folders and Git worktrees will be connected in a later
            milestone.
          </p>
        </div>
      </div>
    </Dialog>
  );
}
