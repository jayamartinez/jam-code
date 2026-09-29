import fixtureJson from '../fixtures/workspace.json';
import { JamError } from './errors';
import { listPreviewDirectory, readPreviewFile, writePreviewFile } from './preview-files';
import { searchPreview } from './preview-search';
import type {
  Conversation,
  Interaction,
  JamEvent,
  JamRequest,
  JamTransport,
  Message,
  RequestMap,
  RequestMethod,
  Resource,
  Session,
  SubscriptionScope,
  WorkspaceSnapshot,
} from './types';
import type { TerminalAttachment } from './terminal';
import type { AppearanceSettings, Wallpaper } from './appearance';
import { validateFixture, validateRequest, validateResponse, validateScope } from './validation';

type Listener = { scope: SubscriptionScope; receive: (event: JamEvent) => void };
type ActiveTurn = { timer: ReturnType<typeof setTimeout>; message: Message; fail: boolean };
type Receipt = { signature: string; result: RequestMap['turn.start']['result'] };

const NO_TERMINALS =
  'Terminals run in the jam desktop app. The browser preview cannot start a shell.';
import { initialsOf } from './projects';
const copy = <T>(value: T): T => structuredClone(value);
const now = () => new Date().toISOString();
export { initialsOf } from './projects';

/**
 * Explicit development-only, volatile runtime substitute. Never select this as
 * a fallback for failed native IPC. It performs no IO and owns no real process.
 */
export class BrowserPreviewTransport implements JamTransport {
  private readonly workspace: WorkspaceSnapshot;
  private readonly conversations: Map<string, Conversation>;
  private readonly listeners = new Set<Listener>();
  private readonly active = new Map<string, ActiveTurn>();
  private readonly asking = new Map<string, { interaction: Interaction; message: Message }>();
  private readonly receipts = new Map<string, Receipt>();
  private readonly pendingEvents: JamEvent[] = [];
  private publishing = false;
  private nextId = 0;
  /** Volatile like the rest of the preview: a reload restores the defaults. */
  private appearance: AppearanceSettings | undefined;
  private wallpaper: Wallpaper | undefined;

  constructor() {
    const fixture = copy(validateFixture(fixtureJson));
    this.workspace = fixture.workspace;
    this.workspace.runtimeId = `preview-${crypto.randomUUID()}`;
    this.conversations = new Map(
      fixture.conversations.map((conversation) => [conversation.resourceId, conversation]),
    );
  }

  async request<M extends RequestMethod>(
    method: M,
    params: RequestMap[M]['params'],
  ): Promise<RequestMap[M]['result']> {
    const request = validateRequest({ protocolVersion: 1, method, params });
    const result = this.dispatch(request);
    return copy(validateResponse(method, result));
  }

