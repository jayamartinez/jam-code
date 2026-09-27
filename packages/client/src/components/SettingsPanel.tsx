import {
  AppWindow,
  Bell,
  Check,
  ChevronRight,
  CircleHelp,
  Code2,
  Expand,
  Keyboard,
  Monitor,
  Plug,
  Search,
  Settings,
  Shield,
  Terminal,
  X,
  Zap,
} from 'lucide-react';
import { SnapshotSettings } from './SnapshotSettings';
import type { JamTransport, Project, ProviderDescriptor } from '@jam/protocol';
import { useState } from 'react';
import type { DesktopServices } from '../desktop';
import { ProjectBadge } from './ProjectBadge';
import {
  EDITOR_FONTS,
  EDITOR_FONT_SIZES,
  IDLE_THREAD_OPTIONS,
  type EditorPreferences,
} from '../state/preferences';
import { Brand, IconButton, TrafficLightInset, WindowControls } from './Controls';

const groups = [
  {
    title: 'General',
    items: [
      ['General', Settings],
      ['Appearance', Monitor],
    ],
  },
  {
    title: 'Agents',
    items: [
      ['Providers', Plug],
      ['Agent defaults', Zap],
      ['Permissions', Shield],
    ],
  },
  {
    title: 'Tools',
    items: [
      ['Browser', AppWindow],
      ['Terminal', Terminal],
      ['Snapshots', Bell],
      ['Skills', Code2],
    ],
  },
  {
    title: 'System',
    items: [
      ['Keybindings', Keyboard],
      ['Storage', Monitor],
      ['Advanced', Code2],
      ['About', CircleHelp],
    ],
  },
] as const;

