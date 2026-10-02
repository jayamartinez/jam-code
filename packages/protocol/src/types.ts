import type { GitRequestMap } from './git';
/** JAM's wire version is independent of any provider's protocol version. */
export const PROTOCOL_VERSION = 1 as const;

export type Presentation = 'claude' | 'codex';
export type ProviderId = 'mock' | 'claude' | 'codex';
export type ResourceKind =
  'conversation' | 'terminal' | 'browser' | 'file' | 'file-browser' | 'diff' | 'settings';

import projectIconsJson from '../fixtures/project-icons.json';
import attachmentLimitsJson from '../fixtures/attachment-limits.json';
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
  /** The checked-out branch, read live; empty for a folder that is not in Git. */
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
  /** The first folder is gone or unreadable: moved, renamed or on a detached drive. */
  folderMissing?: boolean;
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
   * When the reader archived this thread (shown as Archived; the field keeps
   * its earlier name). Archiving is always explicit: JAM may suggest it for an
   * idle thread, but never archives one by itself. It changes nothing else:
   * the transcript, session, pin and worktree stay, and sending into an
   * archived thread reopens it.
   */
  closedAt?: string;
  /** When the reader last answered "Keep open" to an idle suggestion. */
  closeSuggestionDismissedAt?: string;
  /**
   * The JAM worktree this resource works in; absent means the project's own
   * folder. Set by the runtime: a chat started in a new worktree, and the
   * Review, files and terminals opened from it.
   */
  worktreeId?: string;
}

/**
 * A worktree JAM created for a chat: its own branch and folder beside the
 * repository, so chats working in parallel never edit the same files. JAM
 * records it and never deletes it.
 */
export interface Worktree {
  id: string;
  projectId: string;
  branch: string;
  /** The branch it started from. */
  baseBranch: string;
  /** Its folder, for display. Requests address a worktree by ID. */
  path: string;
  createdAt: string;
}

/** Where a new chat works, applied on its first Send and never before. */
export type NewWorkspace =
  /** The project's checkout, switched to `branch` first when it differs and nothing would be lost. */
  | { kind: 'checkout'; branch?: string }
  /**
   * A new `jam/<name>` branch and folder from `baseBranch` (absent: the
   * checkout's current branch); the runtime chooses the name and folder.
   */
  | { kind: 'worktree'; baseBranch?: string; nameHint: string };

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
    | 'snapshot'
    /** A file chosen outside the project, copied into the runtime's storage. */
    | 'attachment';
  label: string;
  source: {
    resourceId?: string;
    uri?: string;
    selection?: string;
  };
  /** Opaque runtime handle; binary assets never travel as local file permissions. */
  assetId?: string;
  /** What an attachment is, as the runtime recorded it when it was attached. */
  attachment?: AttachmentInfo;
}

/**
 * Display metadata for a file attached to a chat. The runtime sets it; a
 * client never does, and the file's original location is not part of it.
 */
export interface AttachmentInfo {
  name: string;
  mediaType: string;
  /**
   * Every attachment reaches the agent as a file it opens by path; an
   * `image` is also sent natively when the model accepts images.
   */
  kind: 'file' | 'image';
  /** The chosen file's size. */
  bytes: number;
}

/**
 * Attachment limits, shared with the Rust runtime through the same fixture
 * so the two can never accept different things.
 */
export const ATTACHMENT_LIMITS = attachmentLimitsJson as {
  filesPerPick: number;
  imageBytes: number;
  fileBytes: number;
  turnImageBytes: number;
  turnBytes: number;
  nameUtf16: number;
  unsentFiles: number;
  unsentHours: number;
};

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
  worktrees: Worktree[];
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
      /** Absent works in the current checkout as it is. */
      workspace?: NewWorkspace;
      /** A retried first Send returns the chat it already created. */
      requestId?: string;
    };
    result: {
      resource: Resource;
      session: Session;
      conversation: Conversation;
      /** The worktree the chat created, when it asked for one. */
      worktree?: Worktree;
    };
  };
  /**
   * Permanently removes JAM's own record of a conversation: its transcript,
   * session, provider binding, search entries and the snapshots sent in it.
   * Project files, Git branches and worktrees, and the provider's own history
   * are never touched. Refused (`conflict`) while its agent is working,
   * waiting for an answer or still stopping; a conversation that is already
   * gone is `not_found`.
   */
  'conversation.delete': { params: { resourceId: string }; result: { resourceId: string } };
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
  /**
   * Removes an attachment that was staged and not sent, with the runtime's
   * copy of it. One that was sent belongs to its conversation (`conflict`).
   */
  'attachment.remove': { params: { id: string }; result: { accepted: true } };
  /** An image attachment as a data URL, for its preview. */
  'attachment.asset': { params: { id: string }; result: { dataUrl: string } };
  'turn.interrupt': {
    params: { sessionId: string };
    result: { sessionId: string; interrupted: boolean };
  };
  'directory.list': {
    params: { projectId: string; path: string; worktreeId?: string };
    result: DirectoryListing;
  };
  'file.read': {
    params: { projectId: string; path: string; worktreeId?: string };
    result: FileContents;
  };
  /** Shows a project file in Finder or Explorer. */
  'file.reveal': {
    params: { projectId: string; path: string; worktreeId?: string };
    result: { revealed: true };
  };
  /** Opens a local address (localhost, 127.0.0.1) in the default browser. */
  'url.openExternal': { params: { url: string }; result: { opened: true } };
  'file.write': {
    params: { projectId: string; path: string; text: string };
    result: FileSaved;
  };
  /**
   * Adds a folder as a project. Adding a folder JAM already knows returns
   * that project (`existing`), restoring it if it was removed.
   */
  'project.create': {
    /** The first folder is the project's primary one. Name defaults to its folder's. */
    params: { paths: string[]; name?: string; icon?: ProjectIcon };
    result: { project: Project; existing: boolean };
  };
  /**
   * Removes JAM's reference to a project. Its folder is never touched, and
   * its conversations return if the folder is added again.
   */
  'project.remove': { params: { projectId: string }; result: { projectId: string } };
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
  /** Archives (`closed: true`) or reopens a thread. Refused while its agent works or waits. */
  'thread.setClosed': {
    params: { resourceId: string; closed: boolean };
    result: { resource: Resource };
  };
  'thread.keepOpen': { params: { resourceId: string }; result: { resource: Resource } };
  /** Pins a conversation to the sidebar's Pinned section, or unpins it. */
  'thread.setPinned': {
    params: { resourceId: string; pinned: boolean };
    result: { resource: Resource };
  };
  'resource.open': {
    /** `worktreeId` opens it in that JAM worktree (not for a browser). */
    params: { projectId: string; kind: OpenableKind; path?: string; worktreeId?: string };
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
