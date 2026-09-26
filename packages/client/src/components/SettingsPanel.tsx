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
import type { ProviderDescriptor } from '@jam/protocol';
import type { DesktopServices } from '../desktop';
import { Brand, IconButton, WindowControls } from './Controls';

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
  providers,
  dedicated,
  desktop,
  onClose,
  onMode,
}: {
  providers: ProviderDescriptor[];
  dedicated: boolean;
  desktop: DesktopServices;
  onClose(): void;
  onMode(): void;
}) {
  const navigation = (
    <nav className="settings-nav-sections" aria-label="Settings sections">
      {groups.map((group) => (
        <section key={group.title}>
          <div className="section-label">{group.title}</div>
          {group.items.map(([name, Icon]) => (
            <button
              key={name}
              className={`settings-nav-item ${name === 'Providers' ? 'active' : ''}`}
              disabled={name !== 'Providers'}
              title={name !== 'Providers' ? `${name} settings are planned` : undefined}
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
  const content = (
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
  if (dedicated)
    return (
      <div className={`jam-app dedicated-settings platform-${desktop.platform}`}>
        <aside className="settings-nav">
          <div className="settings-nav-header">
            <Brand />
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
              <span>Providers</span>
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
          <strong>Providers</strong>
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
