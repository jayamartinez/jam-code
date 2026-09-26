/** JAM's wire version is independent of any provider's protocol version. */
export const PROTOCOL_VERSION = 1 as const;

export type Presentation = 'claude' | 'codex';
export type ProviderId = 'mock' | 'claude' | 'codex';
export type ResourceKind =
  'conversation' | 'terminal' | 'browser' | 'file' | 'file-browser' | 'diff' | 'settings';

export interface Project {
  id: string;
  name: string;
  initials: string;
  branch: string;
}

/** Resources outlive their views. Closing a tab never destroys this record. */
export interface Resource {
  id: string;
  kind: ResourceKind;
  title: string;
  projectId?: string;
  sessionId?: string;
  pinned: boolean;
  updatedAt: string;
}

export interface Session {
  id: string;
  resourceId: string;
  providerId: ProviderId;
  presentation: Presentation;
  status: 'idle' | 'running' | 'interrupted' | 'failed';
  model: string;
}

export type ProviderCapability =
  | 'create'
  | 'resume'
  | 'fork'
  | 'interrupt'
  | 'streaming'
  | 'toolApproval'
  | 'userInput'
  | 'images'
  | 'steering';

export interface CapabilitySupport {
  status: 'supported' | 'unsupported' | 'unknown' | 'conditional';
  reason?: string;
}

/** These states are independent; installation is not proof of authentication. */
export interface ProviderDescriptor {
  id: ProviderId;
  name: string;
  installation: 'installed' | 'missing' | 'unknown' | 'builtin';
  authentication: 'authenticated' | 'unauthenticated' | 'unknown' | 'not-required';
  enabled: boolean;
  isDefault: boolean;
  running: boolean;
  capabilities: Record<ProviderCapability, CapabilitySupport>;
}

export interface ContextItem {
  id: string;
  kind:
    | 'file'
    | 'code'
    | 'diff'
    | 'browser-element'
    | 'browser-region'
    | 'terminal'
    | 'message'
    | 'snapshot';
  label: string;
  source: {
    resourceId?: string;
    uri?: string;
    selection?: string;
  };
  /** Opaque runtime handle; binary assets never travel as local file permissions. */
  assetId?: string;
}

export interface FileChange {
  path: string;
  added: number;
  removed: number;
}

export type MessageBlock =
  | { type: 'text'; text: string }
  | {
      type: 'tool';
      id: string;
      kind: 'read' | 'search' | 'edit' | 'command';
      title: string;
      detail: string;
      status: 'running' | 'completed' | 'failed';
      files?: FileChange[];
    }
  | { type: 'context'; items: ContextItem[] };

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  createdAt: string;
  blocks: MessageBlock[];
}

export interface Cursor {
  runtimeId: string;
  sequence: number;
}

export interface Conversation {
  resourceId: string;
  sessionId: string;
  messages: Message[];
  cursor: Cursor;
}

export interface WorkspaceSnapshot extends Cursor {
  protocolVersion: typeof PROTOCOL_VERSION;
  projects: Project[];
  resources: Resource[];
  sessions: Session[];
  providers: ProviderDescriptor[];
}

export interface SearchResult {
  resourceId: string;
  title: string;
  projectId: string;
  providerId: ProviderId;
  presentation: Presentation;
  pinned: boolean;
  snippet: string;
  updatedAt: string;
}

export interface RequestMap {
  'workspace.get': { params: Record<string, never>; result: WorkspaceSnapshot };
  'conversation.get': { params: { resourceId: string }; result: Conversation };
  'conversation.create': {
    params: { projectId: string; presentation: Presentation };
    result: { resource: Resource; session: Session; conversation: Conversation };
  };
  'turn.start': {
    params: { resourceId: string; text: string; context: ContextItem[]; requestId: string };
    result: { accepted: true; sessionId: string; requestId: string };
  };
  'turn.interrupt': {
    params: { sessionId: string };
    result: { sessionId: string; interrupted: boolean };
  };
  'search.query': {
    params: { query: string; projectId?: string; providerId?: ProviderId; pinned?: boolean };
    result: { results: SearchResult[] };
  };
}

export type RequestMethod = keyof RequestMap;
export type JamRequest = {
  [M in RequestMethod]: {
    protocolVersion: typeof PROTOCOL_VERSION;
    method: M;
    params: RequestMap[M]['params'];
  };
}[RequestMethod];

type EventEnvelope = {
  protocolVersion: typeof PROTOCOL_VERSION;
  cursor: Cursor;
  resourceId: string;
};

export type JamEvent = EventEnvelope &
  ({ type: 'message.upserted'; message: Message } | { type: 'session.updated'; session: Session });

export interface SubscriptionScope {
  resourceId?: string;
}

export interface JamTransport {
  request<M extends RequestMethod>(
    method: M,
    params: RequestMap[M]['params'],
  ): Promise<RequestMap[M]['result']>;
  subscribe(scope: SubscriptionScope, listener: (event: JamEvent) => void): Promise<() => void>;
}

export interface DemoFixture {
  workspace: WorkspaceSnapshot;
  conversations: Conversation[];
}
