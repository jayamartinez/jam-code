import type {
  Conversation,
  Cursor,
  JamEvent,
  JamTransport,
  Project,
  ProviderDescriptor,
  Resource,
  Session,
  WorkspaceSnapshot,
  Worktree,
} from '@jam/protocol';

export interface RuntimeProjection {
  workspace: WorkspaceSnapshot | null;
  conversations: ReadonlyMap<string, Conversation>;
  error: string | null;
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'The local runtime could not complete that request.';

/** Disposable read projection. Runtime-owned turns are never stopped here. */
export class RuntimeClient {
  private state: RuntimeProjection = { workspace: null, conversations: new Map(), error: null };
  private listeners = new Set<() => void>();
  private conversationListeners = new Map<string, Set<() => void>>();
  private cursor: Cursor | null = null;
  private generation = 0;
  private readRevision = 0;
  private unsubscribe?: () => void;
  private synchronizing = false;
  private buffered: JamEvent[] = [];
  private recent: JamEvent[] = [];
  private loading = new Map<string, symbol>();
  private metadataPending = false;
  private metadataAgain = false;
  private bufferOverflow = false;
  private providersChecked?: Promise<void>;

  constructor(readonly transport: JamTransport) {}

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getConversation = (id: string) => this.state.conversations.get(id);
  subscribeConversation = (id: string, listener: () => void) => {
    const listeners = this.conversationListeners.get(id) ?? new Set<() => void>();
    listeners.add(listener);
    this.conversationListeners.set(id, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.conversationListeners.delete(id);
    };
  };
  private update(next: Partial<RuntimeProjection>) {
    const previous = this.state;
    this.state = { ...previous, ...next };
    if (previous.workspace !== this.state.workspace || previous.error !== this.state.error)
      this.listeners.forEach((listener) => listener());
    if (next.conversations)
      for (const [id, listeners] of this.conversationListeners) {
        if (previous.conversations.get(id) !== next.conversations.get(id))
          listeners.forEach((listener) => listener());
      }
  }
  clearError = () => this.update({ error: null });
  reportError = (error: unknown) => this.update({ error: errorMessage(error) });

  async connect() {
    const generation = ++this.generation;
    this.synchronizing = true;
    this.buffered = [];
    try {
      // Listening first closes the race between reading persisted state and
      // observing the next provider update.
      const unsubscribe = await this.transport.subscribe({}, (event) => {
        if (generation !== this.generation) return;
        if (this.synchronizing) this.bufferEvent(event);
        else this.receive(event);
      });
      if (generation !== this.generation) {
        unsubscribe();
        return;
      }
      this.unsubscribe = unsubscribe;
      await this.synchronize(generation);
    } catch (error) {
      if (generation === this.generation) {
        this.synchronizing = false;
        this.reportError(error);
      }
    }
  }

  disconnect() {
    this.generation++;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.loading.clear();
    // No interrupt request: closing a view or detaching React does not own a turn.
  }

  private async synchronize(generation = this.generation) {
    const revision = ++this.readRevision;
    this.loading.clear();
    this.synchronizing = true;
    try {
      const workspace = await this.transport.request('workspace.get', {});
      if (generation !== this.generation || revision !== this.readRevision) return;
      if (this.bufferOverflow) {
        this.bufferOverflow = false;
        this.buffered = [];
        await this.synchronize(generation);
        return;
      }
      this.cursor = { runtimeId: workspace.runtimeId, sequence: workspace.sequence };
      this.recent = [];
      const existingIds = [
        ...new Set([...this.state.conversations.keys(), ...this.conversationListeners.keys()]),
      ].filter(Boolean);
      this.update({ workspace, conversations: new Map(), error: null });
      if (
        typeof performance !== 'undefined' &&
        !performance.getEntriesByName('jam-workspace-loaded').length
      ) {
        performance.mark('jam-workspace-loaded');
        if (performance.getEntriesByName('jam-bootstrap').length)
          performance.measure('jam-startup', 'jam-bootstrap', 'jam-workspace-loaded');
      }
      this.synchronizing = false;
      const buffered = this.buffered;
      this.buffered = [];
      for (const event of buffered) this.receive(event);
      for (const id of existingIds) void this.loadConversation(id);
    } catch (error) {
      if (generation === this.generation && revision === this.readRevision) {
        this.synchronizing = false;
        this.reportError(error);
      }
    }
  }

