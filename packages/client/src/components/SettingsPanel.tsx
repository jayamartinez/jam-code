import { AppWindow, Check, ChevronRight, Expand, Search, X } from 'lucide-react';
import type { JamTransport, Project, ProviderDescriptor } from '@jam/protocol';
import { Suspense, lazy, useEffect, useRef, useState, type ComponentType } from 'react';
import type { DesktopServices } from '../desktop';
import type { NewThreadWorkspace, TimeFormat } from '../state/preferences';
import { useAppearance } from '../appearance/store';
import { Brand, IconButton, TrafficLightInset, WindowControls } from './Controls';
import { SettingsIcon, type SettingsIconName } from './settings-icons';
import type {
  ProjectChanges,
  ProjectControl,
  ProviderControl,
  SettingsPageId,
  SettingsPageProps,
} from './settings/types';
import { searchSettings, type SettingsEntry } from './settings/search-index';

/** The Settings v2 frames' grouping, in their order. */
const groups: { title: string; items: [SettingsPageId, SettingsIconName][] }[] = [
  {
    title: 'General',
    items: [
      ['General', 'general'],
      ['Notifications', 'notifications'],
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
  Notifications: lazy(() => import('./settings/pages/NotificationsPage')),
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
  projectControl,
  dedicated,
  desktop,
  idleThreadDays,
  onIdleThreadDays,
  streamReplies,
  onStreamReplies,
  timeFormat,
  onTimeFormat,
  newThreadWorkspace,
  onNewThreadWorkspace,
  onClose,
  onMode,
}: {
  transport: JamTransport;
  initialPage?: SettingsPageId;
  providers: ProviderDescriptor[];
  providerControl: ProviderControl;
  projects: Project[];
  onUpdateProject(projectId: string, changes: ProjectChanges): Promise<void>;
  projectControl: ProjectControl;
  dedicated: boolean;
  desktop: DesktopServices;
  idleThreadDays: number | null;
  onIdleThreadDays(next: number | null): void;
  streamReplies: boolean;
  onStreamReplies(next: boolean): void;
  timeFormat: TimeFormat;
  onTimeFormat(next: TimeFormat): void;
  newThreadWorkspace: NewThreadWorkspace;
  onNewThreadWorkspace(next: NewThreadWorkspace): void;
  onClose(): void;
  onMode(): void;
}) {
  const [page, setPage] = useState<SettingsPageId>(initialPage);
  const { error: appearanceError } = useAppearance();
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<SettingsEntry | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const results = searchSettings(query);
  const open = (entry: SettingsEntry) => {
    setPage(entry.page);
    setFound(entry);
    setQuery('');
  };
  // The chosen row is found once its page has loaded, scrolled to and lit briefly.
  useEffect(() => {
    if (!found) return;
    let frame = 0;
    let tries = 0;
    let timer = 0;
    const look = () => {
      const row = [...(scroll.current?.querySelectorAll<HTMLElement>('.sv-row') ?? [])].find(
        (item) => item.querySelector('.sv-row-text strong')?.textContent?.trim() === found.title,
      );
      if (!row) {
        if (++tries < 60) frame = requestAnimationFrame(look);
        return;
      }
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      row.classList.add('sv-row-found');
      timer = window.setTimeout(() => row.classList.remove('sv-row-found'), 1800);
      setFound(null);
    };
    frame = requestAnimationFrame(look);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [found, page]);
  const search = (
    <div className="settings-search">
      <Search size={13} aria-hidden="true" />
      <input
        type="search"
        placeholder="Search settings"
        aria-label="Search settings"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && results[0]) open(results[0]);
          if (event.key === 'Escape' && query) {
            event.stopPropagation();
            setQuery('');
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            event.currentTarget
              .closest('aside')
              ?.querySelector<HTMLElement>('.settings-result')
              ?.focus();
          }
        }}
      />
    </div>
  );
  const resultList = (
    <nav className="settings-nav-sections settings-results" aria-label="Search results">
      {results.map((entry) => (
        <button
          key={[entry.page, entry.section, entry.title].join('/')}
          type="button"
          className="settings-result"
          onClick={() => open(entry)}
          onKeyDown={(event) => {
            const sibling =
              event.key === 'ArrowDown'
                ? event.currentTarget.nextElementSibling
                : event.key === 'ArrowUp'
                  ? event.currentTarget.previousElementSibling
                  : null;
            if (sibling instanceof HTMLElement) {
              event.preventDefault();
              sibling.focus();
            }
          }}
        >
          <span>{entry.title}</span>
          <small>{entry.section ? entry.page + ' · ' + entry.section : entry.page}</small>
        </button>
      ))}
      {!results.length && <p className="settings-no-results">No settings match.</p>}
    </nav>
  );
  const sections = (
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
  const navigation = query.trim() ? resultList : sections;
  const Page = PAGES[page];
  const content = (
    <div className="sv-scroll" ref={scroll}>
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
          newThreadWorkspace={newThreadWorkspace}
          onNewThreadWorkspace={onNewThreadWorkspace}
          onUpdateProject={onUpdateProject}
          projectControl={projectControl}
          onNavigate={setPage}
          transport={transport}
          snapshots={desktop.snapshots}
          openFeedback={desktop.openFeedback}
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
          <div className="sidebar-search">{search}</div>
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
        <aside className="settings-inner-nav">
          <div className="settings-inner-search">{search}</div>
          {navigation}
        </aside>
        {content}
      </div>
    </section>
  );
}
