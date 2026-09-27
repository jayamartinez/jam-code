import { JamError } from './errors';
import { OPENABLE_KINDS, PROJECT_ICONS } from './types';
import { TERMINAL_LIMITS } from './terminal';
import type { TerminalStreamEvent } from './terminal';
import type {
  DemoFixture,
  JamEvent,
  JamRequest,
  RequestMap,
  RequestMethod,
  SubscriptionScope,
} from './types';

type ObjectValue = Record<string, unknown>;
type Check = (value: unknown) => void;

const invalid = (message: string): never => {
  throw new JamError('invalid_request', message);
};

function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid('Expected a JSON object.');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid('Expected a plain JSON object.');
  }
  return value as ObjectValue;
}

function shape(
  value: unknown,
  required: Record<string, Check>,
  optional: Record<string, Check> = {},
) {
  const record = object(value);
  for (const key of Object.keys(record)) {
    if (!Object.hasOwn(required, key) && !Object.hasOwn(optional, key))
      invalid(`Unexpected field: ${key}.`);
  }
  for (const [key, check] of Object.entries(required)) check(record[key]);
  for (const [key, check] of Object.entries(optional)) {
    if (record[key] !== undefined) check(record[key]);
  }
}

function text(max: number, allowEmpty = false): Check {
  return (value) => {
    if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) {
      invalid(`Expected ${allowEmpty ? '' : 'nonempty '}text of at most ${max} characters.`);
    }
  };
}

function oneOf(...values: readonly unknown[]): Check {
  return (value) => {
    if (!values.includes(value)) invalid('Unsupported field value.');
  };
}

function array(check: Check, max = 10_000): Check {
  return (value) => {
    if (!Array.isArray(value) || value.length > max)
      invalid(`Expected an array of at most ${max} items.`);
    (value as unknown[]).forEach(check);
  };
}

const id = text(128);
const boolean: Check = (value) => {
  if (typeof value !== 'boolean') invalid('Expected a boolean.');
};
const integer: Check = (value) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    invalid('Expected a nonnegative safe integer.');
  }
};
const timestamp: Check = (value) => {
  text(40)(value);
  if (!Number.isFinite(Date.parse(value as string))) invalid('Expected a timestamp.');
};
const presentation = oneOf('claude', 'codex');
const providerId = oneOf('mock', 'claude', 'codex');

/** Project-relative only: a client may never address a location by escape. */
const relativePath: Check = (value) => {
  text(512)(value);
  const candidate = value as string;
  if (
    candidate.startsWith('/') ||
    candidate.startsWith('\\') ||
    candidate.includes('//') ||
    candidate.includes('\0') ||
    candidate.split('/').some((segment) => segment === '..' || segment === '.')
  ) {
    invalid('Paths must be project-relative and must not contain relative segments.');
  }
};
const listingPath: Check = (value) => {
  if (value === '') return;
  relativePath(value);
};
const fileStatus = oneOf('added', 'modified', 'deleted', 'untracked');

const cursor: Check = (value) => shape(value, { runtimeId: id, sequence: integer });
const { limits: iconLimits } = PROJECT_ICONS;
const projectIcon: Check = (value) => {
  shape(
    value,
    { kind: oneOf('initials', 'preset', 'emoji', 'image') },
    { value: text(iconLimits.imageUtf16), tone: oneOf(...PROJECT_ICONS.tones) },
  );
  const record = object(value);
  const content = record.value as string | undefined;
  switch (record.kind) {
    case 'initials':
      if (content !== undefined) invalid('An initials icon carries no value.');
      break;
    case 'preset':
      if (!PROJECT_ICONS.presets.includes(content ?? '')) invalid('Unknown project icon preset.');
      break;
    case 'emoji':
      // A few code points, never markup or a sentence.
      if (!content || content.length > iconLimits.emojiUtf16 || /[<>\s]/.test(content))
        invalid('An emoji icon must be a short emoji.');
      break;
    case 'image':
      if (!content?.startsWith('data:image/'))
        invalid('A project image must be inline image data.');
      break;
  }
};
/** Absolute on macOS/Linux (`/`, `~/`) or Windows (`C:\`, `\\server`). */
const projectPath: Check = (value) => {
  text(iconLimits.pathUtf16)(value);
  if (!/^(\/|~\/|[A-Za-z]:[\\/]|\\\\)/.test(value as string))
    invalid('A project path must be an absolute folder path.');
};
const project: Check = (value) =>
  shape(
    value,
    { id, name: text(256), initials: text(8), branch: text(256) },
    { icon: projectIcon, paths: array(projectPath, iconLimits.paths), pinned: boolean },
  );
