import fixtureJson from '../fixtures/workspace.json';
import { JamError } from './errors';
import { listPreviewDirectory, readPreviewFile, writePreviewFile } from './preview-files';
import { searchPreview } from './preview-search';
import type {
  Conversation,
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
import { validateFixture, validateRequest, validateResponse, validateScope } from './validation';

type Listener = { scope: SubscriptionScope; receive: (event: JamEvent) => void };
type ActiveTurn = { timer: ReturnType<typeof setTimeout>; message: Message; fail: boolean };
type Receipt = { signature: string; result: RequestMap['turn.start']['result'] };

const copy = <T>(value: T): T => structuredClone(value);
const now = () => new Date().toISOString();
/** Mirrors the runtime: first letters of the first two words, else two letters. */
export const initialsOf = (name: string) => {
  const words = name.split(/[\s._-]+/).filter(Boolean);
  const letters =
    words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : (words[0] ?? '').slice(0, 2);
  return (letters || '··').toUpperCase();
};

/**
 * Explicit development-only, volatile runtime substitute. Never select this as
 * a fallback for failed native IPC. It performs no IO and owns no real process.
 */
export class BrowserPreviewTransport implements JamTransport {
  private readonly workspace: WorkspaceSnapshot;
  private readonly conversations: Map<string, Conversation>;
  private readonly listeners = new Set<Listener>();
  private readonly active = new Map<string, ActiveTurn>();
  private readonly receipts = new Map<string, Receipt>();
  private readonly pendingEvents: JamEvent[] = [];
  private publishing = false;
  private nextId = 0;

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

  private dispatch(request: JamRequest): RequestMap[RequestMethod]['result'] {
    switch (request.method) {
      case 'workspace.get':
        return this.workspace;
      case 'conversation.get':
        return { ...this.getConversation(request.params.resourceId), cursor: this.cursor() };
      case 'conversation.create':
        return this.createConversation(request.params);
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
    // Fail before creating a record if the target cannot be read.
    if (params.kind === 'file') readPreviewFile(params.projectId, params.path ?? '');
    // Each browser is its own page with its own history, so opening one never
    // returns another; every other target keeps one identity.
    const existing = this.workspace.resources.find(
      (resource) =>
        params.kind !== 'browser' &&
        resource.kind === params.kind &&
        resource.projectId === params.projectId &&
        resource.path === params.path,
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

  private createConversation(
    params: RequestMap['conversation.create']['params'],
  ): RequestMap['conversation.create']['result'] {
    if (!this.workspace.projects.some((project) => project.id === params.projectId)) {
      throw new JamError('not_found', 'Project not found.');
    }
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
    if (provider)
      provider.running = this.workspace.sessions.some((session) => session.status === 'running');
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
