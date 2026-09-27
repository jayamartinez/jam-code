import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Folder, Plus, X } from 'lucide-react';
import type {
  ContextItem,
  JamTransport,
  OpenableKind,
  Presentation,
  ProjectIcon,
} from '@jam/protocol';
import type { DesktopServices } from './desktop';
import {
  activeResourceId,
  activeTree,
  findLeaf,
  focusedPane,
  initialLayout,
  layoutReducer,
  leaves,
  type SplitDirection,
} from './state/layout';
import { RuntimeClient } from './state/runtime-client';
import { useEditorPreferences, useIdleThreadDays } from './state/preferences';
import { Brand, Dialog, IconButton } from './components/Controls';
import { Sidebar } from './components/Sidebar';
import { Composer } from './components/ConversationPane';
import { ConversationResource } from './components/ConversationResource';
import { SearchDialog } from './components/SearchDialog';
import { SettingsPanel } from './components/SettingsPanel';
import { NewResourceLauncher } from './components/NewResourceLauncher';
import { NewChat } from './components/NewChat';
import { WorkspaceTitlebar } from './components/WorkspaceTitlebar';
import { PaneChrome, type PaneMenuItem } from './components/PaneChrome';
import { TileLayout } from './components/TileLayout';
import { EmptyPane } from './components/EmptyPane';
import { FileBrowser } from './components/FileBrowser';
import { FileIconThemeProvider, useFileIconThemeChoice } from './components/file-icons';
import { FileResource } from './components/FileResource';
import { ContextMenu, menuPoint, type ContextMenuState } from './components/ContextMenu';
import { ProjectEditor } from './components/ProjectEditor';

const DemoResource = lazy(() => import('./components/DemoResource'));
const emptyContext: ContextItem[] = [];
const emptyPaths: string[] = [];
type Overlay = 'search' | null;
/** Set while the New Resource launcher is open; `paneId` targets an empty pane. */
/** Viewport point the launcher hangs from: the control that opened it. */
type LauncherAnchor = { left: number; bottom: number };
type LauncherTarget = { paneId?: string; anchor?: LauncherAnchor } | null;
const anchorOf = (element: Element | null): LauncherAnchor | undefined => {
  const box = element?.getBoundingClientRect();
  return box ? { left: box.left, bottom: box.bottom } : undefined;
};

export interface JamAppProps {
  transport: JamTransport;
  desktop: DesktopServices;
}

const newPaneId = () => `pane:${crypto.randomUUID()}`;
const newSplitId = () => `split:${crypto.randomUUID()}`;
/**
 * The Files frame gives the browser 250px. A ratio is relative to the pane
 * being split, so it is derived from that pane's real width rather than the
 * frame's 1160px, or a browser opened beside a chat would be squeezed thin.
 */
const BROWSER_WIDTH = 250;
const browserRatio = (paneId: string | undefined) => {
  const width = paneId
    ? document.querySelector(`[data-pane-id="${paneId}"]`)?.getBoundingClientRect().width
    : undefined;
  const available = width || document.querySelector('.workspace')?.getBoundingClientRect().width;
  return available
    ? Math.min(0.5, Math.max(0.15, BROWSER_WIDTH / available))
    : BROWSER_WIDTH / 1160;
};