  private receive(event: JamEvent) {
    if (this.synchronizing) {
      this.bufferEvent(event);
      return;
    }
    if (
      !this.cursor ||
      event.cursor.runtimeId !== this.cursor.runtimeId ||
      event.cursor.sequence > this.cursor.sequence + 1
    ) {
      this.bufferEvent(event);
      void this.synchronize();
      return;
    }
    if (event.cursor.sequence <= this.cursor.sequence) return;
    this.cursor = event.cursor;
    this.recent.push(event);
    if (this.recent.length > 500) this.recent.shift();
    let workspace = this.state.workspace;
    if (workspace && event.type === 'session.updated') {
      const sessions = workspace.sessions.some((session) => session.id === event.session.id)
        ? workspace.sessions.map((session) =>
            session.id === event.session.id ? event.session : session,
          )
        : [...workspace.sessions, event.session];
      workspace = { ...workspace, sessions, providers: withRunning(workspace.providers, sessions) };
    }
    const conversations = new Map(this.state.conversations);
    const conversation = conversations.get(event.resourceId);
    if (conversation) conversations.set(event.resourceId, applyEvent(conversation, event));
    if (workspace !== this.state.workspace || conversation)
      this.update({ workspace, ...(conversation ? { conversations } : {}) });
    if (
      (event.type === 'message.upserted' && event.message.role === 'user') ||
      (event.type === 'session.updated' && event.session.status !== 'running')
    )
      this.refreshMetadata();
  }

  private bufferEvent(event: JamEvent) {
    if (this.buffered.length >= 500) {
      this.bufferOverflow = true;
      this.buffered.shift();
    }
    this.buffered.push(event);
  }

  private refreshMetadata() {
    // A change after an in-flight read started (a title set by the first
    // Send) must not be lost: read once more when that read finishes.
    if (this.metadataPending) {
      this.metadataAgain = true;
      return;
    }
    this.metadataPending = true;
    this.metadataAgain = false;
    const generation = this.generation;
    const revision = this.readRevision;
    void this.transport
      .request('workspace.get', {})
      .then(
        (snapshot) => {
          if (
            generation !== this.generation ||
            revision !== this.readRevision ||
            !this.state.workspace
          )
            return;
          this.update({ workspace: { ...this.state.workspace, resources: snapshot.resources } });
        },
        (error: unknown) => {
          if (generation === this.generation) this.reportError(error);
        },
      )
      .finally(() => {
        this.metadataPending = false;
        if (this.metadataAgain && generation === this.generation) this.refreshMetadata();
      });
  }

  async loadConversation(resourceId: string) {
    if (this.state.conversations.has(resourceId) || this.loading.has(resourceId)) return;
    const token = Symbol(resourceId);
    this.loading.set(resourceId, token);
    const generation = this.generation;
    const revision = this.readRevision;
    try {
      let conversation = await this.transport.request('conversation.get', { resourceId });
      if (generation !== this.generation || revision !== this.readRevision) return;
      if (this.cursor && conversation.cursor.runtimeId !== this.cursor.runtimeId) {
        void this.synchronize();
        return;
      }
      if (
        this.recent.length === 500 &&
        conversation.cursor.sequence < (this.recent[0]?.cursor.sequence ?? 0) - 1
      ) {
        this.loading.delete(resourceId);
        void this.loadConversation(resourceId);
        return;
      }
      for (const event of this.recent)
        if (event.resourceId === resourceId) conversation = applyEvent(conversation, event);
      const conversations = new Map(this.state.conversations);
      if (conversations.size >= 20) {
        const oldest = conversations.keys().next().value;
        if (oldest) conversations.delete(oldest);
      }
      conversations.set(resourceId, conversation);
      this.update({ conversations });
    } catch (error) {
      if (generation === this.generation && revision === this.readRevision) this.reportError(error);
    } finally {
      if (this.loading.get(resourceId) === token) this.loading.delete(resourceId);
    }
  }

