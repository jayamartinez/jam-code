import { GitClient } from './state/git-client';
import { useGitWorkspace } from './state/use-git-workspace';
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
  ProjectIcon,
  ProviderId,
  RequestMap,
  TerminalSession,
} from '@jam/protocol';
import { type ChatDraft, draftProvider, presentationFor } from './state/chat-draft';
import type { InteractionAnswer } from './components/InteractionCard';
import type { BrowserAnnotation, DesktopServices } from './desktop';
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
import { useIdleThreadDays, useStreamReplies, useTimeFormat } from './state/preferences';
import { AppearanceContext, AppearanceStore } from './appearance/store';
import { Brand, Dialog, IconButton } from './components/Controls';
import { Sidebar } from './components/Sidebar';
import { Composer } from './components/ConversationPane';
import { toggledFavorite, withoutStaleChoices } from './components/composer-model';
import { ConversationResource } from './components/ConversationResource';
import { SearchDialog } from './components/SearchDialog';
import { SnapshotPreview } from './components/SnapshotPreview';
import { useSnapshots, snapshotFocus } from './state/snapshots';
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
import { TerminalResource } from './components/TerminalResource';
import { estimateTerminalSize } from './components/terminal-metrics';
import { ContextMenu, menuPoint, type ContextMenuState } from './components/ContextMenu';
import type { FileReference } from './markdown/file-refs';
import { parseAddress } from './state/browser-address';
import { ProjectEditor } from './components/ProjectEditor';
import { BrowserResource, describeAnnotation } from './components/BrowserResource';

const ReviewResource = lazy(() => import('./components/ReviewResource'));
const emptyContext: ContextItem[] = [];
const emptyPaths: string[] = [];
const emptyAnnotations: BrowserAnnotation[] = [];
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

