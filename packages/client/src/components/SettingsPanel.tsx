import { AppWindow, Check, ChevronRight, Expand, Search, X } from 'lucide-react';
import type { JamTransport, Project, ProviderDescriptor } from '@jam/protocol';
import { Suspense, lazy, useState, type ComponentType } from 'react';
import type { DesktopServices } from '../desktop';
import type { TimeFormat } from '../state/preferences';
import { useAppearance } from '../appearance/store';
import { Brand, IconButton, TrafficLightInset, WindowControls } from './Controls';
import { SettingsIcon, type SettingsIconName } from './settings-icons';
import type {
  ProjectChanges,
  ProviderControl,
  SettingsPageId,
  SettingsPageProps,
} from './settings/types';

/** The Settings v2 frames' grouping, in their order. */
const groups: { title: string; items: [SettingsPageId, SettingsIconName][] }[] = [
  {
    title: 'General',
    items: [
      ['General', 'general'],
      ['Appearance', 'appearance'],
      ['Projects', 'projects'],
    ],
  },
  {
    title: 'Agents',
    items: [
      ['Providers', 'providers'],
      ['Usage', 'usage'],
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

/** Each page is its own chunk, fetched the first time it is opened. */
const PAGES: Record<SettingsPageId, ComponentType<SettingsPageProps>> = {
  General: lazy(() => import('./settings/pages/GeneralPage')),
  Appearance: lazy(() => import('./AppearanceSettings')),
  Projects: lazy(() => import('./settings/pages/ProjectsPage')),
  Providers: lazy(() => import('./settings/pages/ProvidersPage')),
  Usage: lazy(() => import('./settings/pages/UsagePage')),
  Browser: lazy(() => import('./settings/pages/BrowserPage')),
  Terminal: lazy(() => import('./settings/pages/TerminalPage')),
  Snapshots: lazy(() => import('./settings/pages/SnapshotsPage')),
  Skills: lazy(() => import('./settings/pages/SkillsPage')),
  Keybindings: lazy(() => import('./settings/pages/KeybindingsPage')),
  Storage: lazy(() => import('./settings/pages/StoragePage')),
  Advanced: lazy(() => import('./settings/pages/AdvancedPage')),
  About: lazy(() => import('./settings/pages/AboutPage')),
};

export function SettingsPanel({
  transport,
  initialPage = 'General',
  providers,
  providerControl,
  projects,
  onUpdateProject,
  dedicated,
  desktop,
  idleThreadDays,
  onIdleThreadDays,
  streamReplies,
  onStreamReplies,
  timeFormat,
  onTimeFormat,
  onClose,
  onMode,
}: {
  transport: JamTransport;
  initialPage?: SettingsPageId;
  providers: ProviderDescriptor[];
  providerControl: ProviderControl;
  projects: Project[];
  onUpdateProject(projectId: string, changes: ProjectChanges): Promise<void>;
  dedicated: boolean;
  desktop: DesktopServices;
  idleThreadDays: number | null;
  onIdleThreadDays(next: number | null): void;
  streamReplies: boolean;
  onStreamReplies(next: boolean): void;
  timeFormat: TimeFormat;
  onTimeFormat(next: TimeFormat): void;
  onClose(): void;
  onMode(): void;
}) {
  const [page, setPage] = useState<SettingsPageId>(initialPage);
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
  const Page = PAGES[page];
  const content = (
    <div className="sv-scroll">
      <Suspense fallback={null}>
        <Page
          providers={providers}
          providerControl={providerControl}
          projects={projects}
          platform={desktop.platform}
          idleThreadDays={idleThreadDays}
          onIdleThreadDays={onIdleThreadDays}
          streamReplies={streamReplies}
          onStreamReplies={onStreamReplies}
          timeFormat={timeFormat}
          onTimeFormat={onTimeFormat}
          onUpdateProject={onUpdateProject}
          onNavigate={setPage}
          transport={transport}
          snapshots={desktop.snapshots}
        />
      </Suspense>
    </div>
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
              <span>Search settings</span>
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
            >
              <nav className="sv-breadcrumb" aria-label="Breadcrumb">
                <span>Settings</span>
                <span className="sep">/</span>
                <strong>{page}</strong>
              </nav>
            </div>
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