const resource: Check = (value) =>
  shape(
    value,
    {
      id,
      kind: oneOf(
        'conversation',
        'terminal',
        'browser',
        'file',
        'file-browser',
        'diff',
        'settings',
      ),
      title: text(512),
      pinned: boolean,
      updatedAt: timestamp,
    },
    {
      projectId: id,
      sessionId: id,
      path: relativePath,
      closedAt: timestamp,
      closeSuggestionDismissedAt: timestamp,
    },
  );
const session: Check = (value) =>
  shape(value, {
    id,
    resourceId: id,
    providerId,
    presentation,
    status: oneOf('idle', 'running', 'interrupted', 'failed'),
    model: text(256),
  });

const support: Check = (value) =>
  shape(
    value,
    { status: oneOf('supported', 'unsupported', 'unknown', 'conditional') },
    { reason: text(2048) },
  );
const provider: Check = (value) =>
  shape(value, {
    id: providerId,
    name: text(256),
    installation: oneOf('installed', 'missing', 'unknown', 'builtin'),
    authentication: oneOf('authenticated', 'unauthenticated', 'unknown', 'not-required'),
    enabled: boolean,
    isDefault: boolean,
    running: boolean,
    capabilities: (capabilities) =>
      shape(capabilities, {
        create: support,
        resume: support,
        fork: support,
        interrupt: support,
        streaming: support,
        toolApproval: support,
        userInput: support,
        images: support,
        steering: support,
      }),
  });

const context: Check = (value) =>
  shape(
    value,
    {
      id,
      kind: oneOf(
        'file',
        'code',
        'diff',
        'browser-element',
        'browser-region',
        'terminal',
        'message',
        'snapshot',
      ),
      label: text(512),
      source: (source) =>
        shape(source, {}, { resourceId: id, uri: text(4096), selection: text(20_000) }),
    },
    { assetId: id },
  );

const fileChange: Check = (value) =>
  shape(value, { path: text(4096), added: integer, removed: integer });
const block: Check = (value) => {
  const record = object(value);
  switch (record.type) {
    case 'text':
      return shape(value, { type: oneOf('text'), text: text(200_000, true) });
    case 'context':
      return shape(value, { type: oneOf('context'), items: array(context, 16) });
    case 'tool':
      return shape(
        value,
        {
          type: oneOf('tool'),
          id,
          kind: oneOf('read', 'search', 'edit', 'command'),
          title: text(512),
          detail: text(100_000, true),
          status: oneOf('running', 'completed', 'failed'),
        },
        { files: array(fileChange, 1000) },
      );
    default:
      return invalid('Unknown message block.');
  }
};

const message: Check = (value) =>
  shape(value, {
    id,
    role: oneOf('user', 'assistant'),
    createdAt: timestamp,
    blocks: array(block, 1000),
  });
const conversation: Check = (value) =>
  shape(value, { resourceId: id, sessionId: id, messages: array(message), cursor });
const workspace: Check = (value) =>
  shape(value, {
    protocolVersion: oneOf(1),
    runtimeId: id,
    sequence: integer,
    projects: array(project),
    resources: array(resource),
    sessions: array(session),
    providers: array(provider, 20),
  });
const searchResult: Check = (value) =>
  shape(value, {
    resourceId: id,
    title: text(512),
    projectId: id,
    providerId,
    presentation,
    pinned: boolean,
    snippet: text(4096, true),
    updatedAt: timestamp,
  });

const directoryEntry: Check = (value) =>
  shape(
    value,
    { name: text(512), path: relativePath, kind: oneOf('file', 'directory') },
    { status: fileStatus, hasChildren: boolean },
  );
const directoryListing: Check = (value) =>
  shape(value, {
    projectId: id,
    path: listingPath,
    entries: array(directoryEntry, 500),
    truncated: boolean,
    demo: boolean,
  });
const fileContents: Check = (value) =>
  shape(
    value,
    {
      projectId: id,
      path: relativePath,
      language: text(64),
      text: text(2_000_000, true),
      truncated: boolean,
      writable: boolean,
      demo: boolean,
    },
    { status: fileStatus },
  );

const fileSaved: Check = (value) =>
  shape(value, { projectId: id, path: relativePath, savedAt: timestamp });

function range(min: number, max: number): Check {
  return (value) => {
    integer(value);
    if ((value as number) < min || (value as number) > max)
      invalid(`Expected a whole number from ${min} to ${max}.`);
  };
}
const columns = range(TERMINAL_LIMITS.minCols, TERMINAL_LIMITS.maxCols);
const lines = range(TERMINAL_LIMITS.minRows, TERMINAL_LIMITS.maxRows);
/** Terminal output is arbitrary text, including control sequences. */
const output = (max: number): Check => text(max, true);
const terminalSession: Check = (value) =>
  shape(
    value,
    {
      id,
      resourceId: id,
      projectId: id,
      cwd: text(4096),
      cwdLabel: text(4096),
      cwdSource: oneOf('project', 'requested', 'home'),
      shell: text(256),
      title: text(512),
      status: oneOf('running', 'exited'),
      createdAt: timestamp,
      cols: columns,
      rows: lines,
    },
    { exitCode: integer, exitSignal: text(256), endedAt: timestamp, terminated: oneOf(true) },
  );
