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
  Project,
  ProjectIcon,
  ProviderId,
  RequestMap,
  TerminalSession,
} from '@jam/protocol';
import {
  type ChatDraft,
  type DraftWorkspace,
  draftProvider,
  inProject,
  presentationFor,
  workspaceProblem,
  workspaceRequest,
} from './state/chat-draft';
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
import {
  attentionBadge,
  useChatAttention,
  useWindowFocused,
  type BadgeTone,
} from './state/chat-activity';
import { useNotificationPrefs } from './state/notification-prefs';
import { playSound } from './components/sounds';
import { badgeIconSize, drawBadge, trayBadgeSize } from './components/attention-badge';
import { commandFor, useKeybindings, useShortcutHint } from './state/keybindings';
import {
  terminalSplit,
  useTerminalPlacement,
  type TerminalPlacement,
} from './state/terminal-placement';
import { chordFromEvent } from './components/settings/keybindings-data';
import {
  type NewThreadWorkspace,
  useIdleThreadDays,
  useNewThreadWorkspace,
  useStreamReplies,
  useTimeFormat,
} from './state/preferences';
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
import { DraftWorkspacePicker } from './components/NewChatTarget';
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
import { FirstRun } from './components/FirstRun';
import { AgentSetup } from './components/AgentSetup';
import { isAgentReady } from './components/agent-setup-model';
import { buildFacts, diagnosticsText } from './components/settings/system-info';
import { withSharedDefault } from './components/settings/general-model';
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

