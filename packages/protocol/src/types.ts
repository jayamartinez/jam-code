import type { GitRequestMap } from './git';
/** JAM's wire version is independent of any provider's protocol version. */
export const PROTOCOL_VERSION = 1 as const;

export type Presentation = 'claude' | 'codex';
export type ProviderId = 'mock' | 'claude' | 'codex';
export type ResourceKind =
  'conversation' | 'terminal' | 'browser' | 'file' | 'file-browser' | 'diff' | 'settings';

import projectIconsJson from '../fixtures/project-icons.json';
import type { TerminalAttachment, TerminalRequestMap, TerminalStreamEvent } from './terminal';
import type { AppearanceRequestMap } from './appearance';
import type { SnapshotRequestMap } from './snapshots';

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
   * Local folders; the first selects Git review and read-only files.
   * A future remote host must authorize project access separately.
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
  /** A display label: the provider-reported model, or its default when unknown. */
  model: string;
  /**
   * Provider-specific choices for this session, keyed by `ProviderOption.id`
   * plus `model` and `effort`. Values come from the provider's descriptor.
   */
  options?: Record<string, string>;
  /** True while an approval or question in this session waits for the reader. */
  needsInput?: boolean;
  /** The last provider-reported usage. Values are the provider's own counts. */
  usage?: SessionUsage;
}