  async subscribe(
    scope: SubscriptionScope,
    receive: (event: JamEvent) => void,
  ): Promise<() => void> {
    const listener = { scope: copy(validateScope(scope)), receive };
    this.listeners.add(listener);
    // Unsubscribing changes delivery only. Runtime work continues without views.
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The browser cannot start a process, so no terminal ever runs here. */
  async attachTerminal(): Promise<TerminalAttachment> {
    throw new JamError('unavailable', NO_TERMINALS);
  }

  private dispatch(request: JamRequest): RequestMap[RequestMethod]['result'] {
    switch (request.method) {
      case 'snapshot.list':
      case 'snapshot.settings.get':
      case 'snapshot.settings.update':
      case 'snapshot.focus':
      case 'snapshot.stage':
      case 'snapshot.remove':
      case 'snapshot.asset':
      case 'snapshot.cleanup':
        throw new JamError('unavailable', 'Snapshots require the desktop app.');
      case 'workspace.get':
        return this.workspace;
      case 'git.status':
        this.requireProject(request.params.projectId);
        return {
          projectId: request.params.projectId,
          state: 'unavailable',
          detached: false,
          unborn: false,
          files: [],
          truncated: false,
        };
      case 'git.branches':
      case 'git.diff':
      case 'git.setStaged':
        throw new JamError('unavailable', 'Git runs in the jam desktop app.');
      case 'conversation.get':
        return { ...this.getConversation(request.params.resourceId), cursor: this.cursor() };
      case 'conversation.create':
        return this.createConversation(request.params);
      case 'session.compact':
        throw new JamError('unsupported', 'The demo provider has no context to compact.');
      case 'file.reveal':
      case 'url.openExternal':
        throw new JamError('unavailable', 'Opening outside jam needs the desktop app.');
      case 'provider.list':
        return { providers: this.workspace.providers };
      case 'provider.configure':
        return this.configureProvider(request.params);
      case 'interaction.respond':
        return this.respond(request.params);
      case 'turn.start':
        return this.startTurn(request.params);
      case 'turn.interrupt':
        return this.interrupt(request.params.sessionId);
      case 'directory.list':
        this.requireProject(request.params.projectId);
        return listPreviewDirectory(request.params.projectId, request.params.path);
      case 'file.read':
        this.requireProject(request.params.projectId);
        return readPreviewFile(request.params.projectId, request.params.path);
      case 'file.write': {
        this.requireProject(request.params.projectId);
        const savedAt = writePreviewFile(
          request.params.projectId,
          request.params.path,
          request.params.text,
        );
        return { projectId: request.params.projectId, path: request.params.path, savedAt };
      }
      case 'project.create': {
        const { paths, name: requested, icon } = request.params;
        const path = (paths[0] ?? '').trim().replace(/[\\/]+$/, '');
        const known = this.workspace.projects.find((item) => item.paths?.[0] === path);
        if (known) return { project: known, existing: true };
        const name = requested?.trim() || path.split(/[\\/]/).pop() || path;
        const project = {
          id: `project-${crypto.randomUUID()}`,
          name,
          initials: initialsOf(name),
          branch: '',
          paths: [path, ...paths.slice(1).map((item) => item.trim())],
          ...(icon ? { icon } : {}),
        };
        this.workspace.projects.push(project);
        return { project, existing: false };
      }
      case 'project.remove': {
        const { projectId } = request.params;
        this.requireProject(projectId);
        this.workspace.projects = this.workspace.projects.filter((item) => item.id !== projectId);
        this.workspace.resources = this.workspace.resources.filter(
          (item) => item.projectId !== projectId,
        );
        return { projectId };
      }
      case 'project.update': {
        this.requireProject(request.params.projectId);
        const project = this.workspace.projects.find(
          (item) => item.id === request.params.projectId,
        )!;
        const { name, paths, icon, pinned } = request.params;
        if (pinned !== undefined) {
          if (pinned) project.pinned = true;
          else delete project.pinned;
        }
        if (name !== undefined) {
          project.name = name.trim();
          project.initials = initialsOf(project.name);
        }
        if (paths !== undefined) project.paths = paths.map((path) => path.trim());
        if (icon !== undefined) {
          if (icon.kind === 'initials' && !icon.tone) delete project.icon;
          else project.icon = { ...icon };
        }
        return { project };
      }
      case 'thread.setClosed': {
        const resource = this.getThread(request.params.resourceId);
        if (request.params.closed) resource.closedAt = new Date().toISOString();
        else delete resource.closedAt;
        return { resource };
      }
      case 'thread.keepOpen': {
        const resource = this.getThread(request.params.resourceId);
        resource.closeSuggestionDismissedAt = new Date().toISOString();
        return { resource };
      }
      case 'resource.open':
        return { resource: this.openResource(request.params) };
      case 'search.query': {
        const { query, projectId, providerId, pinned } = request.params;
        const resources = this.workspace.resources.filter(
          (resource) =>
            (projectId === undefined || resource.projectId === projectId) &&
            (pinned === undefined || resource.pinned === pinned),
        );
        const results = searchPreview(
          query,
          resources,
          this.workspace.sessions,
          this.conversations,
        );
        return {
          results:
            providerId === undefined
              ? results
              : results.filter((result) => result.providerId === providerId),
        };
      }
      case 'terminal.list':
        return { terminals: [] };
      case 'terminal.get': {
        const resource = this.workspace.resources.find(
          (item) => item.id === request.params.resourceId,
        );
        if (!resource) throw new JamError('not_found', 'Resource not found.');
        if (resource.kind !== 'terminal')
          throw new JamError('invalid_request', 'That resource is not a terminal.');
        return {};
      }
      case 'terminal.create':
      case 'terminal.start':
      case 'terminal.input':
      case 'terminal.resize':
      case 'terminal.kill':
      case 'terminal.ack':
        throw new JamError('unavailable', NO_TERMINALS);
      case 'appearance.get':
        return {
          ...(this.appearance ? { appearance: this.appearance } : {}),
          ...(this.wallpaper ? { wallpaper: this.wallpaper } : {}),
        };
      case 'appearance.update':
        this.appearance = copy(request.params.appearance);
        return { appearance: this.appearance };
      case 'appearance.setWallpaper':
        this.wallpaper = request.params.wallpaper && copy(request.params.wallpaper);
        return { updatedAt: now() };
    }
  }

  private cursor() {
    return { runtimeId: this.workspace.runtimeId, sequence: this.workspace.sequence };
  }

  private makeId(prefix: string): string {
    this.nextId += 1;
    return `${prefix}-preview-${this.nextId}`;
  }

  private getConversation(resourceId: string): Conversation {
    const conversation = this.conversations.get(resourceId);
    if (!conversation) throw new JamError('not_found', 'Conversation not found.');
    return conversation;
  }

  private getSession(sessionId: string): Session {
    const session = this.workspace.sessions.find((item) => item.id === sessionId);
    if (!session) throw new JamError('not_found', 'Session not found.');
    return session;
  }

  private getThread(resourceId: string): Resource {
    const resource = this.workspace.resources.find((item) => item.id === resourceId);
    if (!resource) throw new JamError('not_found', 'Resource not found.');
    if (resource.kind !== 'conversation')
      throw new JamError('invalid_request', 'Only a conversation is a thread.');
    return resource;
  }

  private requireProject(projectId: string) {
    if (!this.workspace.projects.some((project) => project.id === projectId))
      throw new JamError('not_found', 'Project not found.');
  }

  /** Reopening the same target returns the resource that already exists. */
  private openResource(params: RequestMap['resource.open']['params']): Resource {
    this.requireProject(params.projectId);
    if (params.worktreeId) throw new JamError('not_found', 'Worktree not found.');
    // Fail before creating a record if the target cannot be read.
    if (params.kind === 'file') readPreviewFile(params.projectId, params.path ?? '');
    // Each browser is its own page with its own history, so opening one never
    // returns another; every other target keeps one identity.
    const existing = this.workspace.resources.find(
      (resource) =>
        params.kind !== 'browser' &&
        resource.kind === params.kind &&
        resource.projectId === params.projectId &&
        resource.path === params.path &&
        resource.worktreeId === params.worktreeId,
    );
    if (existing) return existing;
    const title =
      params.kind === 'file'
        ? (params.path ?? '').slice((params.path ?? '').lastIndexOf('/') + 1)
        : params.kind === 'file-browser'
          ? 'Files'
          : params.kind === 'terminal'
            ? 'Terminal'
            : params.kind === 'browser'
              ? 'Browser'
              : 'Review changes';
    const resource: Resource = {
      id: this.makeId(params.kind),
      kind: params.kind,
      title,
      projectId: params.projectId,
      ...(params.path === undefined ? {} : { path: params.path }),
      pinned: false,
      updatedAt: now(),
    };
    this.workspace.resources.push(resource);
    return resource;
  }

  private configureProvider(
    params: RequestMap['provider.configure']['params'],
  ): RequestMap['provider.configure']['result'] {
    const provider = this.workspace.providers.find((item) => item.id === params.providerId);
    if (!provider) throw new JamError('invalid_request', 'Unknown provider.');
    if (
      params.executable !== undefined ||
      params.favoriteModels ||
      params.hiddenModels ||
      (params.defaults && provider.id !== 'mock')
    )
      throw new JamError('unavailable', 'Provider settings are saved by the jam desktop app.');
    if (params.enabled !== undefined) provider.enabled = params.enabled;
    if (params.isDefault)
      for (const item of this.workspace.providers) item.isDefault = item === provider;
    return { providers: this.workspace.providers };
  }

  /** The preview's simulated approval and question, answered like the real path. */
  private respond(
    params: RequestMap['interaction.respond']['params'],
  ): RequestMap['interaction.respond']['result'] {
    const conversation = this.getConversation(params.resourceId);
    const session = this.getSession(conversation.sessionId);
    const pending = this.asking.get(session.id);
    if (!pending || pending.interaction.id !== params.interactionId)
      throw new JamError('stale', 'This request is no longer waiting for an answer.');
    const { interaction, message } = pending;
    const answer = params.choiceId
      ? interaction.choices.find((choice) => choice.id === params.choiceId)?.label
      : Object.values(params.answers ?? {})
          .flat()
          .join(', ');
    if (!answer) throw new JamError('invalid_request', 'That choice is not offered.');
    this.asking.delete(session.id);
    interaction.status = 'resolved';
    interaction.outcome = params.choiceId === 'deny' ? 'Denied' : answer;
    message.blocks.push({
      type: 'text',
      text: `The demo provider received: ${interaction.outcome}. No command ran.`,
    });
    session.status = 'idle';
    session.needsInput = false;
    this.updateRunningProvider();
    this.publish({ type: 'message.upserted', resourceId: session.resourceId, message });
    this.publish({ type: 'session.updated', session });
    return { accepted: true };
  }

  private createConversation(
    params: RequestMap['conversation.create']['params'],
  ): RequestMap['conversation.create']['result'] {
    if (!this.workspace.projects.some((project) => project.id === params.projectId)) {
      throw new JamError('not_found', 'Project not found.');
    }
    if (params.providerId && params.providerId !== 'mock')
      throw new JamError(
        'unavailable',
        'Claude Code and Codex run in the jam desktop app. The browser preview only has the demo provider.',
      );
    if (params.workspace && (params.workspace.kind === 'worktree' || params.workspace.branch))
      throw new JamError('unavailable', 'Branches and worktrees need the jam desktop app.');
    const resource: Resource = {
      id: this.makeId('conversation'),
      kind: 'conversation',
      title: 'New conversation',
      projectId: params.projectId,
      sessionId: this.makeId('session'),
      pinned: false,
      updatedAt: now(),
    };
    const session: Session = {
      id: resource.sessionId!,
      resourceId: resource.id,
      providerId: 'mock',
      presentation: params.presentation,
      status: 'idle',
      model: 'Demo model',
    };
    const conversation: Conversation = {
      resourceId: resource.id,
      sessionId: session.id,
      messages: [],
      cursor: this.cursor(),
    };
    this.workspace.resources.push(resource);
    this.workspace.sessions.push(session);
    this.conversations.set(resource.id, conversation);
    this.publish({ type: 'session.updated', session });
    return { resource, session, conversation: { ...conversation, cursor: this.cursor() } };
  }

  private startTurn(
    params: RequestMap['turn.start']['params'],
  ): RequestMap['turn.start']['result'] {
    const signature = JSON.stringify({
      resourceId: params.resourceId,
      text: params.text,
      context: params.context.map(({ id, kind, label, source, assetId }) => ({
        id,
        kind,
        label,
        source: { resourceId: source.resourceId, uri: source.uri, selection: source.selection },
        assetId,
      })),
    });
    const previous = this.receipts.get(params.requestId);
    if (previous) {
      if (previous.signature !== signature)
        throw new JamError('conflict', 'Request ID was already used for different input.');
      return previous.result;
    }
    const conversation = this.getConversation(params.resourceId);
    const session = this.getSession(conversation.sessionId);
    if (session.status === 'running')
      throw new JamError('conflict', 'This conversation is already running.');
    if (this.receipts.size >= 1000 || conversation.messages.length >= 9998) {
      throw new JamError(
        'unavailable',
        'The development preview is full. Reload it to start a fresh demo.',
      );
    }
    const user: Message = {
      id: this.makeId('message'),
      role: 'user',
      createdAt: now(),
      blocks: [
        ...(params.text.trim() ? [{ type: 'text' as const, text: params.text }] : []),
        ...(params.context.length
          ? [{ type: 'context' as const, items: copy(params.context) }]
          : []),
      ],
    };
    const assistant: Message = {
      id: this.makeId('message'),
      role: 'assistant',
      createdAt: now(),
      blocks: [],
    };
    conversation.messages.push(user, assistant);
    session.status = 'running';
    const resource = this.workspace.resources.find((item) => item.id === params.resourceId)!;
    resource.updatedAt = now();
    // Continuing a closed thread is the clearest sign it is in use again.
    delete resource.closedAt;
    if (resource.title === 'New conversation')
      resource.title = params.text.trim().slice(0, 70) || 'Context review';
    const result = { accepted: true as const, sessionId: session.id, requestId: params.requestId };
    this.receipts.set(params.requestId, { signature, result });
    const prompt = params.text.trim();
    if (prompt === '/approval' || prompt === '/question') {
      this.ask(session, assistant, prompt === '/question');
      this.updateRunningProvider();
      this.publish({ type: 'message.upserted', resourceId: resource.id, message: user });
      this.publish({ type: 'message.upserted', resourceId: resource.id, message: assistant });
      this.publish({ type: 'session.updated', session });
      return result;
    }
    this.active.set(session.id, {
      message: assistant,
      fail: params.text.trim() === '/fail',
      timer: setTimeout(() => this.advanceTurn(session.id, 0), 350),
    });
    this.updateRunningProvider();
    this.publish({ type: 'session.updated', session });
    this.publish({ type: 'message.upserted', resourceId: resource.id, message: user });
    this.publish({ type: 'message.upserted', resourceId: resource.id, message: assistant });
    return result;
  }

  private ask(session: Session, message: Message, question: boolean) {
    const interaction: Interaction = question
      ? {
          id: this.makeId('interaction'),
          kind: 'question',
          title: 'Demo provider asks',
          choices: [],
          questions: [
            {
              id: 'approach',
              header: 'Approach',
              question: 'Which approach should the demo describe?',
              options: [
                { label: 'Runtime-owned', description: 'Sessions live in the runtime.' },
                { label: 'View-owned', description: 'Sessions end with their pane.' },
              ],
              multiSelect: false,
              allowOther: true,
            },
          ],
          status: 'pending',
        }
      : {
          id: this.makeId('interaction'),
          kind: 'command',
          title: 'Demo provider wants to run a command',
          detail: 'echo simulated',
          reason: 'Simulated request · nothing runs whichever you choose.',
          choices: [
            { id: 'allow', label: 'Allow once', tone: 'allow' },
            { id: 'deny', label: 'Deny', tone: 'deny' },
          ],
          status: 'pending',
        };
    message.blocks = [
      { type: 'text', text: 'This is a simulated request from the demo provider.' },
      { type: 'interaction', interaction },
    ];
    session.needsInput = true;
    this.asking.set(session.id, { interaction, message });
  }

  private advanceTurn(sessionId: string, step: number) {
    const active = this.active.get(sessionId);
    if (!active) return;
    const session = this.getSession(sessionId);
    const message = active.message;
    if (step === 0) {
      message.blocks = [
        {
          type: 'text',
          text: 'I’m checking the resource and session boundaries in this simulated workspace.',
        },
      ];
    } else if (step === 1) {
      message.blocks.push({
        type: 'tool',
        id: `tool-${message.id}`,
        kind: 'read',
        title: 'Inspect session ownership',
        detail: 'Demo activity only. No files or processes are accessed.',
        status: 'running',
      });
    } else {
      const tool = message.blocks.find((block) => block.type === 'tool');
      if (tool?.type === 'tool') tool.status = active.fail ? 'failed' : 'completed';
      message.blocks.push({
        type: 'text',
        text: active.fail
          ? 'The demo provider returned a simulated failure. Your message is retained; send another message to continue.'
          : 'The runtime owns the session; a pane only displays it. Closing a view detaches that view while work continues. This was a simulated response, with no model call or repository changes.',
      });
      session.status = active.fail ? 'failed' : 'idle';
      this.active.delete(sessionId);
      this.updateRunningProvider();
    }
    this.publish({ type: 'message.upserted', resourceId: session.resourceId, message });
    if (step < 2 && this.active.get(sessionId) === active) {
      active.timer = setTimeout(() => this.advanceTurn(sessionId, step + 1), 500);
    } else if (step >= 2) this.publish({ type: 'session.updated', session });
  }

  private interrupt(sessionId: string): RequestMap['turn.interrupt']['result'] {
    const session = this.getSession(sessionId);
    const asking = this.asking.get(sessionId);
    if (asking) {
      this.asking.delete(sessionId);
      asking.interaction.status = 'cancelled';
      asking.interaction.outcome = 'Interrupted';
      session.status = 'interrupted';
      session.needsInput = false;
      this.updateRunningProvider();
      this.publish({
        type: 'message.upserted',
        resourceId: session.resourceId,
        message: asking.message,
      });
      this.publish({ type: 'session.updated', session });
      return { sessionId, interrupted: true };
    }
    const active = this.active.get(sessionId);
    if (!active) return { sessionId, interrupted: false };
    clearTimeout(active.timer);
    this.active.delete(sessionId);
    session.status = 'interrupted';
    for (const block of active.message.blocks) {
      if (block.type === 'tool' && block.status === 'running') block.status = 'failed';
    }
    active.message.blocks.push({
      type: 'text',
      text: 'Demo turn interrupted. Send a new message to continue.',
    });
    this.updateRunningProvider();
    this.publish({
      type: 'message.upserted',
      resourceId: session.resourceId,
      message: active.message,
    });
    this.publish({ type: 'session.updated', session });
    return { sessionId, interrupted: true };
  }

  private updateRunningProvider() {
    const provider = this.workspace.providers.find((item) => item.id === 'mock');
    if (!provider) return;
    provider.runningCount = this.workspace.sessions.filter(
      (session) => session.status === 'running',
    ).length;
    provider.running = provider.runningCount > 0;
  }

  private publish(
    update:
      | { type: 'session.updated'; session: Session }
      | { type: 'message.upserted'; resourceId: string; message: Message },
  ) {
    this.workspace.sequence += 1;
    const resourceId =
      update.type === 'session.updated' ? update.session.resourceId : update.resourceId;
    const event: JamEvent = { protocolVersion: 1, cursor: this.cursor(), resourceId, ...update };
    this.pendingEvents.push(copy(event));
    if (this.publishing) return;
    this.publishing = true;
    // Reentrant commands from one listener must not reorder events for another.
    try {
      let next: JamEvent | undefined;
      while ((next = this.pendingEvents.shift())) {
        for (const listener of this.listeners) {
          if (
            listener.scope.resourceId === undefined ||
            listener.scope.resourceId === next.resourceId
          ) {
            try {
              listener.receive(copy(next));
            } catch {
              // A failed view listener must not cancel work or other views.
            }
          }
        }
      }
    } finally {
      this.publishing = false;
    }
  }
}