/** A new chat's workspace from the Settings choice; "Ask each time" leaves it open. */
function startingWorkspace(choice: NewThreadWorkspace): DraftWorkspace {
  return choice === 'ask' ? {} : { kind: choice };
}

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
  const [settingsStartPage, setSettingsStartPage] = useState<'General' | 'Snapshots' | 'Providers'>(
    'General',
  );
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
  /** A re-check the "no agent ready" screen asked for is running. */
  const [checkingAgents, setCheckingAgents] = useState(false);
  const [idleThreadDays, setIdleThreadDays] = useIdleThreadDays();
  const [streamReplies, setStreamReplies] = useStreamReplies();
  const [timeFormat, setTimeFormat] = useTimeFormat();
  const [newThreadWorkspace, setNewThreadWorkspace] = useNewThreadWorkspace();
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
  const { overrides: keybindings } = useKeybindings(usesCommand);
  const [terminalPlacement] = useTerminalPlacement();
  const closeTabHint = useShortcutHint('close-tab', usesCommand);
  const reopenHint = useShortcutHint('reopen-tab', usesCommand);

  const activeTabId = layout.activeTabId;
  const activeId = activeResourceId(layout);
  // A chat counts as seen while any pane of the current tab shows it.
  const visibleSessionIds = leaves(activeTree(layout)).flatMap((pane) => {
    const sessionId = workspace?.resources.find((item) => item.id === pane.resourceId)?.sessionId;
    return sessionId ? [sessionId] : [];
  });
  const [notifications] = useNotificationPrefs();
  // Seen means on screen while JAM is the window in use; away, every chat can want you.
  const windowFocused = useWindowFocused();
  const seenSessionIds = windowFocused ? visibleSessionIds : [];
  const attention = useChatAttention(workspace?.sessions, seenSessionIds, (event, session) => {
    // Sounds and notifications are for when you are somewhere else.
    if (document.hasFocus()) return;
    if (notifications.sound && event !== 'error') playSound(notifications.soundId);
    if (notifications.system && desktop.notify) {
      const title =
        workspace?.resources.find((item) => item.sessionId === session.id)?.title ?? 'A chat';
      const body =
        event === 'finished'
          ? 'The agent finished.'
          : event === 'input'
            ? 'The agent needs your input.'
            : 'The agent hit an error.';
      void desktop.notify({ title, body }).catch(() => {});
    }
  });
  const finishedSessions = attention.finished;
  const badge =
    notifications.badge && workspace ? attentionBadge(workspace.sessions, attention) : null;
  const badgeKey = badge ? `${badge.count}:${badge.tone}` : '';
  useEffect(() => {
    if (!desktop.setAttentionBadge) return;
    const [count, tone] = badgeKey.split(':');
    const size = badgeIconSize();
    // The taskbar dot fills most of its slot; the tray's sits in the icon's corner.
    const overlay = badgeKey ? drawBadge(tone as BadgeTone, size, 0.7) : null;
    const tray = badgeKey ? drawBadge(tone as BadgeTone, trayBadgeSize(size)) : null;
    void desktop
      .setAttentionBadge(overlay && tray ? { count: Number(count), size, overlay, tray } : null)
      .catch(() => {});
  }, [badgeKey, desktop]);
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
    (requested?: ProviderId, paneId?: string, inProject = projectId) => {
      const projectId = inProject;
      if (!projectId) return;
      setProjectId(projectId);
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
          workspace: startingWorkspace(newThreadWorkspace),
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
    [assignPane, projectId, client, newThreadWorkspace],
  );

  /**
   * The runtime owns resource identity: reopening a target reuses its record.
   * A terminal is the exception: every Terminal choice is a new shell.
   */
  const openKind = useCallback(
    async (
      kind: OpenableKind,
      path?: string,
      paneId?: string,
      inProject?: string,
      worktreeId?: string,
    ) => {
      const target = inProject ?? projectId;
      if (!target) return;
      // A browser is a web page; it has no folder to work in.
      const inWorktree = worktreeId && kind !== 'browser' ? { worktreeId } : {};
      try {
        const { resource } =
          kind === 'terminal'
            ? await transport.request('terminal.create', {
                projectId: target,
                ...inWorktree,
                // Start the shell at the size of the pane it will appear in.
                ...estimateTerminalSize(
                  document.querySelector(paneId ? `[data-pane-id="${paneId}"]` : '.workspace'),
                ),
              })
            : await transport.request('resource.open', {
                projectId: target,
                kind,
                ...(path === undefined ? {} : { path }),
                ...inWorktree,
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

  /**
   * The worktree of the active tab's own resource. A pane filled inside a
   * worktree chat's tab belongs to that chat's workspace, so it works there.
   */
  const tabWorktree = () => {
    const current = layoutRef.current;
    const tab = current.tabs.find((item) => item.id === current.activeTabId);
    return client.getSnapshot().workspace?.resources.find((item) => item.id === tab?.resourceId)
      ?.worktreeId;
  };

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
  /** The tab just closed, offered back for a few seconds. */
  const [closedNotice, setClosedNotice] = useState<{ title: string; key: number } | null>(null);
  const closeTab = useCallback(
    (tabId: string) => {
      const tab = layoutRef.current.tabs.find((item) => item.id === tabId);
      const resource = client
        .getSnapshot()
        .workspace?.resources.find((item) => item.id === tab?.resourceId);
      dispatch({ type: 'closeTab', tabId });
      if (tab) setClosedNotice({ title: resource?.title ?? 'New chat', key: Date.now() });
    },
    [client],
  );
  /**
   * A middle click closes a tab at once, unless closing it deserves a look:
   * a terminal, or a chat whose agent is working or waiting for you. That tab
   * comes forward and asks first. Closing never stops either.
   */
  const [confirmClose, setConfirmClose] = useState<{
    tabId: string;
    title: string;
    reason: 'terminal' | 'working' | 'waiting';
  } | null>(null);
  const middleCloseTab = useCallback(
    (tabId: string) => {
      const tab = layoutRef.current.tabs.find((item) => item.id === tabId);
      const snapshot = client.getSnapshot().workspace;
      const resource = snapshot?.resources.find((item) => item.id === tab?.resourceId);
      const session = snapshot?.sessions.find((item) => item.id === resource?.sessionId);
      const reason =
        resource?.kind === 'terminal'
          ? 'terminal'
          : session?.needsInput
            ? 'waiting'
            : session?.status === 'running'
              ? 'working'
              : null;
      if (!tab || !resource || !reason) {
        closeTab(tabId);
        return;
      }
      dispatch({ type: 'openTab', resourceId: resource.id });
      setConfirmClose({ tabId, title: resource.title, reason });
    },
    [client, closeTab],
  );
  const reopenTab = useCallback(() => {
    dispatch({ type: 'reopenTab' });
    setClosedNotice(null);
    setSettingsMode(null);
  }, []);
  useEffect(() => {
    if (!closedNotice) return;
    const timer = window.setTimeout(() => setClosedNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [closedNotice]);

  // Which projects show their threads is yours: it starts with the first
  // project and then changes only from its row, never from opening a chat.
  useEffect(() => {
    if (expandedProjects === undefined && projectId) setExpandedProjects([projectId]);
  }, [expandedProjects, projectId]);

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
   * Add project: the operating system's folder chooser, then the runtime
   * checks the folder and records it. A folder JAM already knows returns its
   * project, restored with its history if it had been removed.
   */
  /** Settles the open New project dialog's caller: the project, or null. */
  const newProjectDone = useRef<((project: Project | null) => void) | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const addProject = useCallback((): Promise<Project | null> => {
    if (!desktop.pickDirectory) return Promise.resolve(null);
    newProjectDone.current?.(null);
    setCreatingProject(true);
    return new Promise((resolve) => {
      newProjectDone.current = resolve;
    });
  }, [desktop]);
  const closeNewProject = useCallback((project: Project | null) => {
    setCreatingProject(false);
    newProjectDone.current?.(project);
    newProjectDone.current = null;
  }, []);
  /** Errors stay in the dialog, beside the button that asked. */
  const createProject = useCallback(
    async (changes: { name: string; paths: string[]; icon: ProjectIcon }) => {
      const { project } = await transport.request('project.create', changes);
      await client.reload();
      setProjectId(project.id);
      setExpandedProjects((current) =>
        current && !current.includes(project.id) ? [...current, project.id] : current,
      );
      closeNewProject(project);
    },
    [client, closeNewProject, transport],
  );

  /** Forgets a project; its folder and history stay where they are. */
  const removeProject = useCallback(
    async (id: string) => {
      // Errors surface in Settings, beside the button that asked.
      await transport.request('project.remove', { projectId: id });
      const current = client.getSnapshot().workspace;
      const gone = new Set(
        current?.resources.filter((item) => item.projectId === id).map((item) => item.id),
      );
      for (const tab of layoutRef.current.tabs) {
        if (gone.has(tab.resourceId) || newChats[tab.resourceId]?.projectId === id)
          dispatch({ type: 'closeTab', tabId: tab.id });
      }
      setNewChats((drafts) =>
        Object.fromEntries(Object.entries(drafts).filter(([, draft]) => draft.projectId !== id)),
      );
      await client.reload();
      const remaining = client.getSnapshot().workspace?.projects ?? [];
      setProjectId((selected) =>
        selected === id || !remaining.some((item) => item.id === selected)
          ? (remaining[0]?.id ?? '')
          : selected,
      );
    },
    [client, newChats, transport],
  );

  const projectControl = {
    ...(desktop.pickDirectory
      ? {
          add: addProject,
          pickFolder: (start?: string) => desktop.pickDirectory!(start),
        }
      : {}),
    remove: removeProject,
  };

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
    async (
      path: string,
      fromPaneId: string | null,
      inProject?: string,
      line?: number,
      worktreeId?: string,
    ) => {
      const target = inProject ?? projectId;
      if (!target) return;
      try {
        const { resource } = await transport.request('resource.open', {
          projectId: target,
          kind: 'file',
          path,
          ...(worktreeId ? { worktreeId } : {}),
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
      worktreeId?: string,
    ) => {
      const target = inProject ?? projectId;
      setContextMenu({
        ...menuPoint(event),
        items: [
          {
            label: 'Open beside',
            hint: 'Click',
            onSelect: () => void openFileFrom(file.path, fromPaneId, target, file.line, worktreeId),
          },
          {
            label: 'Open in new tab',
            onSelect: () => void openKind('file', file.path, undefined, target, worktreeId),
          },
          {
            label: desktop.platform === 'windows' ? 'Show in Explorer' : 'Reveal in Finder',
            separated: true,
            onSelect: () => {
              if (target)
                void transport
                  .request('file.reveal', {
                    projectId: target,
                    path: file.path,
                    ...(worktreeId ? { worktreeId } : {}),
                  })
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

  /** Provider detection, for the first-run screen that shows it. */
  const checkProviders = useCallback(() => void client.ensureProviders(), [client]);

  const openSettings = useCallback(() => {
    setSettingsStartPage('General');
    setSettingsMode('dedicated');
    setOverlay(null);
    setLauncher(null);
  }, []);

  /** Splitting applies to the current tab's own arrangement. */
  /** A new terminal beside the pane you're in, or in its own tab. */
  const openTerminalAt = useCallback(
    (placement: TerminalPlacement) => {
      const split = terminalSplit(placement);
      if (!layoutRef.current.activeTabId || !split) {
        void openKind('terminal');
        return;
      }
      const paneId = newPaneId();
      dispatch({ type: 'mode', mode: 'tiles' });
      dispatch({ type: 'split', ...split, splitId: newSplitId(), newPaneId: paneId });
      void openKind('terminal', undefined, paneId);
    },
    [openKind],
  );

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
      // JAM's own commands run by chord, as bound in Settings → Keybindings.
      const chord = chordFromEvent(event, usesCommand);
      const command = chord ? commandFor(chord, keybindings, usesCommand) : null;
      if (!command) return;
      event.preventDefault();
      const busy = Boolean(overlay || launcher);
      if (command.startsWith('terminal-')) {
        if (!busy && !settingsMode)
          openTerminalAt(command.slice('terminal-'.length) as TerminalPlacement);
        return;
      }
      switch (command) {
        case 'search':
          setOverlay('search');
          break;
        case 'new-chat':
          if (!busy) newChat();
          break;
        case 'new-chat-codex':
          if (!busy) newChat('codex');
          break;
        case 'open-terminal': {
          if (busy || settingsMode) break;
          // A tab that already shows a terminal focuses it; otherwise one opens
          // where Settings → Terminal says.
          const resources = client.getSnapshot().workspace?.resources ?? [];
          const shown = leaves(activeTree(layoutRef.current)).find(
            (pane) => resources.find((item) => item.id === pane.resourceId)?.kind === 'terminal',
          );
          if (shown) {
            dispatch({ type: 'focusPane', paneId: shown.id });
            // Focusing the pane is layout state; typing needs the terminal's own input.
            document
              .querySelector<HTMLElement>(`[data-pane-id="${shown.id}"] .xterm-helper-textarea`)
              ?.focus();
          } else openTerminalAt(terminalPlacement);
          break;
        }
        case 'new-tab':
          // The keyboard path hangs from the tab strip's own new-tab button.
          setLauncher({ anchor: anchorOf(document.querySelector('.new-resource')) });
          break;
        case 'reopen-tab':
          if (!busy && !settingsMode) reopenTab();
          break;
        case 'settings':
          openSettings();
          break;
        case 'focus':
          dispatch({ type: 'focus' });
          break;
        case 'close-tab':
          if (activeTabId && !busy && !settingsMode) closeTab(activeTabId);
          break;
        case 'split-right':
          if (!busy && !settingsMode) splitPane('row');
          break;
        case 'split-down':
          if (!busy && !settingsMode) splitPane('column');
          break;
        case 'close-pane': {
          // Only a split tab has a pane to close; the last one closes with its tab.
          const pane = focusedPane(layoutRef.current);
          if (pane && !busy && !settingsMode && leaves(activeTree(layoutRef.current)).length > 1)
            dispatch({ type: 'closePane', paneId: pane.id });
          break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    activeTabId,
    client,
    closeTab,
    keybindings,
    openTerminalAt,
    terminalPlacement,
    reopenTab,
    splitPane,
    usesCommand,
    launcher,
    layout.focus,
    newChat,
    openKind,
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
  /** The same request ID for an unchanged retry, so the runtime never does it twice. */
  function requestIdFor(key: string, payload: string) {
    const previous = requests.current.get(key);
    const requestId = previous?.payload === payload ? previous.requestId : crypto.randomUUID();
    requests.current.set(key, { payload, requestId });
    return requestId;
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
        const real = draft.providerId !== 'mock';
        const problem = real ? workspaceProblem(draft.workspace) : null;
        if (problem) throw new Error(problem);
        const workspaceChoice = real ? workspaceRequest(draft.workspace, text) : undefined;
        const createParams = {
          projectId: draft.projectId,
          presentation: draft.presentation,
          providerId: draft.providerId,
          ...(real && Object.keys(draft.options).length ? { options: draft.options } : {}),
          ...(workspaceChoice ? { workspace: workspaceChoice } : {}),
        };
        // A retried Send reuses its request ID, so a worktree is made once.
        const createKey = `create:${sendId}`;
        const created = await transport.request('conversation.create', {
          ...createParams,
          requestId: requestIdFor(createKey, JSON.stringify(createParams)),
        });
        requests.current.delete(createKey);
        // The checkout is on another branch now; labels read it again.
        if (workspaceChoice?.kind === 'checkout') void git.refresh(draft.projectId);
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
      const requestId = requestIdFor(resourceId, payload);
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
      // The access level a person picks becomes the default for every agent's
      // new chats, the same setting as General → Default permissions.
      const providerId =
        newChats[resourceId]?.providerId ??
        workspace?.sessions.find((item) => item.id === sessionId)?.providerId;
      const access = options.access;
      if (
        providerId !== 'mock' &&
        access &&
        access !== optionsFor(resourceId, sessionId).access &&
        workspace
      )
        for (const change of withSharedDefault(workspace.providers, 'access', access))
          void providerControl.configure(change);
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
    onOpenReview: () => {
      const resource = workspace?.resources.find((item) => item.id === resourceId);
      void openKind('diff', undefined, undefined, resource?.projectId, resource?.worktreeId);
    },
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
      projectControl={projectControl}
      dedicated={dedicated}
      desktop={desktop}
      idleThreadDays={idleThreadDays}
      onIdleThreadDays={setIdleThreadDays}
      streamReplies={streamReplies}
      onStreamReplies={setStreamReplies}
      timeFormat={timeFormat}
      onTimeFormat={setTimeFormat}
      newThreadWorkspace={newThreadWorkspace}
      onNewThreadWorkspace={setNewThreadWorkspace}
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
        separated: true,
        shortcut: closeTabHint,
        description:
          tiled && paneCount > 1 ? `Closes all ${paneCount} panes in this tab` : 'Closes this tab',
      },
    ];
    return {
      focused: tiled ? focusedPane(layout)?.id === pane?.id : true,
      onSplitRight: () => splitPane('row', paneId ?? undefined),
      onSplitDown: () => splitPane('column', paneId ?? undefined),
      onExpand: () => dispatch({ type: 'focus' }),
      expandLabel: 'Focus this resource',
      ...(tiled && paneId && paneCount > 1
        ? { onClose: () => dispatch({ type: 'closePane', paneId }) }
        : {}),
      menu,
    };
  };

  /** Resource surfaces. The caller supplies chrome; surfaces never place panes. */
  const surfaceFor = (resourceId: string, paneId: string | null) => {
    const chrome = chromeFor(paneId);
    const draft = newChats[resourceId];
    if (draft) {
      const draftProject = workspace.projects.find((item) => item.id === draft.projectId);
      // Once the agents have been checked and none can run, the chat says
      // what to install or sign in to instead of offering a composer.
      const agents = workspace.providers.filter((item) => item.id !== 'mock');
      const noAgent =
        agents.some((item) => item.checkedAt) &&
        !workspace.providers.some((item) => item.id === 'mock' && item.enabled) &&
        !agents.some(isAgentReady);
      if (noAgent)
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
          >
            <AgentSetup
              providers={workspace.providers}
              platform={desktop.platform}
              checking={checkingAgents}
              onCheckAgain={() => {
                setCheckingAgents(true);
                void client.refreshProviders().finally(() => setCheckingAgents(false));
              }}
              onOpenTerminal={() =>
                void openKind('terminal', undefined, paneId ?? undefined, draft.projectId)
              }
              onSettings={() => {
                setSettingsStartPage('Providers');
                setSettingsMode('dedicated');
              }}
            />
          </PaneChrome>
        );
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
            projects={workspace.projects}
            onProject={(projectId) =>
              setNewChats((current) => {
                const previous = current[resourceId];
                return previous
                  ? { ...current, [resourceId]: inProject(previous, projectId) }
                  : current;
              })
            }
            {...(desktop.pickDirectory ? { onAddProject: addProject } : {})}
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
                target={
                  <DraftWorkspacePicker
                    key={draft.projectId}
                    transport={transport}
                    projectId={draft.projectId}
                    workspace={draft.workspace}
                    disabled={busy.has(resourceId)}
                    onChange={(next: DraftWorkspace) =>
                      setNewChats((current) => {
                        const previous = current[resourceId];
                        return previous
                          ? { ...current, [resourceId]: { ...previous, workspace: next } }
                          : current;
                      })
                    }
                  />
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
              worktree: workspace.worktrees.find((item) => item.id === resource.worktreeId),
              onOpenUrl: (url: string) => void openPreviewFrom(url, paneId, resource.projectId),
              onOpenFile: (path: string, line?: number) =>
                void openFileFrom(path, paneId, resource.projectId, line, resource.worktreeId),
              onFileMenu: (file: FileReference, event: React.MouseEvent) =>
                fileMenu(file, event, paneId, resource.projectId, resource.worktreeId),
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
            onOpenFile={(path) =>
              void openKind('file', path, undefined, resource.projectId, resource.worktreeId)
            }
            reveal={fileReveals[resource.id]}
          />
        );
      case 'file-browser':
        return (
          <FileBrowser
            {...chrome}
            transport={transport}
            project={workspace.projects.find((item) => item.id === resource.projectId)}
            {...(resource.worktreeId ? { worktreeId: resource.worktreeId } : {})}
            selectedPath={openFilePath}
            expanded={treeExpansion[resource.id] ?? emptyPaths}
            iconTheme={iconTheme}
            onIconTheme={setIconTheme}
            onExpandedChange={(next) =>
              setTreeExpansion((current) => ({ ...current, [resource.id]: next }))
            }
            onOpenFile={(path) =>
              void openFileFrom(path, paneId, resource.projectId, undefined, resource.worktreeId)
            }
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
              setBrowserAnnotations((current) => {
                const list = current[resource.id] ?? emptyAnnotations;
                // An edited annotation comes back under the number it had.
                const at = list.findIndex(
                  (item) => item.index !== undefined && item.index === annotation.index,
                );
                const next =
                  at >= 0
                    ? list.map((item, i) => (i === at ? annotation : item))
                    : [...list, annotation].slice(0, 16);
                return { ...current, [resource.id]: next };
              })
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
              onOpenFile={(path) =>
                void openFileFrom(path, paneId, resource.projectId, undefined, resource.worktreeId)
              }
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
                finishedSessions={finishedSessions}
                collapsed={layout.collapsed}
                platform={desktop.platform}
                projectId={projectId}
                activeResourceId={activeId}
                projectFilter={projectFilter}
                providerFilter={providerFilter}
                shortcut={shortcut}
                onProject={toggleProject}
                onNewThread={(id) => newChat(undefined, undefined, id)}
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
                {...(desktop.pickDirectory ? { onAddProject: () => void addProject() } : {})}
                {...(desktop.openFeedback
                  ? {
                      onFeedback: (kind: 'bug' | 'feature' | 'docs') =>
                        void desktop.openFeedback?.(kind).catch(client.reportError),
                    }
                  : {})}
                onCopyDiagnostics={() =>
                  navigator.clipboard.writeText(diagnosticsText(desktop.platform, buildFacts()))
                }
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
                finishedSessions={finishedSessions}
                project={project}
                activeResource={activeResource}
                shortcut={shortcut}
                launcherOpen={!!launcher}
                onSelectTab={(resourceId) => openResource(resourceId)}
                onCloseTab={closeTab}
                onMiddleCloseTab={middleCloseTab}
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
                ) : !workspace.projects.length ? (
                  <FirstRun
                    providers={workspace.providers}
                    canAddProject={!!desktop.pickDirectory}
                    onAddProject={addProject}
                    onCheckProviders={checkProviders}
                    onProviderSettings={() => {
                      setSettingsStartPage('Providers');
                      setSettingsMode('dedicated');
                    }}
                  />
                ) : (
                  <section className="pane empty-surface">
                    {workspace.resources.some((item) => item.kind === 'conversation') ? (
                      <>
                        <h2>Your work is still here.</h2>
                        <p>Open a conversation from history or start something new.</p>
                      </>
                    ) : (
                      <>
                        <h2>Start your first chat</h2>
                        <p>Ask an agent to work in {project?.name ?? 'your project'}.</p>
                      </>
                    )}
                    <button className="button primary" onClick={() => newChat()}>
                      <Plus size={14} />
                      New chat
                    </button>
                  </section>
                )}
              </div>
              {closedNotice && (
                <div className="closed-tab-toast" role="status" key={closedNotice.key}>
                  <span className="truncate">Closed “{closedNotice.title}”</span>
                  <button type="button" onClick={reopenTab}>
                    Reopen
                    {reopenHint && <kbd>{reopenHint}</kbd>}
                  </button>
                </div>
              )}
              {launcher && (
                <NewResourceLauncher
                  projects={workspace.projects}
                  projectId={projectId}
                  shortcut={shortcut}
                  anchor={launcher.anchor}
                  onClose={() => setLauncher(null)}
                  onProject={switchProject}
                  onAgentChat={(presentation) => newChat(presentation, launcher.paneId)}
                  {...(desktop.pickDirectory ? { onAddProject: () => void addProject() } : {})}
                  onResource={(kind) =>
                    void openKind(
                      kind,
                      undefined,
                      launcher.paneId,
                      undefined,
                      launcher.paneId ? tabWorktree() : undefined,
                    )
                  }
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
        {confirmClose && (
          <Dialog
            title={`Close ${confirmClose.title}?`}
            className="confirm-dialog"
            onClose={() => setConfirmClose(null)}
          >
            <h2>Close “{confirmClose.title}”?</h2>
            <p>
              {confirmClose.reason === 'terminal'
                ? 'Its shell keeps running. You can reopen it from New tab.'
                : confirmClose.reason === 'waiting'
                  ? 'The agent is waiting for you. Closing the tab doesn’t answer or stop it; the chat stays in History.'
                  : 'The agent is still working. Closing the tab doesn’t stop it; the chat stays in History.'}
            </p>
            <footer>
              <button
                type="button"
                className="button quiet"
                autoFocus
                onClick={() => setConfirmClose(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button danger"
                onClick={() => {
                  closeTab(confirmClose.tabId);
                  setConfirmClose(null);
                }}
              >
                Close tab
              </button>
            </footer>
          </Dialog>
        )}
        {contextMenu && <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />}
        {creatingProject && (
          <ProjectEditor
            projects={workspace.projects}
            {...(desktop.pickDirectory ? { onPickFolder: desktop.pickDirectory } : {})}
            onSave={createProject}
            onClose={() => closeNewProject(null)}
          />
        )}
        {editingProject &&
          (() => {
            const target = workspace.projects.find((item) => item.id === editingProject);
            return target ? (
              <ProjectEditor
                project={target}
                projects={workspace.projects}
                {...(desktop.pickDirectory ? { onPickFolder: desktop.pickDirectory } : {})}
                onSave={(changes) => updateProject(target.id, changes)}
                onClose={() => setEditingProject(null)}
              />
            ) : null;
          })()}
      </FileIconThemeProvider>
    </AppearanceContext.Provider>
  );
}