const hostOf = (href: string) => {
  try {
    return new URL(href).host;
  } catch {
    return href;
  }
};
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
  const appearance = useMemo(() => new AppearanceStore(transport), [transport]);
  useEffect(() => {
    void appearance.load();
    // A pending change is written before the window goes away.
    const flush = () => appearance.flush();
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      appearance.dispose();
    };
  }, [appearance]);
  const { workspace: runtimeWorkspace, error } = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    client.getSnapshot,
  );
  const git = useMemo(() => new GitClient(transport), [transport]);
  const workspace = useGitWorkspace(runtimeWorkspace, git);
  const snapshots = useSnapshots(transport, desktop.snapshots);
  const focusQueue = useRef(Promise.resolve());
  const [layout, dispatch] = useReducer(layoutReducer, initialLayout);
  const [projectId, setProjectId] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [contextTarget, setContextTarget] = useState<string | null>(null);
  const [launcher, setLauncher] = useState<LauncherTarget>(null);
  const [settingsStartPage, setSettingsStartPage] = useState<'General' | 'Snapshots'>('General');
  const [settingsMode, setSettingsMode] = useState<'dedicated' | null>(null);
  const [newChats, setNewChats] = useState<Record<string, ChatDraft>>({});
  /** Model, effort or provider options chosen since a session's last Send. */
  const [pendingOptions, setPendingOptions] = useState<Record<string, Record<string, string>>>({});
  const [context, setContext] = useState<Record<string, ContextItem[]>>({});
  /** Expanded folders per file-browser resource, outside any pane's lifetime. */
  const [treeExpansion, setTreeExpansion] = useState<Record<string, string[]>>({});
  const [iconTheme, setIconTheme] = useFileIconThemeChoice();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [idleThreadDays, setIdleThreadDays] = useIdleThreadDays();
  const [streamReplies, setStreamReplies] = useStreamReplies();
  const [timeFormat, setTimeFormat] = useTimeFormat();
  /**
   * Projects whose threads the sidebar lists. Any number can be open at once;
   * until the reader toggles one, the current project is shown open.
   */
  const [expandedProjects, setExpandedProjects] = useState<string[] | undefined>(undefined);
  const [previewContext, setPreviewContext] = useState<ContextItem | null>(null);
  /** Annotations stacked in each browser, held until staged or cleared. */
  const [browserAnnotations, setBrowserAnnotations] = useState<Record<string, BrowserAnnotation[]>>(
    {},
  );
  /** The conversation a browser annotation stages into when none is beside it. */
  const lastConversation = useRef<string | null>(null);
  /** Pages a Browser opened from a Markdown link should load once attached. */
  const [browserUrls, setBrowserUrls] = useState<Record<string, string>>({});
  /** Lines a chat linked to, per File resource: view state, not a record. */
  const [fileReveals, setFileReveals] = useState<Record<string, { line: number; key: number }>>({});
  /** Live terminals the launcher offers to reopen; read when it opens. */
  const [runningTerminals, setRunningTerminals] = useState<TerminalSession[]>([]);
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

  const conversationFocus = workspace ? snapshotFocus(layout, workspace.resources) : null;
  useEffect(() => {
    if (!conversationFocus) return;
    lastConversation.current = conversationFocus;
    if (desktop.snapshots) {
      focusQueue.current = focusQueue.current
        .then(async () => {
          await transport.request('snapshot.focus', { resourceId: conversationFocus });
        })
        .catch(client.reportError);
    }
  }, [conversationFocus, desktop.snapshots, transport, client]);

  useEffect(() => {
    if (!desktop.snapshots) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void desktop.snapshots
      .onOpen((id) => {
        void transport
          .request('snapshot.list', {})
          .then(({ snapshots: records }) => {
            if (disposed) return;
            const target = records.find((s) => s.id === id)?.resourceId;
            if (target) {
              setSettingsMode(null);
              dispatch({ type: 'openTab', resourceId: target });
            } else {
              setSettingsStartPage('Snapshots');
              setSettingsMode('dedicated');
            }
          })
          .catch(client.reportError);
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(client.reportError);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [desktop.snapshots, transport, client]);

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

  /**
   * A new chat is an unsaved draft until its first explicit Send. It starts
   * with the requested agent when that is enabled, else the default one.
   */
  const newChat = useCallback(
    (requested?: ProviderId, paneId?: string) => {
      if (!projectId) return;
      const id = `draft:${crypto.randomUUID()}`;
      const providers = client.getSnapshot().workspace?.providers ?? [];
      const providerId = draftProvider(providers, requested);
      const provider = providers.find((item) => item.id === providerId);
      setNewChats((current) => ({
        ...current,
        [id]: {
          projectId,
          providerId,
          presentation: presentationFor(providerId, requested === 'codex' ? 'codex' : 'claude'),
          options: withoutStaleChoices(provider, { ...provider?.defaults }),
        },
      }));
      // The agent picker needs real installation and sign-in state.
      void client.ensureProviders();
      if (paneId) assignPane(id, paneId);
      else dispatch({ type: 'openTab', resourceId: id });
      setOverlay(null);
      setLauncher(null);
      setSettingsMode(null);
    },
    [assignPane, projectId, client],
  );

  /**
   * The runtime owns resource identity: reopening a target reuses its record.
   * A terminal is the exception: every Terminal choice is a new shell.
   */
  const openKind = useCallback(
    async (kind: OpenableKind, path?: string, paneId?: string, inProject?: string) => {
      const target = inProject ?? projectId;
      if (!target) return;
      try {
        const { resource } =
          kind === 'terminal'
            ? await transport.request('terminal.create', {
                projectId: target,
                // Start the shell at the size of the pane it will appear in.
                ...estimateTerminalSize(
                  document.querySelector(paneId ? `[data-pane-id="${paneId}"]` : '.workspace'),
                ),
              })
            : await transport.request('resource.open', {
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

  /**
   * A web link in a Markdown preview opens in a new Browser resource, the
   * isolated native view, never in JAM's own window.
   */
  const openUrl = useCallback(
    async (url: string, inProject?: string) => {
      const target = inProject ?? projectId;
      if (!target) return;
      try {
        const { resource } = await transport.request('resource.open', {
          projectId: target,
          kind: 'browser',
        });
        client.addResource(resource);
        setBrowserUrls((current) => ({ ...current, [resource.id]: url }));
        openResource(resource.id);
      } catch (cause) {
        client.reportError(cause);
      }
    },
    [client, openResource, projectId, transport],
  );

  const launcherOpen = launcher !== null;
  useEffect(() => {
    if (!launcherOpen || !projectId) return;
    let current = true;
    transport.request('terminal.list', { projectId }).then(
      ({ terminals }) => {
        if (current) setRunningTerminals(terminals.filter((item) => item.status === 'running'));
      },
      () => {
        if (current) setRunningTerminals([]);
      },
    );
    return () => {
      current = false;
    };
  }, [launcherOpen, projectId, transport]);

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
  const placeBeside = useCallback(
    (resourceId: string, fromPaneId: string | null, kind: 'file' | 'browser') => {
      const current = layoutRef.current;
      const tree = activeTree(current);
      const browserPane = fromPaneId ?? focusedPane(current)?.id;
      const others = leaves(tree).filter((pane) => pane.id !== browserPane);
      const kindOf = (id: string | null) =>
        client.getSnapshot().workspace?.resources.find((item) => item.id === id)?.kind;
      const editorPane =
        others.find((pane) => kindOf(pane.resourceId) === kind) ??
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
        // A chat or a diff keeps half the width; a browser keeps the Files
        // frame's proportion.
        ratio: ['diff', 'conversation'].includes(
          kindOf(findLeaf(tree, browserPane ?? '')?.resourceId ?? null) ?? '',
        )
          ? 0.5
          : browserRatio(browserPane),
      });
    },
    [assignPane, client],
  );

  /** A file a chat or preview linked to, beside it, at `line` when given. */
  const openFileFrom = useCallback(
    async (path: string, fromPaneId: string | null, inProject?: string, line?: number) => {
      const target = inProject ?? projectId;
      if (!target) return;
      try {
        const { resource } = await transport.request('resource.open', {
          projectId: target,
          kind: 'file',
          path,
        });
        client.addResource(resource);
        if (line)
          setFileReveals((current) => ({ ...current, [resource.id]: { line, key: Date.now() } }));
        placeBeside(resource.id, fromPaneId, 'file');
      } catch (cause) {
        client.reportError(cause);
      }
    },
    [client, placeBeside, projectId, transport],
  );

  /** A local server a chat started, in a JAM browser beside the chat. */
  const openPreviewFrom = useCallback(
    async (url: string, fromPaneId: string | null, inProject?: string) => {
      const target = inProject ?? projectId;
      if (!target) return;
      // A preview already beside the chat goes to the new address rather
      // than gaining a second, blank page.
      const beside = leaves(activeTree(layoutRef.current)).find(
        (pane) =>
          pane.id !== fromPaneId &&
          client.getSnapshot().workspace?.resources.find((item) => item.id === pane.resourceId)
            ?.kind === 'browser',
      );
      const parsed = parseAddress(url);
      if (beside?.resourceId && desktop.browser && 'url' in parsed) {
        void desktop.browser.navigate(beside.resourceId, parsed.url).catch(client.reportError);
        return;
      }
      try {
        const { resource } = await transport.request('resource.open', {
          projectId: target,
          kind: 'browser',
        });
        client.addResource(resource);
        setBrowserUrls((current) => ({ ...current, [resource.id]: url }));
        placeBeside(resource.id, fromPaneId, 'browser');
      } catch (cause) {
        client.reportError(cause);
      }
    },
    [client, desktop.browser, placeBeside, projectId, transport],
  );

  /** Right-click on a file a chat named. */
  const fileMenu = useCallback(
    (
      file: FileReference,
      event: React.MouseEvent,
      fromPaneId: string | null,
      inProject?: string,
    ) => {
      const target = inProject ?? projectId;
      setContextMenu({
        ...menuPoint(event),
        items: [
          {
            label: 'Open beside',
            hint: 'Click',
            onSelect: () => void openFileFrom(file.path, fromPaneId, target, file.line),
          },
          {
            label: 'Open in new tab',
            onSelect: () => void openKind('file', file.path, undefined, target),
          },
          {
            label: desktop.platform === 'windows' ? 'Show in Explorer' : 'Reveal in Finder',
            separated: true,
            onSelect: () => {
              if (target)
                void transport
                  .request('file.reveal', { projectId: target, path: file.path })
                  .catch(client.reportError);
            },
          },
          {
            label: 'Copy path',
            onSelect: () => void navigator.clipboard?.writeText(file.path).catch(() => {}),
          },
        ],
      });
    },
    [client, desktop.platform, openFileFrom, openKind, projectId, transport],
  );

  const openSettings = useCallback(() => {
    setSettingsStartPage('General');
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
        if (!overlay && !launcher) newChat(event.shiftKey ? 'codex' : undefined);
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

  function contextFor(resourceId: string) {
    return [
      ...(context[resourceId] ?? emptyContext),
      ...snapshots.snapshots.filter((s) => s.resourceId === resourceId).map((s) => s.context),
    ];
  }
  async function send(sendId: string) {
    const text = layout.drafts[sendId] ?? '';
    const staged = contextFor(sendId);
    if (staged.length > 16) {
      client.reportError(
        new Error(
          'Send at most 16 context items at once. Remove some snapshots to the inbox first.',
        ),
      );
      return;
    }
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
          providerId: draft.providerId,
          ...(draft.providerId !== 'mock' && Object.keys(draft.options).length
            ? { options: draft.options }
            : {}),
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
      // Choices made since the last Send apply from this turn on.
      const options = draft ? undefined : pendingOptions[resourceId];
      const payload = JSON.stringify({ text, context: staged, options });
      const previous = requests.current.get(resourceId);
      const requestId = previous?.payload === payload ? previous.requestId : crypto.randomUUID();
      requests.current.set(resourceId, { payload, requestId });
      await transport.request('turn.start', {
        resourceId,
        text,
        context: staged,
        requestId,
        // Complete options, so a choice returned to its default is cleared.
        ...(options ? { options } : {}),
      });
      snapshots.refresh();
      requests.current.delete(resourceId);
      setPendingOptions((current) => {
        if (!current[resourceId]) return current;
        const rest = { ...current };
        delete rest[resourceId];
        return rest;
      });
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

  const providerControl = {
    ensure: () => client.ensureProviders(),
    refresh: () => client.refreshProviders(),
    configure: async (changes: RequestMap['provider.configure']['params']) => {
      try {
        const { providers } = await transport.request('provider.configure', changes);
        client.updateProviders(providers);
      } catch (cause) {
        client.reportError(cause);
      }
    },
  };

  const optionsFor = (resourceId: string, sessionId?: string) => {
    const draft = newChats[resourceId];
    if (draft) return draft.options;
    const session = workspace?.sessions.find((item) => item.id === sessionId);
    return { ...session?.options, ...pendingOptions[resourceId] };
  };

  const composerFor = (resourceId: string, sessionId?: string) => ({
    draft: layout.drafts[resourceId] ?? '',
    context: contextFor(resourceId),
    snapshotTransport: desktop.snapshots ? transport : undefined,
    busy: busy.has(resourceId),
    shortcut,
    providers: workspace?.providers ?? [],
    options: optionsFor(resourceId, sessionId),
    streamReplies,
    timeFormat,
    onCompact: async () => {
      try {
        await transport.request('session.compact', {
          resourceId,
          requestId: crypto.randomUUID(),
        });
      } catch (cause) {
        client.reportError(cause);
      }
    },
    onFavoriteModel: (providerId: ProviderId, model: string) => {
      const provider = workspace?.providers.find((item) => item.id === providerId);
      if (provider)
        void providerControl.configure({
          providerId,
          favoriteModels: toggledFavorite(provider.favoriteModels, model),
        });
    },
    onOptions: (options: Record<string, string>) => {
      // The access level a person picks becomes their agent's default for new chats.
      const providerId =
        newChats[resourceId]?.providerId ??
        workspace?.sessions.find((item) => item.id === sessionId)?.providerId;
      const provider = workspace?.providers.find((item) => item.id === providerId);
      const access = options.access;
      if (
        provider &&
        provider.id !== 'mock' &&
        access &&
        access !== optionsFor(resourceId, sessionId).access &&
        access !== provider.defaults?.access
      )
        void providerControl.configure({
          providerId: provider.id,
          defaults: { ...provider.defaults, access },
        });
      if (newChats[resourceId])
        setNewChats((current) => {
          const draft = current[resourceId];
          return draft ? { ...current, [resourceId]: { ...draft, options } } : current;
        });
      else setPendingOptions((current) => ({ ...current, [resourceId]: options }));
    },
    onRespond: async (interactionId: string, answer: InteractionAnswer) => {
      try {
        await transport.request('interaction.respond', {
          resourceId,
          interactionId,
          ...answer,
        });
      } catch (cause) {
        client.reportError(cause);
      }
    },
    onDraft: (text: string) => dispatch({ type: 'draft', resourceId, text }),
    onSend: () => void send(resourceId),
    onStop: () => {
      if (sessionId)
        void transport.request('turn.interrupt', { sessionId }).catch(client.reportError);
    },
    onAddContext: () => setContextTarget(resourceId),
    onPreviewContext: setPreviewContext,
    onRemoveContext: (id: string) => {
      const snapshot = snapshots.snapshots.find((s) => s.id === id);
      if (snapshot) {
        void transport
          .request('snapshot.stage', { id, resourceId: null, note: snapshot.note })
          .then(snapshots.refresh)
          .catch(client.reportError);
        return;
      }
      setContext((current) => ({
        ...current,
        [resourceId]: (current[resourceId] ?? emptyContext).filter((item) => item.id !== id),
      }));
    },
    onOpenReview: () => void openKind('diff'),
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
      key={settingsStartPage}
      initialPage={settingsStartPage}
      transport={transport}
      providers={workspace.providers}
      providerControl={providerControl}
      projects={workspace.projects}
      onUpdateProject={updateProject}
      dedicated={dedicated}
      desktop={desktop}
      idleThreadDays={idleThreadDays}
      onIdleThreadDays={setIdleThreadDays}
      streamReplies={streamReplies}
      onStreamReplies={setStreamReplies}
      timeFormat={timeFormat}
      onTimeFormat={setTimeFormat}
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

  /**
   * Where a browser annotation is staged: a conversation beside the browser in
   * this tab, else the conversation used most recently. Staging never sends.
   */
  const browserDestination = () => {
    const conversations = workspace.resources.filter((item) => item.kind === 'conversation');
    const focused = focusedPane(layout)?.resourceId;
    const beside =
      conversations.find((item) => item.id === focused) ??
      conversations.find((item) => paneResourceIds.includes(item.id));
    return beside ?? conversations.find((item) => item.id === lastConversation.current);
  };

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
            providerId={draft.providerId}
            sessionOf={(item) =>
              workspace.sessions.find((session) => session.id === item.sessionId)
            }
            composer={
              <Composer
                {...composerFor(resourceId)}
                project={draftProject}
                providerId={draft.providerId}
                presentation={draft.presentation}
                onProvider={(providerId) =>
                  setNewChats((current) => {
                    const previous = current[resourceId];
                    if (!previous) return current;
                    const provider = workspace.providers.find((item) => item.id === providerId);
                    return {
                      ...current,
                      [resourceId]: {
                        ...previous,
                        providerId,
                        presentation: presentationFor(providerId, previous.presentation),
                        // Options belong to one provider; switching starts from its defaults.
                        options: withoutStaleChoices(provider, { ...provider?.defaults }),
                      },
                    };
                  })
                }
                isNew
              />
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
            composer={{
              ...composerFor(resource.id, session?.id),
              onOpenUrl: (url: string) => void openPreviewFrom(url, paneId, resource.projectId),
              onOpenFile: (path: string, line?: number) =>
                void openFileFrom(path, paneId, resource.projectId, line),
              onFileMenu: (file: FileReference, event: React.MouseEvent) =>
                fileMenu(file, event, paneId, resource.projectId),
              ...(desktop.platform !== 'web' && {
                onOpenExternal: (url: string) =>
                  void transport.request('url.openExternal', { url }).catch(client.reportError),
              }),
            }}
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
            onOpenUrl={(url) => void openUrl(url, resource.projectId)}
            onOpenFile={(path) => void openKind('file', path, undefined, resource.projectId)}
            reveal={fileReveals[resource.id]}
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
      case 'browser': {
        const target = browserDestination();
        const annotations = browserAnnotations[resource.id] ?? emptyAnnotations;
        const setAnnotations = (next: BrowserAnnotation[]) =>
          setBrowserAnnotations((current) => ({ ...current, [resource.id]: next }));
        const browserChrome = {
          ...chrome,
          menu: [
            ...chrome.menu,
            {
              label: 'Close browser page',
              danger: true,
              // The explicit lifecycle command: the page and its process end.
              // The resource stays, and opens blank next time.
              onSelect: desktop.browser
                ? () => void desktop.browser?.close(resource.id).catch(client.reportError)
                : undefined,
              unavailable: desktop.browser ? undefined : 'No page is open in this preview.',
            },
          ],
        };
        return (
          <BrowserResource
            key={resource.id}
            chrome={browserChrome}
            resource={resource}
            host={desktop.browser}
            initialUrl={browserUrls[resource.id]}
            onInitialUrlUsed={() =>
              setBrowserUrls((current) => {
                const rest = { ...current };
                delete rest[resource.id];
                return rest;
              })
            }
            annotations={annotations}
            destination={target?.title}
            onAnnotated={(annotation) =>
              setBrowserAnnotations((current) => ({
                ...current,
                [resource.id]: [...(current[resource.id] ?? emptyAnnotations), annotation].slice(
                  0,
                  16,
                ),
              }))
            }
            onClearAnnotations={() => setAnnotations(emptyAnnotations)}
            onStageAnnotations={() => {
              if (!target) return;
              // Staged, not sent: each annotation becomes one context chip in
              // the conversation, carrying its comment and page details.
              const items: ContextItem[] = annotations.map((annotation) => ({
                id: crypto.randomUUID(),
                kind: annotation.kind === 'region' ? 'browser-region' : 'browser-element',
                label: `${annotation.comment ? `“${annotation.comment}” · ` : ''}${
                  annotation.label
                } · ${hostOf(annotation.url)}`.slice(0, 512),
                source: {
                  resourceId: resource.id,
                  uri: annotation.url.slice(0, 4096),
                  selection: describeAnnotation(annotation),
                },
              }));
              setContext((current) => ({
                ...current,
                [target.id]: [...(current[target.id] ?? emptyContext), ...items].slice(0, 16),
              }));
              setAnnotations(emptyAnnotations);
            }}
            onError={client.reportError}
          />
        );
      }
      case 'terminal':
        return (
          <TerminalResource
            {...chrome}
            transport={transport}
            resource={resource}
            project={workspace.projects.find((item) => item.id === resource.projectId)}
            mac={usesCommand}
          />
        );
      case 'diff':
        return (
          <Suspense fallback={<section className="pane empty-surface">Loading review…</section>}>
            <ReviewResource
              key={resource.id}
              git={git}
              resource={resource}
              chrome={chrome}
              onOpenFile={(path) => void openFileFrom(path, paneId, resource.projectId)}
            />
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
    <AppearanceContext.Provider value={appearance}>
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
                  terminals={runningTerminals.map((item) => ({
                    id: item.resourceId,
                    label: item.title,
                    // The last two folders are enough to tell shells apart.
                    detail: item.cwdLabel.split(/[\\/]/).slice(-2).join('/'),
                  }))}
                  onOpenTerminal={(resourceId) =>
                    launcher.paneId
                      ? assignPane(resourceId, launcher.paneId)
                      : openResource(resourceId)
                  }
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
              Stage a demo file reference. Press Send to include it in the mock transcript. No file
              is read.
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
            <p>Native file context is planned. Snapshots can be captured in the desktop app.</p>
          </Dialog>
        )}
        {previewContext?.kind === 'snapshot' && (
          <Dialog
            title="Snapshot preview"
            className="context-dialog snapshot-preview-dialog"
            onClose={() => setPreviewContext(null)}
          >
            <SnapshotPreview
              item={previewContext}
              snapshot={snapshots.snapshots.find((item) => item.id === previewContext.assetId)}
              transport={transport}
              onClose={() => setPreviewContext(null)}
            />
          </Dialog>
        )}
        {previewContext && previewContext.kind !== 'snapshot' && (
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
    </AppearanceContext.Provider>
  );
}