export function SettingsPanel({
  transport,
  initialPage = 'Providers',
  providers,
  projects,
  onEditProject,
  dedicated,
  desktop,
  editor,
  onEditor,
  idleThreadDays,
  onIdleThreadDays,
  onClose,
  onMode,
}: {
  transport: JamTransport;
  initialPage?: 'Providers' | 'Snapshots';
  providers: ProviderDescriptor[];
  projects: Project[];
  onEditProject(projectId: string): void;
  dedicated: boolean;
  desktop: DesktopServices;
  editor: EditorPreferences;
  onEditor(next: EditorPreferences): void;
  idleThreadDays: number | null;
  onIdleThreadDays(next: number | null): void;
  onClose(): void;
  onMode(): void;
}) {
  const [page, setPage] = useState<'Providers' | 'Appearance' | 'Snapshots'>(initialPage);
  const implemented = (name: string) =>
    name === 'Providers' || name === 'Appearance' || name === 'Snapshots';
  const navigation = (
    <nav className="settings-nav-sections" aria-label="Settings sections">
      {groups.map((group) => (
        <section key={group.title}>
          <div className="section-label">{group.title}</div>
          {group.items.map(([name, Icon]) => (
            <button
              key={name}
              className={`settings-nav-item ${name === page ? 'active' : ''}`}
              disabled={!implemented(name as string)}
              title={implemented(name as string) ? undefined : `${name} settings are planned`}
              onClick={() =>
                implemented(name as string) &&
                setPage(name as 'Providers' | 'Appearance' | 'Snapshots')
              }
            >
              <Icon size={14} />
              <span>{name}</span>
              {name === 'Providers' && (
                <small>{providers.filter((provider) => provider.enabled).length} on</small>
              )}
            </button>
          ))}
        </section>
      ))}
    </nav>
  );
  const appearance = (
    <div className="settings-content-scroll">
      <div className="settings-content">
        <header className="settings-heading">
          <h2>Appearance</h2>
          <p>
            How JAM draws. These are remembered in this browser profile and change nothing the
            runtime stores.
          </p>
        </header>
        <section className="settings-card">
          <div className="settings-row appearance-row">
            <div>
              <strong>Editor font</strong>
              <p>
                JAM bundles Geist Mono. The other families are used only if this computer already
                has them installed, so nothing is downloaded.
              </p>
            </div>
            <select
              aria-label="Editor font family"
              value={editor.fontFamily}
              onChange={(event) => onEditor({ ...editor, fontFamily: event.target.value })}
            >
              {EDITOR_FONTS.map((font) => (
                <option key={font.label} value={font.value}>
                  {font.label}
                  {font.note ? ` · ${font.note}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="settings-row appearance-row">
            <div>
              <strong>Editor size</strong>
              <p>Font size and line height for file panes.</p>
            </div>
            <span className="settings-controls">
              <select
                aria-label="Editor font size"
                value={editor.fontSize}
                onChange={(event) => onEditor({ ...editor, fontSize: Number(event.target.value) })}
              >
                {EDITOR_FONT_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}px
                  </option>
                ))}
              </select>
              <select
                aria-label="Editor line height"
                value={editor.lineHeight}
                onChange={(event) =>
                  onEditor({ ...editor, lineHeight: Number(event.target.value) })
                }
              >
                {[16, 18, 20, 22, 24].map((height) => (
                  <option key={height} value={height}>
                    {height}px line
                  </option>
                ))}
              </select>
            </span>
          </div>
          <div className="settings-row appearance-row">
            <div>
              <strong>Preview</strong>
              <p>The same stack a file pane uses.</p>
            </div>
            <code className="editor-preview">const handle = attach(sessionId);</code>
          </div>
        </section>
        <header className="settings-heading project-icons-heading">
          <h3>Threads</h3>
          <p>
            A project's chats, listed under it in the sidebar as open or closed. JAM only suggests
            closing; a thread closes when you choose to, and sending to it reopens it.
          </p>
        </header>
        <section className="settings-card">
          <div className="settings-row appearance-row">
            <div>
              <strong>Suggest closing idle threads</strong>
              <p>Ask about an open thread nobody has used for this long.</p>
            </div>
            <select
              aria-label="Suggest closing idle threads"
              value={idleThreadDays === null ? 'never' : String(idleThreadDays)}
              onChange={(event) =>
                onIdleThreadDays(event.target.value === 'never' ? null : Number(event.target.value))
              }
            >
              {IDLE_THREAD_OPTIONS.map((option) => (
                <option key={option.label} value={option.value === null ? 'never' : option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </section>
        <header className="settings-heading project-icons-heading">
          <h3>Projects</h3>
          <p>
            Name, folders and icon. You can also right-click a project in the sidebar and choose
            Edit project details.
          </p>
        </header>
        <section className="settings-card">
          {projects.map((item) => (
            <div className="settings-row appearance-row" key={item.id}>
              <div className="project-icon-identity">
                <ProjectBadge project={item} size={28} />
                <div>
                  <strong>{item.name}</strong>
                  <p className="mono">
                    {item.paths?.[0] ?? item.branch}
                    {(item.paths?.length ?? 0) > 1 ? ` +${(item.paths?.length ?? 1) - 1}` : ''}
                  </p>
                </div>
              </div>
              <button type="button" className="button" onClick={() => onEditProject(item.id)}>
                Edit…
              </button>
            </div>
          ))}
        </section>
        <p className="settings-note">
          Theme, accent and density controls are planned. Only the editor and project icons are
          configurable here.
        </p>
      </div>
    </div>
  );

  const providersPage = (
    <div className="settings-content-scroll">
      <div className="settings-content">
        <header className="settings-heading">
          <h2>Providers</h2>
          <p>
            JAM connects to agents through a local runtime. This foundation uses a deterministic
            mock; no models are called.
          </p>
        </header>
        <div className="settings-default">
          <div>
            <strong>Default for new chats</strong>
            <p>Mock is the only enabled provider. Real integrations are not connected.</p>
          </div>
          <span className="setting-value">
            <Zap size={12} /> Mock
          </span>
        </div>
        {providers.map((provider) => (
          <section
            className={`provider-card ${provider.enabled ? 'enabled' : ''}`}
            key={provider.id}
          >
            <header>
              <span className="provider-card-icon">
                {provider.id === 'mock' ? <Zap size={19} /> : <Plug size={19} />}
              </span>
              <div>
                <h3>
                  {provider.name}
                  {provider.isDefault && <span className="default-badge">Default</span>}
                </h3>
                <p>
                  {provider.id === 'mock'
                    ? 'Built-in demonstration · no external execution'
                    : 'Live integration is not implemented in this foundation'}
                </p>
              </div>
              <span
                className={`toggle ${provider.enabled ? 'on' : ''}`}
                role="img"
                aria-label={provider.enabled ? 'Enabled' : 'Unavailable'}
              />
            </header>
            <div className="provider-states">
              <div>
                <strong>
                  {provider.installation === 'builtin' ? <Check size={12} /> : null}
                  {provider.installation === 'builtin' ? 'Built in' : 'Not checked'}
                </strong>
                <small>Installation</small>
              </div>
              <div>
                <strong>
                  {provider.authentication === 'not-required' ? 'Not required' : 'Unknown'}
                </strong>
                <small>Authentication</small>
              </div>
              <div>
                <strong>{provider.enabled ? 'Enabled' : 'Unavailable'}</strong>
                <small>New chats</small>
              </div>
              <div>
                <strong>
                  <span className={`status-dot ${provider.running ? 'running' : ''}`} />
                  {provider.running ? 'Running' : 'Idle'}
                </strong>
                <small>Runtime</small>
              </div>
            </div>
            {provider.id === 'mock' && (
              <div className="provider-details">
                <div>
                  <span>Model</span>
                  <span className="setting-value">Demo model</span>
                </div>
                <div>
                  <span>Streaming and stop</span>
                  <span className="success">Available</span>
                </div>
                <div>
                  <span>Repository tools and commands</span>
                  <span className="muted">Simulated only</span>
                </div>
                <div>
                  <span>Failure testing</span>
                  <code>/fail</code>
                </div>
              </div>
            )}
            {provider.id !== 'mock' && (
              <p className="provider-note">
                JAM has not read credentials or verified a subscription. Provider-specific
                capabilities and authentication will be added separately.
              </p>
            )}
          </section>
        ))}
        <p className="settings-note">
          Provider state is reported by the runtime. This page makes no changes to your installed
          agents.
        </p>
      </div>
    </div>
  );
  const content =
    page === 'Snapshots' ? (
      <SnapshotSettings transport={transport} host={desktop.snapshots} />
    ) : page === 'Appearance' ? (
      appearance
    ) : (
      providersPage
    );
  if (dedicated)
    return (
      <div className={`jam-app dedicated-settings platform-${desktop.platform}`}>
        <aside className="settings-nav">
          <div className="settings-nav-header">
            {desktop.platform === 'macos' ? <TrafficLightInset /> : <Brand />}
            <strong>Settings</strong>
            <IconButton label="Open Settings as a resource tab" onClick={onMode}>
              <AppWindow size={15} />
            </IconButton>
            <IconButton label="Close Settings" onClick={onClose}>
              <X size={15} />
            </IconButton>
          </div>
          <div className="sidebar-search">
            <div className="search-trigger" title="Settings search is planned">
              <Search size={13} />
              <span>{page}</span>
            </div>
          </div>
          {navigation}
          <footer className="settings-nav-footer">
            <Shield size={12} /> Read-only provider status
          </footer>
        </aside>
        <main className="main-shell">
          <div className="titlebar">
            {desktop.platform === 'macos' && <WindowControls desktop={desktop} />}
            <div
              className="title-drag"
              onMouseDown={(event) => {
                if (event.button === 0) void desktop.startDragging();
              }}
            />
            {desktop.platform !== 'macos' && <WindowControls desktop={desktop} />}
          </div>
          <div className="workspace">
            <section className="pane">{content}</section>
          </div>
        </main>
      </div>
    );
  return (
    <section className="pane settings-pane">
      <header className="pane-header">
        <div className="pane-heading">
          <span className="muted">Settings</span>
          <span className="subtle">/</span>
          <strong>{page}</strong>
        </div>
        <button className="open-settings" onClick={onMode}>
          <Expand size={13} />
          Open full settings
          <ChevronRight size={12} />
        </button>
      </header>
      <div className="settings-pane-body">
        <aside className="settings-inner-nav">{navigation}</aside>
        {content}
      </div>
    </section>
  );
}
