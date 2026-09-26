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
import type { ContextItem, JamTransport, Resource } from '@jam/protocol';
import type { DesktopServices } from './desktop';
import { initialLayout, layoutReducer } from './state/layout';
import { RuntimeClient } from './state/runtime-client';
import { Brand, Dialog, IconButton } from './components/Controls';
import { Sidebar } from './components/Sidebar';
import { Composer, ConversationPane } from './components/ConversationPane';
import { SearchDialog } from './components/SearchDialog';
import { SettingsPanel } from './components/SettingsPanel';
import { Launcher } from './components/Launcher';
import { NewChat } from './components/NewChat';
import { WorkspaceTitlebar } from './components/WorkspaceTitlebar';

const DemoResource = lazy(() => import('./components/DemoResource'));
const emptyContext: ContextItem[] = [];
type Overlay = 'search' | 'launcher' | 'context' | null;

export interface JamAppProps {
  transport: JamTransport;
  desktop: DesktopServices;
}

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
  const [settingsMode, setSettingsMode] = useState<'dedicated' | null>(null);
  const [draftProjects, setDraftProjects] = useState<Record<string, string>>({});
  const [context, setContext] = useState<Record<string, ContextItem[]>>({});
  const [previewContext, setPreviewContext] = useState<ContextItem | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const busyRef = useRef(new Set<string>());
  const requests = useRef(new Map<string, { payload: string; requestId: string }>());
  const initialized = useRef(false);
  const shortcut = desktop.platform === 'macos' ? '⌘' : 'Ctrl';
  const activeView = layout.views.find((view) => view.id === layout.activeViewId);
  const activeId = activeView?.resourceId ?? '';
  const activeResource = workspace?.resources.find((resource) => resource.id === activeId);
  const activeSession = workspace?.sessions.find(
    (session) => session.id === activeResource?.sessionId,
  );
  const project = workspace?.projects.find(
    (item) => item.id === (activeResource?.projectId ?? draftProjects[activeId] ?? projectId),
  );
  const activeContext = context[activeId] ?? emptyContext;
  const conversation = useSyncExternalStore(
    useCallback((listener) => client.subscribeConversation(activeId, listener), [activeId, client]),
    useCallback(() => client.getConversation(activeId), [activeId, client]),
    useCallback(() => client.getConversation(activeId), [activeId, client]),
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
    if (first) dispatch({ type: 'open', resourceId: first.id });
    for (const resource of workspace.resources.filter(
      (resource) => resource.kind === 'diff' || resource.kind === 'terminal',
    ))
      dispatch({ type: 'open', resourceId: resource.id });
    if (first) dispatch({ type: 'open', resourceId: first.id });
  }, [workspace]);
  useEffect(() => {
    if (activeResource?.kind === 'conversation') void client.loadConversation(activeResource.id);
  }, [activeResource?.id, activeResource?.kind, client]);

  const openResource = useCallback(
    (resourceId: string) => {
      dispatch({ type: 'open', resourceId });
      setOverlay(null);
      setSettingsMode(null);
      const resource = client
        .getSnapshot()
        .workspace?.resources.find((item) => item.id === resourceId);
      if (resource?.projectId) setProjectId(resource.projectId);
    },
    [client],
  );
  const newChat = useCallback(() => {
    if (!projectId) return;
    const id = `draft:${crypto.randomUUID()}`;
    setDraftProjects((current) => ({ ...current, [id]: projectId }));
    dispatch({ type: 'open', resourceId: id });
    dispatch({ type: 'mode', mode: 'single' });
    setOverlay(null);
    setSettingsMode(null);
  }, [projectId]);
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
  const openDemo = useCallback(() => {
    const resources = client.getSnapshot().workspace?.resources ?? [];
    for (const resource of resources.filter(
      (item) => item.kind === 'diff' || item.kind === 'terminal',
    ))
      dispatch({ type: 'open', resourceId: resource.id });
    if (activeId) dispatch({ type: 'open', resourceId: activeId });
    dispatch({ type: 'mode', mode: 'tiles' });
  }, [activeId, client]);
  const closeView = useCallback((viewId: string) => dispatch({ type: 'close', viewId }), []);
  const openSettings = useCallback(() => {
    setSettingsMode('dedicated');
    setOverlay(null);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        if (overlay || previewContext) return;
        if (settingsMode) setSettingsMode(null);
        else if (layout.focus) dispatch({ type: 'focus' });
        return;
      }
      if (!(desktop.platform === 'macos' ? event.metaKey : event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOverlay('search');
      } else if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        if (!overlay) newChat();
      } else if (event.key === ',') {
        event.preventDefault();
        openSettings();
      } else if (event.key === '.') {
        event.preventDefault();
        dispatch({ type: 'focus' });
      } else if (event.key.toLowerCase() === 'w' && activeView && !overlay && !settingsMode) {
        event.preventDefault();
        closeView(activeView.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    activeView,
    closeView,
    desktop.platform,
    layout.focus,
    newChat,
    openSettings,
    overlay,
    previewContext,
    settingsMode,
  ]);

  async function send() {
    const text = layout.drafts[activeId] ?? '';
    if (
      (!text.trim() && !activeContext.length) ||
      busyRef.current.has(activeId) ||
      activeSession?.status === 'running'
    )
      return;
    busyRef.current.add(activeId);
    setBusy(new Set(busyRef.current));
    let resourceId = activeId;
    try {
      if (draftProjects[activeId]) {
        const created = await transport.request('conversation.create', {
          projectId: draftProjects[activeId],
          presentation: 'claude',
        });
        client.addConversation(created);
        resourceId = created.resource.id;
        busyRef.current.add(resourceId);
        setBusy(new Set(busyRef.current));
        dispatch({ type: 'replaceDraft', draftId: activeId, resourceId });
        setContext((current) => ({ ...current, [resourceId]: activeContext }));
      }
      const payload = JSON.stringify({ text, context: activeContext });
      const previous = requests.current.get(resourceId);
      const requestId = previous?.payload === payload ? previous.requestId : crypto.randomUUID();
      requests.current.set(resourceId, { payload, requestId });
      await transport.request('turn.start', {
        resourceId,
        text,
        context: activeContext,
        requestId,
      });
      requests.current.delete(resourceId);
      dispatch({ type: 'draft', resourceId, text: '' });
      setContext((current) => ({ ...current, [resourceId]: [] }));
    } catch (cause) {
      client.reportError(cause);
    } finally {
      busyRef.current.delete(activeId);
      busyRef.current.delete(resourceId);
      setBusy(new Set(busyRef.current));
    }
  }

  const composerProps = {
    draft: layout.drafts[activeId] ?? '',
    context: activeContext,
    busy: busy.has(activeId),
    shortcut,
    onDraft: (text: string) => dispatch({ type: 'draft', resourceId: activeId, text }),
    onSend: () => void send(),
    onStop: () => {
      if (activeSession)
        void transport
          .request('turn.interrupt', { sessionId: activeSession.id })
          .catch(client.reportError);
    },
    onAddContext: () => setOverlay('context'),
    onPreviewContext: setPreviewContext,
    onRemoveContext: (id: string) =>
      setContext((current) => ({
        ...current,
        [activeId]: activeContext.filter((item) => item.id !== id),
      })),
  };

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
      dedicated={dedicated}
      desktop={desktop}
      onClose={() => setSettingsMode(null)}
      onMode={() => {
        if (dedicated) {
          const resource = workspace.resources.find((item) => item.kind === 'settings');
          if (resource) openResource(resource.id);
        } else openSettings();
      }}
    />
  );
  const demoViews =
    layout.mode === 'tiles' && !layout.focus && activeResource?.kind === 'conversation'
      ? layout.views.filter((view) => {
          const resource = workspace.resources.find((item) => item.id === view.resourceId);
          return resource?.kind === 'diff' || resource?.kind === 'terminal';
        })
      : [];
  const resourceSurface = (resource: Resource, viewId: string) =>
    resource.kind === 'settings' ? (
      settings(false)
    ) : resource.kind === 'diff' || resource.kind === 'terminal' ? (
      <Suspense fallback={<section className="pane empty-surface">Loading demo…</section>}>
        <DemoResource kind={resource.kind} onClose={() => closeView(viewId)} />
      </Suspense>
    ) : (
      <section className="pane empty-surface">
        <p>{resource.title}</p>
        <p>This resource is planned for a later milestone.</p>
      </section>
    );

  return (
    <>
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
              projectId={projectId}
              activeResourceId={activeId}
              projectFilter={projectFilter}
              providerFilter={providerFilter}
              shortcut={shortcut}
              onProject={switchProject}
              onProjectFilter={setProjectFilter}
              onProviderFilter={setProviderFilter}
              onOpen={openResource}
              onSearch={() => setOverlay('search')}
              onNew={newChat}
              onSettings={openSettings}
              onCollapse={() => dispatch({ type: 'collapse' })}
            />
          )}
          <main className="main-shell">
            <WorkspaceTitlebar
              desktop={desktop}
              layout={layout}
              workspace={workspace}
              visibleViews={demoViews}
              project={project}
              activeResource={activeResource}
              shortcut={shortcut}
              onOpen={openResource}
              onClose={closeView}
              onNewResource={() => setOverlay('launcher')}
              onExitFocus={() => dispatch({ type: 'focus' })}
              onMode={(mode) => {
                if (mode === 'tiles') openDemo();
                else dispatch({ type: 'mode', mode });
              }}
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
              {activeResource?.kind === 'conversation' ? (
                <ConversationPane
                  resource={activeResource}
                  project={project}
                  session={activeSession}
                  conversation={conversation}
                  {...composerProps}
                  onFocus={() => dispatch({ type: 'focus' })}
                  onOpenDemo={openDemo}
                />
              ) : draftProjects[activeId] ? (
                <NewChat
                  project={project}
                  resources={workspace.resources.filter(
                    (resource) =>
                      resource.projectId === project?.id && resource.kind === 'conversation',
                  )}
                  onOpen={openResource}
                  onStarter={composerProps.onDraft}
                  composer={<Composer {...composerProps} isNew />}
                />
              ) : activeResource && activeView ? (
                resourceSurface(activeResource, activeView.id)
              ) : (
                <section className="pane empty-surface">
                  <h2>Your work is still here.</h2>
                  <p>Open a conversation from history or start something new.</p>
                  <button className="button primary" onClick={newChat}>
                    <Plus size={14} />
                    New chat
                  </button>
                </section>
              )}
              {!!demoViews.length && (
                <div className="secondary-column">
                  {demoViews.map((view) => {
                    const resource = workspace.resources.find(
                      (item) => item.id === view.resourceId,
                    );
                    return resource ? (
                      <Suspense
                        key={view.id}
                        fallback={<section className="pane empty-surface">Loading demo…</section>}
                      >
                        <DemoResource
                          kind={resource.kind as 'diff' | 'terminal'}
                          onClose={() => closeView(view.id)}
                        />
                      </Suspense>
                    ) : null;
                  })}
                </div>
              )}
            </div>
          </main>
        </div>
      )}
      {overlay === 'search' && (
        <SearchDialog
          transport={transport}
          projects={workspace.projects}
          onClose={() => setOverlay(null)}
          onOpen={openResource}
        />
      )}
      {overlay === 'launcher' && (
        <Launcher
          projects={workspace.projects}
          projectId={projectId}
          shortcut={shortcut}
          onClose={() => setOverlay(null)}
          onProject={switchProject}
          onNew={newChat}
          onResource={(kind) => {
            const resource = workspace.resources.find((item) => item.kind === kind);
            if (resource) openResource(resource.id);
          }}
        />
      )}
      {overlay === 'context' && (
        <Dialog title="Add context" className="context-dialog" onClose={() => setOverlay(null)}>
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
                label: 'SessionManager.ts · demo',
                source: {
                  resourceId: 'file-pane',
                  uri: 'project://project-jam/src/runtime/SessionManager.ts',
                },
              };
              setContext((current) => ({
                ...current,
                [activeId]: [...activeContext, item].slice(0, 16),
              }));
              setOverlay(null);
            }}
          >
            <Folder size={13} />
            SessionManager.ts
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
    </>
  );
}