  /**
   * Asks the runtime to check providers once, on first need rather than at
   * launch: checking starts each installed CLI briefly. Later calls reuse
   * the same answer until `refreshProviders`.
   */
  ensureProviders(): Promise<void> {
    this.providersChecked ??= this.loadProviders(false);
    return this.providersChecked;
  }

  /** Checks every provider again, such as from Settings → Providers. */
  refreshProviders(): Promise<void> {
    this.providersChecked = this.loadProviders(true);
    return this.providersChecked;
  }

  private async loadProviders(refresh: boolean) {
    const generation = this.generation;
    try {
      const { providers } = await this.transport.request(
        'provider.list',
        refresh ? { refresh: true } : {},
      );
      if (generation === this.generation) this.updateProviders(providers);
    } catch (error) {
      this.providersChecked = undefined;
      if (generation === this.generation) this.reportError(error);
    }
  }

  /** Reflect provider descriptors the runtime just returned. */
  updateProviders(providers: ProviderDescriptor[]) {
    const workspace = this.state.workspace;
    if (!workspace) return;
    this.update({
      workspace: { ...workspace, providers: withRunning(providers, workspace.sessions) },
    });
  }

  /** Rereads the whole workspace, after a change that touches many records. */
  reload() {
    return this.synchronize();
  }

  /** Reflect a project the runtime just updated without a full reread. */
  updateProject(project: Project) {
    const workspace = this.state.workspace;
    if (!workspace) return;
    this.update({
      workspace: {
        ...workspace,
        projects: workspace.projects.map((item) => (item.id === project.id ? project : item)),
      },
    });
  }

  /** Reflect a resource the runtime just changed, such as a closed thread. */
  updateResource(resource: Resource) {
    const workspace = this.state.workspace;
    if (!workspace) return;
    this.update({
      workspace: {
        ...workspace,
        resources: workspace.resources.map((item) => (item.id === resource.id ? resource : item)),
      },
    });
  }

  /** Cache a resource the runtime just created so the tab can render at once. */
  addResource(resource: Resource) {
    const workspace = this.state.workspace;
    if (!workspace || workspace.resources.some((item) => item.id === resource.id)) return;
    this.update({ workspace: { ...workspace, resources: [...workspace.resources, resource] } });
  }

  addConversation(created: {
    resource: Resource;
    session: Session;
    conversation: Conversation;
    worktree?: Worktree;
  }) {
    const workspace = this.state.workspace;
    if (!workspace) return;
    const worktree = created.worktree;
    const conversations = new Map(this.state.conversations);
    conversations.set(created.resource.id, created.conversation);
    this.update({
      workspace: {
        ...workspace,
        resources: [
          ...workspace.resources.filter((resource) => resource.id !== created.resource.id),
          created.resource,
        ],
        sessions: [
          ...workspace.sessions.filter((session) => session.id !== created.session.id),
          created.session,
        ],
        worktrees: worktree
          ? [...workspace.worktrees.filter((item) => item.id !== worktree.id), worktree]
          : workspace.worktrees,
      },
      conversations,
    });
  }
}

/** Running is derived from sessions, the one authority for it. */
function withRunning(providers: ProviderDescriptor[], sessions: Session[]): ProviderDescriptor[] {
  return providers.map((provider) => {
    const runningCount = sessions.filter(
      (session) => session.providerId === provider.id && session.status === 'running',
    ).length;
    return { ...provider, running: runningCount > 0, runningCount };
  });
}

export function applyEvent(conversation: Conversation, event: JamEvent): Conversation {
  if (
    event.cursor.runtimeId !== conversation.cursor.runtimeId ||
    event.cursor.sequence <= conversation.cursor.sequence
  )
    return conversation;
  if (event.type !== 'message.upserted') return { ...conversation, cursor: event.cursor };
  const exists = conversation.messages.some((message) => message.id === event.message.id);
  return {
    ...conversation,
    cursor: event.cursor,
    messages: exists
      ? conversation.messages.map((message) =>
          message.id === event.message.id ? event.message : message,
        )
      : [...conversation.messages, event.message],
  };
}