export interface SessionUsage {
  /** Tokens the provider reports as currently occupying the context window. */
  contextTokens?: number;
  contextWindow?: number;
  /** Cumulative for the session as reported by the provider, when it does so. */
  inputTokens?: number;
  outputTokens?: number;
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
  | 'steering'
  | 'queue'
  | 'modelSelection'
  | 'effort'
  | 'permissionModes'
  | 'usage'
  | 'compact';

export const PROVIDER_CAPABILITIES = [
  'create',
  'resume',
  'fork',
  'interrupt',
  'streaming',
  'toolApproval',
  'userInput',
  'images',
  'steering',
  'queue',
  'modelSelection',
  'effort',
  'permissionModes',
  'usage',
  'compact',
] as const satisfies readonly ProviderCapability[];

export interface CapabilitySupport {
  status: 'supported' | 'unsupported' | 'unknown' | 'conditional';
  reason?: string;
}

/** A model the provider itself reported. Never a hardcoded marketing list. */
export interface ProviderModel {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
  /** Reasoning effort values this model accepts, as the provider names them. */
  efforts?: string[];
  defaultEffort?: string;
  /**
   * Faster speeds this model offers besides standard, as the provider names
   * them; chosen through the `speed` option.
   */
  speeds?: { value: string; label: string; description?: string }[];
  /** An older version the provider has superseded; shown under Legacy. */
  legacy?: boolean;
  /** Whether the provider says this model accepts image input. */
  images?: 'supported' | 'unsupported' | 'unknown';
}

/**
 * One provider-specific setting (a permission mode, a sandbox). Values and
 * their meaning are the provider's own; JAM never maps one provider's
 * policy onto another's.
 */
export interface ProviderOption {
  id: string;
  label: string;
  description?: string;
  values: { value: string; label: string; description?: string }[];
  default: string;
}

/** These states are independent; installation is not proof of authentication. */
/**
 * The signed-in account as the provider's own CLI reports it. Each field is
 * absent when the provider did not report it. `identity` (usually an email)
 * is personal: it lives only in the runtime's live descriptor, is never
 * persisted or logged, and the client keeps it hidden until revealed.
 */
export interface ProviderAccount {
  /** How the CLI signed in, such as "Claude account" or "ChatGPT". */
  method?: string;
  /** The subscription's full name, such as "Claude Max" or "ChatGPT Pro 5x". */
  plan?: string;
  /** Who is signed in, such as an email address. */
  identity?: string;
}

export interface ProviderDescriptor {
  id: ProviderId;
  name: string;
  installation: 'installed' | 'missing' | 'unknown' | 'builtin';
  authentication: 'authenticated' | 'unauthenticated' | 'unknown' | 'not-required';
  enabled: boolean;
  isDefault: boolean;
  running: boolean;
  capabilities: Record<ProviderCapability, CapabilitySupport>;
  /** Sessions currently running a turn. */
  runningCount?: number;
  /** The installed CLI's version, as it reports it. */
  version?: string;
  /** Resolved executable, for display. */
  executable?: string;
  /** How the executable was chosen. */
  executableSource?: 'detected' | 'override';
  /** The override saved in Settings, when there is one. */
  executableOverride?: string;
  /** A problem or note from the last check, such as an untested version. */
  status?: { tone: 'info' | 'warning' | 'error'; message: string };
  /** Only what the provider itself reports; absent means unknown. */
  account?: ProviderAccount;
  models?: ProviderModel[];
  options?: ProviderOption[];
  /** Saved defaults for new chats, keyed like `Session.options`. */
  defaults?: Record<string, string>;
  /** Model IDs the reader starred, first in the model picker. */
  favoriteModels?: string[];
  /** Model IDs the reader hid from the model picker. */
  hiddenModels?: string[];
  /** When JAM last asked the provider. Absent means not checked yet. */
  checkedAt?: string;
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
  /**
   * A bounded preview of the changed lines, each prefixed with `+`, `-`,
   * ` ` (context) or `@` (a gap between hunks).
   */
  diff?: string;
}

export type ToolKind = 'read' | 'search' | 'edit' | 'command' | 'tool' | 'web' | 'agent';

export interface InteractionChoice {
  id: string;
  label: string;
  /** How the choice is drawn. Semantics stay with the provider. */
  tone: 'allow' | 'deny' | 'neutral';
}

export interface InteractionQuestion {
  id: string;
  header?: string;
  question: string;
  options: { label: string; description?: string }[];
  multiSelect: boolean;
  /** Whether a free-text answer is accepted in addition to the options. */
  allowOther: boolean;
}

/**
 * A provider asking the reader: a tool permission or a question. It has its
 * own JAM ID; the provider's request ID never leaves the runtime. Choices are
 * exactly those the provider offers for this request.
 */
export interface Interaction {
  id: string;
  kind: 'command' | 'file-change' | 'tool' | 'question' | 'plan';
  title: string;
  detail?: string;
  reason?: string;
  choices: InteractionChoice[];
  questions?: InteractionQuestion[];
  /**
   * `expired` means the provider can no longer receive an answer (it exited
   * or JAM restarted); `cancelled` means the turn was interrupted or the
   * provider withdrew the request.
   */
  status: 'pending' | 'resolved' | 'cancelled' | 'expired';
  /** What was answered, for the transcript. */
  outcome?: string;
  /** The tool block this request is about; the approval is shown inside it. */
  toolId?: string;
}

export type MessageBlock =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | {
      type: 'tool';
      id: string;
      kind: ToolKind;
      title: string;
      detail: string;
      status: 'running' | 'completed' | 'failed';
      files?: FileChange[];
    }
  | { type: 'context'; items: ContextItem[] }
  | { type: 'interaction'; interaction: Interaction }
  | { type: 'notice'; tone: 'info' | 'warning' | 'error'; text: string };

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  createdAt: string;
  blocks: MessageBlock[];
  /** When the turn that wrote an assistant message ended. */
  completedAt?: string;
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

export interface RequestMap
  extends TerminalRequestMap, GitRequestMap, AppearanceRequestMap, SnapshotRequestMap {
  'workspace.get': { params: Record<string, never>; result: WorkspaceSnapshot };
  'conversation.get': { params: { resourceId: string }; result: Conversation };
  'conversation.create': {
    params: {
      projectId: string;
      presentation: Presentation;
      /** The adapter that runs it. Absent means the demo provider. */
      providerId?: ProviderId;
      options?: Record<string, string>;
    };
    result: { resource: Resource; session: Session; conversation: Conversation };
  };
  'turn.start': {
    params: {
      resourceId: string;
      text: string;
      context: ContextItem[];
      requestId: string;
      /**
       * The chat's complete model/effort/speed/provider options from this
       * turn on, replacing the saved ones; absent keeps them.
       */
      options?: Record<string, string>;
    };
    result: { accepted: true; sessionId: string; requestId: string };
  };
  'session.compact': {
    /** Asks the provider to compact this conversation's context. */
    params: { resourceId: string; requestId: string };
    result: { accepted: true; sessionId: string; requestId: string };
  };
  'provider.list': {
    /** `refresh` asks every provider again; otherwise the last check is reused. */
    params: { refresh?: boolean };
    result: { providers: ProviderDescriptor[] };
  };
  'provider.configure': {
    params: {
      providerId: ProviderId;
      enabled?: boolean;
      isDefault?: boolean;
      /** An executable path; the empty string returns to automatic detection. */
      executable?: string;
      defaults?: Record<string, string>;
      /** Replaces the starred model IDs. */
      favoriteModels?: string[];
      /** Replaces the hidden model IDs. */
      hiddenModels?: string[];
    };
    result: { providers: ProviderDescriptor[] };
  };
  'interaction.respond': {
    params: {
      resourceId: string;
      interactionId: string;
      choiceId?: string;
      /** Question ID to the chosen option labels or free text. */
      answers?: Record<string, string[]>;
    };
    result: { accepted: true };
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
  /** Shows a project file in Finder or Explorer. */
  'file.reveal': { params: { projectId: string; path: string }; result: { revealed: true } };
  /** Opens a local address (localhost, 127.0.0.1) in the default browser. */
  'url.openExternal': { params: { url: string }; result: { opened: true } };
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