export function JamApp({ transport, desktop }: JamAppProps) {
  const client = useMemo(() => new RuntimeClient(transport), [transport]);
  const { workspace, error } = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    client.getSnapshot,
  );
  const [layout, dispatch] = useReducer(layoutReducer, initialLayout);
  const [projectId, setProjectId] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [contextTarget, setContextTarget] = useState<string | null>(null);
  const [launcher, setLauncher] = useState<LauncherTarget>(null);
  const [settingsMode, setSettingsMode] = useState<'dedicated' | null>(null);
  const [newChats, setNewChats] = useState<
    Record<string, { projectId: string; presentation: Presentation }>
  >({});
  const [context, setContext] = useState<Record<string, ContextItem[]>>({});
  /** Expanded folders per file-browser resource, outside any pane's lifetime. */
  const [treeExpansion, setTreeExpansion] = useState<Record<string, string[]>>({});
  const [iconTheme, setIconTheme] = useFileIconThemeChoice();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [editorPreferences, setEditorPreferences] = useEditorPreferences();
  const [idleThreadDays, setIdleThreadDays] = useIdleThreadDays();
  /**
   * Projects whose threads the sidebar lists. Any number can be open at once;
   * until the reader toggles one, the current project is shown open.
   */
  const [expandedProjects, setExpandedProjects] = useState<string[] | undefined>(undefined);
  const [previewContext, setPreviewContext] = useState<ContextItem | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const busyRef = useRef(new Set<string>());
  const requests = useRef(new Map<string, { payload: string; requestId: string }>());
  const initialized = useRef(false);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  // Shortcut modifier follows the OS, not the host: a browser client on a Mac
  // still uses ⌘, and the desktop app on Windows uses Ctrl.
  const usesCommand =
    desktop.platform === 'macos' ||
    (desktop.platform === 'web' &&
      typeof navigator !== 'undefined' &&
      /Mac|iPhone|iPad/.test(navigator.platform));
  const shortcut = usesCommand ? '⌘' : 'Ctrl';

  const activeTabId = layout.activeTabId;
  const activeId = activeResourceId(layout);
  const activeResource = workspace?.resources.find((resource) => resource.id === activeId);
  const project = workspace?.projects.find(
    (item) => item.id === (activeResource?.projectId ?? newChats[activeId]?.projectId ?? projectId),
  );

  useEffect(() => {
    void client.connect();
    return () => client.disconnect();
  }, [client]);
  useEffect(() => {
    if (!workspace || initialized.current) return;
    initialized.current = true;
    setProjectId(workspace.projects[0]?.id ?? '');
    const first = workspace.resources.find((resource) => resource.kind === 'conversation');
    if (first) dispatch({ type: 'openTab', resourceId: first.id });
  }, [workspace]);

  /**
   * Selecting a resource from the tab bar, sidebar or search switches to its
   * tab. It never loads into whichever pane happens to be focused.
   */
  const openResource = useCallback(
    (resourceId: string) => {
      dispatch({ type: 'openTab', resourceId });
      setOverlay(null);
      setLauncher(null);
      setSettingsMode(null);
      const resource = client
        .getSnapshot()
        .workspace?.resources.find((item) => item.id === resourceId);
      if (resource?.projectId) setProjectId(resource.projectId);
    },
    [client],
  );

  /** Load a resource into a pane of the current tab. Adds no tab. */
  const assignPane = useCallback((resourceId: string, paneId?: string) => {
    dispatch({ type: 'mode', mode: 'tiles' });
    dispatch({ type: 'assignPane', resourceId, ...(paneId ? { paneId } : {}) });
    setLauncher(null);
  }, []);

  /** A new chat is an unsaved draft until its first explicit Send. */
  const newChat = useCallback(
    (presentation: Presentation = 'claude', paneId?: string) => {
      if (!projectId) return;
      const id = `draft:${crypto.randomUUID()}`;
      setNewChats((current) => ({ ...current, [id]: { projectId, presentation } }));
      if (paneId) assignPane(id, paneId);
      else dispatch({ type: 'openTab', resourceId: id });
      setOverlay(null);
      setLauncher(null);
      setSettingsMode(null);
    },
    [assignPane, projectId],
  );

  /** The runtime owns resource identity: reopening a target reuses its record. */
  const openKind = useCallback(
    async (kind: OpenableKind, path?: string, paneId?: string, inProject?: string) => {
      const target = inProject ?? projectId;
      if (!target) return;
      try {
        const { resource } = await transport.request('resource.open', {
          projectId: target,
          kind,
          ...(path === undefined ? {} : { path }),
        });
        client.addResource(resource);
        if (paneId) assignPane(resource.id, paneId);
        else openResource(resource.id);
      } catch (cause) {
        client.reportError(cause);
      }
    },
    [assignPane, client, openResource, projectId, transport],
  );

  const switchProject = useCallback(
    (id: string) => {
      setProjectId(id);
      const resource = client
        .getSnapshot()
        .workspace?.resources.find((item) => item.kind === 'conversation' && item.projectId === id);
      if (resource) openResource(resource.id);
    },
    [client, openResource],
  );
  const closeTab = useCallback((tabId: string) => dispatch({ type: 'closeTab', tabId }), []);

  /** A project row selects the project and shows or hides its threads. */
  const toggleProject = useCallback(
    (id: string) => {
      setProjectId(id);
      setExpandedProjects((current) => {
        const open = current ?? [projectId];
        return open.includes(id) ? open.filter((item) => item !== id) : [...open, id];
      });
    },
    [projectId],
  );

  const setThreadClosed = useCallback(
    (resourceId: string, closed: boolean) =>
      void transport
        .request('thread.setClosed', { resourceId, closed })
        .then(({ resource }) => client.updateResource(resource))
        .catch(client.reportError),
    [client, transport],
  );
  const keepThreadOpen = useCallback(
    (resourceId: string) =>
      void transport
        .request('thread.keepOpen', { resourceId })
        .then(({ resource }) => client.updateResource(resource))
        .catch(client.reportError),
    [client, transport],
  );

  const updateProject = useCallback(
    async (
      projectId: string,
      changes: { name?: string; paths?: string[]; icon?: ProjectIcon; pinned?: boolean },
    ) => {
      // Errors surface in the editor rather than the global banner.
      const { project: updated } = await transport.request('project.update', {
        projectId,
        ...changes,
      });
      client.updateProject(updated);
    },
    [client, transport],
  );

  /**
   * Choosing a file keeps the browser on screen. The file goes to a pane that
   * already holds one, then to an empty pane, and otherwise to a new pane
   * split beside the browser at the Files frame's proportion.
   */
  const openFileFrom = useCallback(
    async (path: string, fromPaneId: string | null, inProject?: string) => {
      const target = inProject ?? projectId;
      if (!target) return;
      let resourceId: string;
      try {
        const { resource } = await transport.request('resource.open', {
          projectId: target,
          kind: 'file',
          path,
        });
        client.addResource(resource);
        resourceId = resource.id;
      } catch (cause) {
        client.reportError(cause);
        return;
      }
      const current = layoutRef.current;
      const tree = activeTree(current);
      const browserPane = fromPaneId ?? focusedPane(current)?.id;
      const others = leaves(tree).filter((pane) => pane.id !== browserPane);
      const kindOf = (id: string | null) =>
        client.getSnapshot().workspace?.resources.find((item) => item.id === id)?.kind;
      const editorPane =
        others.find((pane) => kindOf(pane.resourceId) === 'file') ??
        others.find((pane) => !pane.resourceId);
      if (editorPane) {
        assignPane(resourceId, editorPane.id);
        return;
      }
      dispatch({ type: 'mode', mode: 'tiles' });
      dispatch({
        type: 'split',
        ...(browserPane ? { paneId: browserPane } : {}),
        direction: 'row',
        splitId: newSplitId(),
        newPaneId: newPaneId(),
        resourceId,
        ratio: browserRatio(browserPane),
      });
    },
    [assignPane, client, projectId, transport],
  );

  const openSettings = useCallback(() => {
    setSettingsMode('dedicated');
    setOverlay(null);
    setLauncher(null);
  }, []);

  /** Splitting applies to the current tab's own arrangement. */
  const splitPane = useCallback((direction: SplitDirection, paneId?: string) => {
    dispatch({ type: 'mode', mode: 'tiles' });
    dispatch({
      type: 'split',
      ...(paneId ? { paneId } : {}),
      direction,
      splitId: newSplitId(),
      newPaneId: newPaneId(),
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        if (overlay || launcher || previewContext) return;
        if (settingsMode) setSettingsMode(null);
        else if (layout.focus) dispatch({ type: 'focus' });
        return;
      }
      if (!(usesCommand ? event.metaKey : event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'k') {
        event.preventDefault();
        setOverlay('search');
      } else if (key === 'n') {
        event.preventDefault();
        if (!overlay && !launcher) newChat(event.shiftKey ? 'codex' : 'claude');
      } else if (key === 't') {
        event.preventDefault();
        // The keyboard path hangs from the tab strip's own new-tab button.
        setLauncher({ anchor: anchorOf(document.querySelector('.new-resource')) });
      } else if (event.key === ',') {
        event.preventDefault();
        openSettings();
      } else if (event.key === '.') {
        event.preventDefault();
        dispatch({ type: 'focus' });
      } else if (key === 'w' && activeTabId && !overlay && !launcher && !settingsMode) {
        event.preventDefault();
        closeTab(activeTabId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    activeTabId,
    closeTab,
    usesCommand,
    launcher,
    layout.focus,
    newChat,
    openSettings,
    overlay,
    previewContext,
    settingsMode,
  ]);

  async function send(sendId: string) {
    const text = layout.drafts[sendId] ?? '';
    const staged = context[sendId] ?? emptyContext;
    const sendSession = workspace?.sessions.find(
      (session) => session.id === workspace.resources.find((item) => item.id === sendId)?.sessionId,
    );
    if (
      (!text.trim() && !staged.length) ||
      busyRef.current.has(sendId) ||
      sendSession?.status === 'running'
    )
      return;
    busyRef.current.add(sendId);
    setBusy(new Set(busyRef.current));
    let resourceId = sendId;
    try {
      const draft = newChats[sendId];
      if (draft) {
        const created = await transport.request('conversation.create', {
          projectId: draft.projectId,
          presentation: draft.presentation,
        });
        client.addConversation(created);
        resourceId = created.resource.id;
        busyRef.current.add(resourceId);
        setBusy(new Set(busyRef.current));
        dispatch({ type: 'replaceDraft', draftId: sendId, resourceId });
        setNewChats((current) => {
          const rest = { ...current };
          delete rest[sendId];
          return rest;
        });
        setContext((current) => ({ ...current, [resourceId]: staged }));
      }
      const payload = JSON.stringify({ text, context: staged });
      const previous = requests.current.get(resourceId);
      const requestId = previous?.payload === payload ? previous.requestId : crypto.randomUUID();
      requests.current.set(resourceId, { payload, requestId });
      await transport.request('turn.start', {
        resourceId,
        text,
        context: staged,
        requestId,
      });
      requests.current.delete(resourceId);
      dispatch({ type: 'draft', resourceId, text: '' });
      setContext((current) => ({ ...current, [resourceId]: [] }));
    } catch (cause) {
      client.reportError(cause);
    } finally {
      busyRef.current.delete(sendId);
      busyRef.current.delete(resourceId);
      setBusy(new Set(busyRef.current));
    }
  }

  const composerFor = (resourceId: string, sessionId?: string) => ({
    draft: layout.drafts[resourceId] ?? '',
    context: context[resourceId] ?? emptyContext,
    busy: busy.has(resourceId),
    shortcut,
    onDraft: (text: string) => dispatch({ type: 'draft', resourceId, text }),
    onSend: () => void send(resourceId),
    onStop: () => {
      if (sessionId)
        void transport.request('turn.interrupt', { sessionId }).catch(client.reportError);
    },
    onAddContext: () => setContextTarget(resourceId),
    onPreviewContext: setPreviewContext,
    onRemoveContext: (id: string) =>
      setContext((current) => ({
        ...current,
        [resourceId]: (current[resourceId] ?? emptyContext).filter((item) => item.id !== id),
      })),
    onOpenDemo: () => void openKind('diff'),
  });

  if (!workspace)
    return (
      <div className="jam-app">
        <div className="empty-surface">
          <Brand />
          {error ? (
            <>
              <p role="alert">{error}</p>
              <button
                className="button"
                onClick={() => {
                  client.disconnect();
                  void client.connect();
                }}
              >
                Reconnect to runtime
              </button>
            </>
          ) : (
            <p role="status">Opening your workspace…</p>
          )}
        </div>
      </div>
    );

  const settings = (dedicated: boolean) => (
    <SettingsPanel
      providers={workspace.providers}
      projects={workspace.projects}
      onEditProject={(id) => {
        setSettingsMode(null);
        setEditingProject(id);
      }}
      dedicated={dedicated}
      desktop={desktop}
      editor={editorPreferences}
      onEditor={setEditorPreferences}
      idleThreadDays={idleThreadDays}
      onIdleThreadDays={setIdleThreadDays}
      onClose={() => setSettingsMode(null)}
      onMode={() => {
        if (dedicated) {
          const resource = workspace.resources.find((item) => item.kind === 'settings');
          if (resource) openResource(resource.id);
        } else openSettings();
      }}
    />
  );

  const paneResourceIds = leaves(activeTree(layout)).map((pane) => pane.resourceId);
  /** The file a browser should mark as selected: any file in this tab. */
  const openFilePath = workspace.resources.find(
    (item) => item.kind === 'file' && paneResourceIds.includes(item.id),
  )?.path;

  /** Chrome shared by every pane, so split/close mean one thing everywhere. */
  const chromeFor = (paneId: string | null) => {
    const tiled = layout.mode === 'tiles';
    const paneCount = leaves(activeTree(layout)).length;
    const pane = paneId ? findLeaf(activeTree(layout), paneId) : undefined;
    const menu: PaneMenuItem[] = [
      { label: 'Split right', onSelect: () => splitPane('row', paneId ?? undefined) },
      { label: 'Split down', onSelect: () => splitPane('column', paneId ?? undefined) },
      {
        label: 'Open resource here…',
        onSelect: () =>
          setLauncher({
            paneId: paneId ?? undefined,
            anchor: anchorOf(
              paneId ? document.querySelector(`[data-pane-id="${paneId}"] .pane-header`) : null,
            ),
          }),
      },
      {
        label: 'Close pane',
        // Closing a pane is presentation only; the resource stays in history.
        onSelect:
          tiled && paneId && paneCount > 1
            ? () => dispatch({ type: 'closePane', paneId })
            : undefined,
        unavailable: !tiled
          ? 'Single mode shows one pane. Switch to Tiles to arrange panes.'
          : paneCount > 1
            ? undefined
            : 'This is the only pane.',
      },
      {
        label: 'Close tab',
        onSelect: activeTabId ? () => closeTab(activeTabId) : undefined,
        danger: true,
      },
    ];
    return {
      focused: tiled ? focusedPane(layout)?.id === pane?.id : true,
      onSplitRight: () => splitPane('row', paneId ?? undefined),
      onSplitDown: () => splitPane('column', paneId ?? undefined),
      onExpand: () => dispatch({ type: 'focus' }),
      expandLabel: 'Focus this resource',
      menu,
    };
  };

  /** Resource surfaces. The caller supplies chrome; surfaces never place panes. */
  const surfaceFor = (resourceId: string, paneId: string | null) => {
    const chrome = chromeFor(paneId);
    const draft = newChats[resourceId];
    if (draft) {
      const draftProject = workspace.projects.find((item) => item.id === draft.projectId);
      return (
        <PaneChrome
          {...chrome}
          className="new-chat-pane"
          label="New chat"
          heading={
            <>
              <span className="project-label muted">{draftProject?.name}</span>
              <span className="separator subtle">/</span>
              <span className="resource-title">New chat</span>
            </>
          }
          status={<span className="subtle">Not started · nothing is saved until you send</span>}
        >
          <NewChat
            project={draftProject}
            resources={workspace.resources.filter(
              (item) => item.projectId === draft.projectId && item.kind === 'conversation',
            )}
            onOpen={openResource}
            onStarter={(text) => dispatch({ type: 'draft', resourceId, text })}
            presentationOf={(item) =>
              workspace.sessions.find((session) => session.id === item.sessionId)?.presentation
            }
            composer={
              <Composer {...composerFor(resourceId)} presentation={draft.presentation} isNew />
            }
          />
        </PaneChrome>
      );
    }
    const resource = workspace.resources.find((item) => item.id === resourceId);
    if (!resource)
      return (
        <PaneChrome {...chrome} label="Missing resource" heading={<span>Unavailable</span>}>
          <div className="pane-state error" role="alert">
            This resource is no longer in the workspace.
          </div>
        </PaneChrome>
      );
    switch (resource.kind) {
      case 'conversation': {
        const session = workspace.sessions.find((item) => item.id === resource.sessionId);
        return (
          <ConversationResource
            client={client}
            chrome={chrome}
            resource={resource}
            project={workspace.projects.find((item) => item.id === resource.projectId)}
            session={session}
            composer={composerFor(resource.id, session?.id)}
          />
        );
      }
      case 'file':
        return (
          <FileResource
            {...chrome}
            transport={transport}
            resource={resource}
            project={workspace.projects.find((item) => item.id === resource.projectId)}
            saveShortcut={shortcut}
          />
        );
      case 'file-browser':
        return (
          <FileBrowser
            {...chrome}
            transport={transport}
            project={workspace.projects.find((item) => item.id === resource.projectId)}
            selectedPath={openFilePath}
            expanded={treeExpansion[resource.id] ?? emptyPaths}
            iconTheme={iconTheme}
            onIconTheme={setIconTheme}
            onExpandedChange={(next) =>
              setTreeExpansion((current) => ({ ...current, [resource.id]: next }))
            }
            onOpenFile={(path) => void openFileFrom(path, paneId, resource.projectId)}
          />
        );
      case 'diff':
      case 'terminal':
        return (
          <Suspense fallback={<section className="pane empty-surface">Loading demo…</section>}>
            <DemoResource kind={resource.kind} chrome={chrome} />
          </Suspense>
        );
      case 'settings':
        return settings(false);
      default:
        return (
          <PaneChrome {...chrome} label={resource.title} heading={<span>{resource.title}</span>}>
            <div className="pane-state">
              <p>{resource.title}</p>
              <p className="subtle">This resource is planned for a later milestone.</p>
            </div>
          </PaneChrome>
        );
    }
  };

  const renderPane = (paneId: string) => {
    const pane = findLeaf(activeTree(layout), paneId);
    if (!pane?.resourceId)
      return (
        <EmptyPane
          {...chromeFor(paneId)}
          shortcut={shortcut}
          onChoose={(element) => setLauncher({ paneId, anchor: anchorOf(element) })}
        />
      );
    return surfaceFor(pane.resourceId, paneId);
  };

  return (
    <FileIconThemeProvider theme={iconTheme}>
      {settingsMode ? (
        settings(true)
      ) : (
        <div
          className={`jam-app platform-${desktop.platform} ${layout.mode} ${layout.focus ? 'focus-mode' : ''}`}
        >
          {!layout.focus && (
            <Sidebar
              workspace={workspace}
              collapsed={layout.collapsed}
              platform={desktop.platform}
              projectId={projectId}
              activeResourceId={activeId}
              projectFilter={projectFilter}
              providerFilter={providerFilter}
              shortcut={shortcut}
              onProject={toggleProject}
              expandedProjectIds={expandedProjects ?? [projectId]}
              idleThreadDays={idleThreadDays}
              onCloseThread={(id) => setThreadClosed(id, true)}
              onKeepThreadOpen={keepThreadOpen}
              onThreadMenu={(resource, event) =>
                setContextMenu({
                  ...menuPoint(event),
                  items: [
                    { label: 'Open', onSelect: () => openResource(resource.id) },
                    resource.closedAt
                      ? {
                          label: 'Reopen thread',
                          onSelect: () => setThreadClosed(resource.id, false),
                        }
                      : {
                          label: 'Close thread',
                          onSelect: () => setThreadClosed(resource.id, true),
                        },
                  ],
                })
              }
              onProjectFilter={setProjectFilter}
              onProviderFilter={setProviderFilter}
              onOpen={openResource}
              onSearch={() => setOverlay('search')}
              onNew={() => newChat()}
              onSettings={openSettings}
              onCollapse={() => dispatch({ type: 'collapse' })}
              onProjectMenu={(id, event) =>
                setContextMenu({
                  ...menuPoint(event),
                  items: [
                    { label: 'Edit project details…', onSelect: () => setEditingProject(id) },
                    workspace.projects.find((item) => item.id === id)?.pinned
                      ? {
                          label: 'Unpin project',
                          onSelect: () =>
                            void updateProject(id, { pinned: false }).catch(client.reportError),
                        }
                      : {
                          label: 'Pin project',
                          onSelect: () =>
                            void updateProject(id, { pinned: true }).catch(client.reportError),
                        },
                    { label: 'Switch to project', onSelect: () => switchProject(id) },
                    {
                      label: 'Open file browser',
                      onSelect: () => void openKind('file-browser', undefined, undefined, id),
                    },
                  ],
                })
              }
            />
          )}
          <main className="main-shell">
            <WorkspaceTitlebar
              desktop={desktop}
              layout={layout}
              workspace={workspace}
              drafts={newChats}
              project={project}
              activeResource={activeResource}
              shortcut={shortcut}
              launcherOpen={!!launcher}
              onSelectTab={(resourceId) => openResource(resourceId)}
              onCloseTab={closeTab}
              onMoveTab={(from, to) => dispatch({ type: 'moveTab', from, to })}
              onNewResource={(element) =>
                setLauncher((current) => (current ? null : { anchor: anchorOf(element) }))
              }
              onExitFocus={() => dispatch({ type: 'focus' })}
              onMode={(mode) => dispatch({ type: 'mode', mode })}
            />
            {error && (
              <div className="error-banner" role="alert">
                <span>{error}</span>
                <IconButton label="Dismiss error" onClick={client.clearError}>
                  <X size={13} />
                </IconButton>
              </div>
            )}
            <div className="workspace">
              {layout.mode === 'tiles' && activeTree(layout) && !layout.focus ? (
                <TileLayout
                  node={activeTree(layout)!}
                  focusedPaneId={focusedPane(layout)?.id ?? null}
                  renderPane={renderPane}
                  onFocusPane={(paneId) => dispatch({ type: 'focusPane', paneId })}
                  onResize={(splitId, ratio) => dispatch({ type: 'resize', splitId, ratio })}
                />
              ) : activeId ? (
                surfaceFor(activeId, null)
              ) : (
                <section className="pane empty-surface">
                  <h2>Your work is still here.</h2>
                  <p>Open a conversation from history or start something new.</p>
                  <button className="button primary" onClick={() => newChat()}>
                    <Plus size={14} />
                    New chat
                  </button>
                </section>
              )}
            </div>
            {launcher && (
              <NewResourceLauncher
                projects={workspace.projects}
                projectId={projectId}
                shortcut={shortcut}
                anchor={launcher.anchor}
                onClose={() => setLauncher(null)}
                onProject={switchProject}
                onAgentChat={(presentation) => newChat(presentation, launcher.paneId)}
                onResource={(kind) => void openKind(kind, undefined, launcher.paneId)}
                target={launcher.paneId ? 'pane' : 'tab'}
              />
            )}
          </main>
        </div>
      )}
      {overlay === 'search' && (
        <SearchDialog
          transport={transport}
          projects={workspace.projects}
          resources={workspace.resources}
          sessions={workspace.sessions}
          onClose={() => setOverlay(null)}
          onOpen={openResource}
        />
      )}
      {contextTarget && (
        <Dialog
          title="Add context"
          className="context-dialog"
          onClose={() => setContextTarget(null)}
        >
          <h2>Add demo context</h2>
          <p>
            Stage a demo file reference. Press Send to include it in the mock transcript. No file is
            read.
          </p>
          <button
            className="button"
            onClick={() => {
              const item: ContextItem = {
                id: crypto.randomUUID(),
                kind: 'file',
                label: 'registry.ts · demo',
                source: {
                  uri: 'project://project-jam/src/session/registry.ts',
                },
              };
              setContext((current) => ({
                ...current,
                [contextTarget]: [...(current[contextTarget] ?? emptyContext), item].slice(0, 16),
              }));
              setContextTarget(null);
            }}
          >
            <Folder size={13} />
            registry.ts
          </button>
          <p>Native files, browser selections and snapshots are planned.</p>
        </Dialog>
      )}
      {previewContext && (
        <Dialog
          title="Context preview"
          className="context-dialog"
          onClose={() => setPreviewContext(null)}
        >
          <h2>{previewContext.label}</h2>
          <code>{previewContext.source.uri ?? previewContext.source.resourceId}</code>
          <p>
            Staged reference · demonstration only. It will be included in your next explicit Send.
          </p>
          <button className="button" onClick={() => setPreviewContext(null)}>
            Done
          </button>
        </Dialog>
      )}
      {contextMenu && <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />}
      {editingProject &&
        (() => {
          const target = workspace.projects.find((item) => item.id === editingProject);
          return target ? (
            <ProjectEditor
              project={target}
              platform={desktop.platform}
              onSave={(changes) => updateProject(target.id, changes)}
              onClose={() => setEditingProject(null)}
            />
          ) : null;
        })()}
    </FileIconThemeProvider>
  );
}
