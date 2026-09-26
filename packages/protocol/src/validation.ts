import { JamError } from './errors';
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

const cursor: Check = (value) => shape(value, { runtimeId: id, sequence: integer });
const project: Check = (value) =>
  shape(value, { id, name: text(256), initials: text(8), branch: text(256) });
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
    { projectId: id, sessionId: id },
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

const params: Record<RequestMethod, Check> = {
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
  'search.query': (value) =>
    shape(value, { query: text(256, true) }, { projectId: id, providerId, pinned: boolean }),
};

const responses: Record<RequestMethod, Check> = {
  'workspace.get': workspace,
  'conversation.get': conversation,
  'conversation.create': (value) => shape(value, { resource, session, conversation }),
  'turn.start': (value) => shape(value, { accepted: oneOf(true), sessionId: id, requestId: id }),
  'turn.interrupt': (value) => shape(value, { sessionId: id, interrupted: boolean }),
  'search.query': (value) => shape(value, { results: array(searchResult, 50) }),
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