const accepted: Check = (value) => shape(value, { accepted: oneOf(true) });

const nullableId: Check = (value) => {
  if (value !== null) id(value);
};
const snapshotSettings: Check = (value) =>
  shape(value, {
    enabled: boolean,
    shortcut: (shortcut) => {
      if (object(shortcut).kind === 'doubleShift') shape(shortcut, { kind: oneOf('doubleShift') });
      else shape(shortcut, { kind: oneOf('keyCombination'), accelerator: text(128) });
    },
    captureMode: oneOf('activeWindow', 'region', 'fullScreen'),
    afterCapture: oneOf('stage', 'save', 'clipboard'),
    flash: boolean,
    sound: boolean,
    toast: boolean,
    copyToClipboard: boolean,
    retentionDays: oneOf(1, 7, 30),
  });
const snapshot: Check = (value) =>
  shape(value, {
    id,
    capturedAt: integer,
    application: text(256, true),
    windowTitle: text(512, true),
    width: range(1, 4096),
    height: range(1, 4096),
    bytes: range(1, 9_000_000),
    resourceId: nullableId,
    note: text(2000, true),
    sent: boolean,
    context,
  });

const params: Record<RequestMethod, Check> = {
  'snapshot.list': (v) => shape(v, {}),
  'snapshot.settings.get': (v) => shape(v, {}),
  'snapshot.settings.update': snapshotSettings,
  'snapshot.focus': (v) => shape(v, { resourceId: id }),
  'snapshot.stage': (v) => shape(v, { id, resourceId: nullableId, note: text(2000, true) }),
  'snapshot.remove': (v) => shape(v, { id }),
  'snapshot.asset': (v) => shape(v, { id, thumbnail: boolean }),
  'snapshot.cleanup': (v) => shape(v, { all: boolean }),
  'workspace.get': (value) => shape(value, {}),
  'conversation.get': (value) => shape(value, { resourceId: id }),
  'conversation.create': (value) => shape(value, { projectId: id, presentation }),
  'turn.start': (value) => {
    shape(value, {
      resourceId: id,
      text: text(20_000, true),
      context: array(context, 16),
      requestId: id,
    });
    const record = object(value);
    if (!(record.text as string).trim() && !(record.context as unknown[]).length) {
      invalid('A turn needs text or staged context.');
    }
  },
  'turn.interrupt': (value) => shape(value, { sessionId: id }),
  'directory.list': (value) => shape(value, { projectId: id, path: listingPath }),
  'file.read': (value) => shape(value, { projectId: id, path: relativePath }),
  'file.write': (value) =>
    shape(value, { projectId: id, path: relativePath, text: text(2_000_000, true) }),
  'project.update': (value) =>
    shape(
      value,
      { projectId: id },
      {
        name: text(iconLimits.nameUtf16),
        paths: array(projectPath, iconLimits.paths),
        icon: projectIcon,
        pinned: boolean,
      },
    ),
  'thread.setClosed': (value) => shape(value, { resourceId: id, closed: boolean }),
  'thread.keepOpen': (value) => shape(value, { resourceId: id }),
  'resource.open': (value) => {
    shape(value, { projectId: id, kind: oneOf(...OPENABLE_KINDS) }, { path: relativePath });
    const record = object(value);
    if ((record.kind === 'file') !== (record.path !== undefined))
      invalid('Only a file resource is opened by path, and it requires one.');
  },
  'search.query': (value) =>
    shape(value, { query: text(256, true) }, { projectId: id, providerId, pinned: boolean }),
  'terminal.create': (value) =>
    shape(value, { projectId: id }, { cwd: text(4096), cols: columns, rows: lines }),
  'terminal.start': (value) => shape(value, { resourceId: id }, { cols: columns, rows: lines }),
  'terminal.get': (value) => shape(value, { resourceId: id }),
  'terminal.list': (value) => shape(value, {}, { projectId: id }),
  'terminal.input': (value) =>
    shape(value, {
      resourceId: id,
      data: (data) => {
        if (typeof data !== 'string' || !data.length || data.length > TERMINAL_LIMITS.inputUtf16)
          invalid(`Terminal input must be 1 to ${TERMINAL_LIMITS.inputUtf16} characters.`);
      },
    }),
  'terminal.resize': (value) => shape(value, { resourceId: id, cols: columns, rows: lines }),
  'terminal.kill': (value) => shape(value, { resourceId: id }),
  'terminal.ack': (value) => shape(value, { attachmentId: id, seq: integer }),
};

