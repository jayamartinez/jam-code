/** JAM's wire version is independent of any provider's protocol version. */
export const PROTOCOL_VERSION = 1 as const;

export type Presentation = 'claude' | 'codex';
export type ProviderId = 'mock' | 'claude' | 'codex';
export type ResourceKind =
  'conversation' | 'terminal' | 'browser' | 'file' | 'file-browser' | 'diff' | 'settings';

import projectIconsJson from '../fixtures/project-icons.json';
import type { TerminalAttachment, TerminalRequestMap, TerminalStreamEvent } from './terminal';

/**
 * Presets, tones and limits for project badges. Shared with the Rust runtime
 * through the same fixture so the two can never accept different values.
 */
export const PROJECT_ICONS = projectIconsJson as {
  presets: string[];
  tones: string[];
  limits: {
    imageUtf16: number;
    emojiUtf16: number;
    nameUtf16: number;
    paths: number;
    pathUtf16: number;
  };
};
export const PROJECT_ICON_PRESETS = PROJECT_ICONS.presets;
export const PROJECT_ICON_TONES = PROJECT_ICONS.tones;

export interface ProjectIcon {
  kind: 'initials' | 'preset' | 'emoji' | 'image';
  /** Preset name, emoji, or an image data URL the client already squared. */
  value?: string;
  /** Colour role for a preset or the initials. */
  tone?: string;
}

export interface Project {
  id: string;
  name: string;
  initials: string;
  branch: string;
  /** Absent means the project draws its initials. */
  icon?: ProjectIcon;
  /**
   * Local folders the user associates with this project. Recorded only: JAM
   * does not yet read from them, and a remote client must never treat them as
   * a grant to access paths on this machine.
   */
  paths?: string[];
  /** Pinned projects sort first in the sidebar. */
  pinned?: boolean;
}

/** Resources outlive their views. Closing a tab never destroys this record. */
export interface Resource {
  id: string;
  kind: ResourceKind;
  title: string;
  projectId?: string;
  sessionId?: string;
  /** Project-relative path for file resources. Never an absolute local path. */
  path?: string;
  pinned: boolean;
  updatedAt: string;
  /**
   * When the reader closed this thread. Closing is always explicit: JAM may
   * suggest it for an idle thread, but never closes one by itself. Sending
   * into a closed thread reopens it.
   */
  closedAt?: string;
  /** When the reader last answered "Keep open" to an idle suggestion. */
  closeSuggestionDismissedAt?: string;
}

/** Resource kinds a client may ask the runtime to open by target. */
export const OPENABLE_KINDS = [
  'file',
  'file-browser',
  'terminal',
  'browser',
  'diff',
] as const satisfies readonly ResourceKind[];
export type OpenableKind = (typeof OPENABLE_KINDS)[number];

export type FileStatus = 'added' | 'modified' | 'deleted' | 'untracked';

export interface DirectoryEntry {
  name: string;
  /** Project-relative. The runtime, not the client, resolves real locations. */
  path: string;
  kind: 'file' | 'directory';
  status?: FileStatus;
  hasChildren?: boolean;
}

/** One directory level, so a large repository is never shipped at once. */
export interface DirectoryListing {
  projectId: string;
  path: string;
  entries: DirectoryEntry[];
  truncated: boolean;
  /** True while the tree is the isolated demo workspace, not this computer. */
  demo: boolean;
}

export interface FileSaved {
  projectId: string;
  path: string;
  savedAt: string;
}

export interface FileContents {
  projectId: string;
  path: string;
  language: string;
  text: string;
  truncated: boolean;
  writable: boolean;
  status?: FileStatus;
  demo: boolean;
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

import type { SnapshotRequestMap } from './snapshots';

export interface RequestMap extends TerminalRequestMap, SnapshotRequestMap {
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
  'directory.list': {
    params: { projectId: string; path: string };
    result: DirectoryListing;
  };
  'file.read': { params: { projectId: string; path: string }; result: FileContents };
  'file.write': {
    params: { projectId: string; path: string; text: string };
    result: FileSaved;
  };
  'project.update': {
    params: {
      projectId: string;
      name?: string;
      paths?: string[];
      icon?: ProjectIcon;
      pinned?: boolean;
    };
    result: { project: Project };
  };
  'thread.setClosed': {
    params: { resourceId: string; closed: boolean };
    result: { resource: Resource };
  };
  'thread.keepOpen': { params: { resourceId: string }; result: { resource: Resource } };
  'resource.open': {
    params: { projectId: string; kind: OpenableKind; path?: string };
    result: { resource: Resource };
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
  /**
   * Streams one terminal to one view, separately from workspace events so
   * output never reaches anything but that view. The first event delivered to
   * `listener` is always the snapshot.
   */
  attachTerminal(
    resourceId: string,
    listener: (event: TerminalStreamEvent) => void,
  ): Promise<TerminalAttachment>;
}

export interface DemoFixture {
  workspace: WorkspaceSnapshot;
  conversations: Conversation[];
}
