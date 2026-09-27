import { AppWindow, Check, ChevronRight, Expand, Plug, Search, X, Zap } from 'lucide-react';
import type { JamTransport, Project, ProviderDescriptor } from '@jam/protocol';
import { Suspense, lazy, useState } from 'react';
import type { DesktopServices } from '../desktop';
import { ProjectBadge } from './ProjectBadge';
import { IDLE_THREAD_OPTIONS } from '../state/preferences';
import { useAppearance } from '../appearance/store';
import { Brand, IconButton, TrafficLightInset, WindowControls } from './Controls';
import { SettingsIcon, type SettingsIconName } from './settings-icons';

/** The Settings frames' grouping, in their order. */
const groups: { title: string; items: [string, SettingsIconName][] }[] = [
  {
    title: 'General',
    items: [
      ['General', 'general'],
      ['Appearance', 'appearance'],
    ],
  },
  {
    title: 'Agents',
    items: [
      ['Providers', 'providers'],
      ['Agent defaults', 'agent-defaults'],
      ['Permissions', 'permissions'],
    ],
  },
  {
    title: 'Tools',
    items: [
      ['Browser', 'browser'],
      ['Terminal', 'terminal'],
      ['Snapshots', 'snapshots'],
      ['Skills', 'skills'],
    ],
  },
  {
    title: 'System',
    items: [
      ['Keybindings', 'keybindings'],
      ['Storage', 'storage'],
      ['Advanced', 'advanced'],
      ['About', 'about'],
    ],
  },
];
const IMPLEMENTED = new Set(['General', 'Appearance', 'Providers', 'Snapshots']);
/** Loaded when the page is first opened, so the workspace never downloads them. */
const AppearanceSettings = lazy(() => import('./AppearanceSettings'));
const SnapshotSettings = lazy(() =>
  import('./SnapshotSettings').then((module) => ({ default: module.SnapshotSettings })),
);

export function SettingsPanel({
  transport,
  initialPage = 'Providers',
  providers,
  projects,
  onEditProject,
  dedicated,
  desktop,
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
  idleThreadDays: number | null;
  onIdleThreadDays(next: number | null): void;
  onClose(): void;
  onMode(): void;
}) {
  const [page, setPage] = useState<string>(initialPage);
  const { error: appearanceError } = useAppearance();
  const navigation = (
    <nav className="settings-nav-sections" aria-label="Settings sections">
      {groups.map((group) => (
        <section key={group.title}>
          <div className="section-label">{group.title}</div>
          {group.items.map(([name, icon]) => (
            <button
              key={name}
              type="button"
              className={`settings-nav-item ${name === page ? 'active' : ''}`}
              aria-current={name === page ? 'page' : undefined}
              onClick={() => setPage(name)}
            >
              <SettingsIcon name={icon} />
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
  const general = (
    <div className="settings-content-scroll">
      <div className="settings-content">
        <header className="settings-heading">
          <h2>General</h2>
          <p>How threads and projects behave in the sidebar.</p>
        </header>
        <header className="settings-heading">
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
      </div>
    </div>
  );
  const planned = (
    <div className="settings-content-scroll">
      <div className="settings-content">
        <header className="settings-heading">
          <h2>{page}</h2>
          <p>{page} settings are planned. Nothing on this page is configurable yet.</p>
        </header>
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
  const content = !IMPLEMENTED.has(page) ? (
    planned
  ) : page === 'Appearance' ? (
    <Suspense fallback={<div className="settings-content-scroll" />}>
      <AppearanceSettings />
    </Suspense>
  ) : page === 'Snapshots' ? (
    <Suspense fallback={<div className="settings-content-scroll" />}>
      <SnapshotSettings transport={transport} host={desktop.snapshots} />
    </Suspense>
  ) : page === 'General' ? (
    general
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
          <footer className={`settings-nav-footer ${appearanceError ? 'error' : ''}`}>
            {appearanceError ? (
              <>
                <X size={11} /> Appearance not saved
              </>
            ) : (
              <>
                <Check size={11} /> Saved automatically
              </>
            )}
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