const responses: Record<RequestMethod, Check> = {
  'snapshot.list': (v) => shape(v, { snapshots: array(snapshot, 500) }),
  'snapshot.settings.get': snapshotSettings,
  'snapshot.settings.update': snapshotSettings,
  'snapshot.focus': accepted,
  'snapshot.stage': snapshot,
  'snapshot.remove': accepted,
  'snapshot.asset': (v) =>
    shape(v, {
      dataUrl: (data) => {
        text(12_000_000)(data);
        if (!(data as string).startsWith('data:image/jpeg;base64,'))
          invalid('Invalid snapshot image.');
      },
    }),
  'snapshot.cleanup': (v) => shape(v, { removed: integer }),
  'workspace.get': workspace,
  'conversation.get': conversation,
  'conversation.create': (value) => shape(value, { resource, session, conversation }),
  'turn.start': (value) => shape(value, { accepted: oneOf(true), sessionId: id, requestId: id }),
  'turn.interrupt': (value) => shape(value, { sessionId: id, interrupted: boolean }),
  'directory.list': directoryListing,
  'file.read': fileContents,
  'file.write': fileSaved,
  'project.update': (value) => shape(value, { project }),
  'thread.setClosed': (value) => shape(value, { resource }),
  'thread.keepOpen': (value) => shape(value, { resource }),
  'resource.open': (value) => shape(value, { resource }),
  'search.query': (value) => shape(value, { results: array(searchResult, 50) }),
  'terminal.create': (value) => shape(value, { resource, terminal: terminalSession }),
  'terminal.start': (value) => shape(value, { terminal: terminalSession }),
  'terminal.get': (value) => shape(value, {}, { terminal: terminalSession }),
  'terminal.list': (value) => shape(value, { terminals: array(terminalSession, 64) }),
  'terminal.input': accepted,
  'terminal.resize': (value) => shape(value, { terminal: terminalSession }),
  'terminal.kill': (value) => shape(value, { terminal: terminalSession }),
  'terminal.ack': accepted,
};

/** Validate unknown input at a transport boundary before any mutation. */
export function validateRequest(value: unknown): JamRequest {
  const record = object(value);
  if (record.protocolVersion !== 1)
    throw new JamError('unsupported_version', 'Unsupported JAM protocol version.');
  if (typeof record.method !== 'string' || !Object.hasOwn(params, record.method)) {
    throw new JamError('unknown_method', 'Unknown JAM request method.');
  }
  const method = record.method as RequestMethod;
  shape(value, { protocolVersion: oneOf(1), method: oneOf(method), params: params[method] });
  return value as JamRequest;
}

/** Native IPC and a future remote client both validate received data. */
export function validateResponse<M extends RequestMethod>(
  method: M,
  value: unknown,
): RequestMap[M]['result'] {
  try {
    responses[method](value);
    return value as RequestMap[M]['result'];
  } catch {
    throw new JamError('invalid_response', `Invalid response to ${method}.`);
  }
}

export function validateEvent(value: unknown): JamEvent {
  try {
    const record = object(value);
    const envelope = { protocolVersion: oneOf(1), cursor, resourceId: id };
    if (record.type === 'message.upserted') {
      shape(value, { ...envelope, type: oneOf('message.upserted'), message });
    } else if (record.type === 'session.updated') {
      shape(value, { ...envelope, type: oneOf('session.updated'), session });
      if (object(record.session).resourceId !== record.resourceId)
        invalid('Mismatched event resource.');
    } else {
      invalid('Unknown JAM event.');
    }
    return value as JamEvent;
  } catch {
    throw new JamError('invalid_response', 'Invalid JAM event.');
  }
}

export function validateScope(value: unknown): SubscriptionScope {
  shape(value, {}, { resourceId: id });
  return value as SubscriptionScope;
}

export function validateFixture(value: unknown): DemoFixture {
  shape(value, { workspace, conversations: array(conversation) });
  return value as DemoFixture;
}

/** The runtime bounds replay and chunks; these limits only reject nonsense. */
export function validateTerminalEvent(value: unknown): TerminalStreamEvent {
  try {
    const record = object(value);
    switch (record.type) {
      case 'snapshot':
        shape(
          value,
          { type: oneOf('snapshot'), attachmentId: id, data: output(4_000_000) },
          { terminal: terminalSession },
        );
        break;
      case 'output':
        shape(value, { type: oneOf('output'), seq: integer, data: output(1_000_000) });
        break;
      case 'session':
        shape(value, { type: oneOf('session'), terminal: terminalSession });
        break;
      default:
        invalid('Unknown terminal event.');
    }
    return value as TerminalStreamEvent;
  } catch {
    throw new JamError('invalid_response', 'Invalid terminal event.');
  }
}
