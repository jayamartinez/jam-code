import { JamError } from './errors';
import { OPENABLE_KINDS, PROJECT_ICONS, PROVIDER_CAPABILITIES, SIDEBAR_SECTIONS } from './types';
import { TERMINAL_LIMITS } from './terminal';
import { SNAPSHOT_KEY_COMBINATIONS } from './snapshots';
import { HISTORY_LIST_LIMIT } from './history';
import {
  APPEARANCE,
  APPEARANCE_RANGES,
  FONT_FAMILY,
  HEX_COLOR,
  SURFACE_ROLES,
  WALLPAPER_PREFIX,
  appearanceThemeProblem,
} from './appearance';
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

/** Single-line text with no control characters, for provider-reported labels. */
function label(max: number): Check {
  const within = text(max);
  return (value) => {
    within(value);
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f-\u009f]/.test(value as string)) invalid('Expected plain text.');
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
  text(512, true)(value);
  const candidate = value as string;
  if (
    !candidate.length ||
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
/** A hand-arranged order of projects: bounded, and naming each one once. */
const projectOrder: Check = (value) => {
  array(id, 500)(value);
  if (new Set(value as unknown[]).size !== (value as unknown[]).length)
    invalid('A project order lists each project once.');
};
/** Every sidebar section, exactly once. */
const sidebarSections: Check = (value) => {
  array(oneOf(...SIDEBAR_SECTIONS), SIDEBAR_SECTIONS.length)(value);
  if (new Set(value as unknown[]).size !== SIDEBAR_SECTIONS.length)
    invalid('A sidebar order lists each section once.');
};
const project: Check = (value) =>
  shape(
    value,
    { id, name: text(256), initials: text(8), branch: text(256, true) },
    {
      icon: projectIcon,
      paths: array(projectPath, iconLimits.paths),
      pinned: boolean,
      folderMissing: boolean,
    },
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
      worktreeId: id,
    },
  );
const worktree: Check = (value) =>
  shape(value, {
    id,
    projectId: id,
    branch: text(256),
    baseBranch: text(256),
    path: text(16384),
    createdAt: timestamp,
  });
/**
 * JAM's own branch-name rules, the same as the runtime's: nothing that reads
 * as an option or uses Git's revision syntax. Git applies its own after.
 */
const branchName: Check = (value) => {
  text(200)(value);
  const name = value as string;
  if (
    /^[-/.]|[/.]$|\.lock$|\.\.|\/\/|@\{|\/\.|[\s\\~^:?*[]/.test(name) ||
    name === 'HEAD' ||
    [...name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    invalid('That is not a branch name JAM can use.');
};
const newWorkspace: Check = (value) => {
  const kind = object(value).kind;
  if (kind === 'checkout') shape(value, { kind: oneOf('checkout') }, { branch: branchName });
  else if (kind === 'existing') shape(value, { kind: oneOf('existing'), branch: branchName });
  else
    shape(
      value,
      { kind: oneOf('worktree'), nameHint: text(20_000, true) },
      { baseBranch: branchName },
    );
};
const moveWorkspace: Check = (value) => {
  const kind = object(value).kind;
  if (kind === 'branch') shape(value, { kind: oneOf('branch'), branch: branchName });
  else if (kind === 'checkout') shape(value, { kind: oneOf('checkout') });
  else
    shape(
      value,
      { kind: oneOf('worktree'), nameHint: text(20_000, true) },
      { baseBranch: branchName },
    );
};
/** Provider option choices: a few short keys and values, never free-form data. */
const optionKey = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const optionMap: Check = (value) => {
  const record = object(value);
  const keys = Object.keys(record);
  if (keys.length > 32) invalid('Too many provider options.');
  for (const key of keys) {
    if (!optionKey.test(key)) invalid('Invalid provider option name.');
    text(256)(record[key]);
  }
};
const usage: Check = (value) =>
  shape(
    value,
    {},
    { contextTokens: integer, contextWindow: integer, inputTokens: integer, outputTokens: integer },
  );
const session: Check = (value) =>
  shape(
    value,
    {
      id,
      resourceId: id,
      providerId,
      presentation,
      status: oneOf('idle', 'running', 'interrupted', 'failed'),
      model: text(256),
    },
    { options: optionMap, needsInput: boolean, usage },
  );

const support: Check = (value) =>
  shape(
    value,
    { status: oneOf('supported', 'unsupported', 'unknown', 'conditional') },
    { reason: text(2048) },
  );
const tristate = oneOf('supported', 'unsupported', 'unknown');
const modelIds: Check = (value) => array(text(256), 200)(value);
const providerModel: Check = (value) =>
  shape(
    value,
    { id: text(256), label: text(256) },
    {
      description: text(2048, true),
      isDefault: boolean,
      efforts: array(text(64), 16),
      defaultEffort: text(64),
      speeds: array(
        (speed) =>
          shape(speed, { value: text(64), label: text(256) }, { description: text(2048, true) }),
        8,
      ),
      legacy: boolean,
      images: tristate,
    },
  );
const providerOption: Check = (value) => {
  shape(
    value,
    {
      id: text(64),
      label: text(256),
      values: array(
        (choice) =>
          shape(choice, { value: text(256), label: text(256) }, { description: text(2048, true) }),
        32,
      ),
      default: text(256),
    },
    { description: text(2048, true) },
  );
  if (!optionKey.test(object(value).id as string)) invalid('Invalid provider option name.');
};
const provider: Check = (value) =>
  shape(
    value,
    {
      id: providerId,
      name: text(256),
      installation: oneOf('installed', 'missing', 'unknown', 'builtin'),
      authentication: oneOf('authenticated', 'unauthenticated', 'unknown', 'not-required'),
      enabled: boolean,
      isDefault: boolean,
      running: boolean,
      capabilities: (capabilities) =>
        shape(capabilities, Object.fromEntries(PROVIDER_CAPABILITIES.map((key) => [key, support]))),
    },
    {
      runningCount: integer,
      version: text(128),
      executable: text(4096),
      executableSource: oneOf('detected', 'override'),
      executableOverride: text(4096),
      status: (status) =>
        shape(status, { tone: oneOf('info', 'warning', 'error'), message: text(2048) }),
      account: (account) =>
        shape(account, {}, { method: label(128), plan: label(128), identity: label(256) }),
      models: array(providerModel, 200),
      options: array(providerOption, 16),
      defaults: optionMap,
      favoriteModels: modelIds,
      hiddenModels: modelIds,
      checkedAt: timestamp,
    },
  );

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
        'attachment',
      ),
      label: text(512),
      source: (source) =>
        shape(source, {}, { resourceId: id, uri: text(4096), selection: text(20_000) }),
    },
    {
      assetId: id,
      attachment: (value) =>
        shape(value, {
          name: text(512),
          mediaType: text(128),
          kind: oneOf('file', 'image'),
          bytes: integer,
        }),
    },
  );

const fileChange: Check = (value) =>
  shape(
    value,
    { path: text(4096), added: integer, removed: integer },
    { diff: text(16_000, true) },
  );
const interaction: Check = (value) =>
  shape(
    value,
    {
      id,
      kind: oneOf('command', 'file-change', 'tool', 'question', 'plan'),
      title: text(512),
      choices: array(
        (choice) =>
          shape(choice, {
            id: text(64),
            label: text(256),
            tone: oneOf('allow', 'deny', 'neutral'),
          }),
        8,
      ),
      status: oneOf('pending', 'resolved', 'cancelled', 'expired'),
    },
    {
      detail: text(100_000, true),
      reason: text(4096, true),
      outcome: text(4096, true),
      toolId: text(256),
      questions: array(
        (question) =>
          shape(
            question,
            {
              id: text(64),
              question: text(4096),
              options: array(
                (option) => shape(option, { label: text(512) }, { description: text(2048, true) }),
                16,
              ),
              multiSelect: boolean,
              allowOther: boolean,
            },
            { header: text(256, true) },
          ),
        8,
      ),
    },
  );
const block: Check = (value) => {
  const record = object(value);
  switch (record.type) {
    case 'text':
      return shape(value, { type: oneOf('text'), text: text(200_000, true) });
    case 'context':
      return shape(value, { type: oneOf('context'), items: array(context, 16) });
    case 'reasoning':
      return shape(value, { type: oneOf('reasoning'), text: text(200_000, true) });
    case 'tool':
      return shape(
        value,
        {
          type: oneOf('tool'),
          id: text(256),
          kind: oneOf('read', 'search', 'edit', 'command', 'tool', 'web', 'agent'),
          title: text(512),
          detail: text(100_000, true),
          status: oneOf('running', 'completed', 'failed'),
        },
        { files: array(fileChange, 1000) },
      );
    case 'interaction':
      return shape(value, { type: oneOf('interaction'), interaction });
    case 'notice':
      return shape(value, {
        type: oneOf('notice'),
        tone: oneOf('info', 'warning', 'error'),
        text: text(20_000),
      });
    default:
      return invalid('Unknown message block.');
  }
};

const message: Check = (value) =>
  shape(
    value,
    {
      id,
      role: oneOf('user', 'assistant'),
      createdAt: timestamp,
      blocks: array(block, 1000),
    },
    { completedAt: timestamp },
  );
const conversation: Check = (value) =>
  shape(value, { resourceId: id, sessionId: id, messages: array(message), cursor });
const workspace: Check = (value) =>
  shape(
    value,
    {
      protocolVersion: oneOf(1),
      runtimeId: id,
      sequence: integer,
      projects: array(project),
      resources: array(resource),
      sessions: array(session),
      providers: array(provider, 20),
      worktrees: array(worktree),
    },
    { sidebarSections },
  );
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
      cwdSource: oneOf('project', 'worktree', 'requested', 'home'),
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
      const kind = object(shortcut).kind;
      if (kind === 'bothShift') shape(shortcut, { kind: oneOf('bothShift') });
      else
        shape(shortcut, {
          kind: oneOf('keyCombination'),
          accelerator: oneOf(...SNAPSHOT_KEY_COMBINATIONS),
        });
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

const gitChange = oneOf(
  'none',
  'modified',
  'added',
  'deleted',
  'renamed',
  'copied',
  'type-changed',
  'unmerged',
  'untracked',
);
const gitSide = oneOf('staged', 'unstaged');
const gitFile: Check = (value) =>
  shape(
    value,
    {
      path: text(4096, true),
      staged: gitChange,
      workingTree: gitChange,
      untracked: boolean,
      conflict: boolean,
      submodule: boolean,
    },
    { previousPath: text(4096, true), filePath: relativePath },
  );
const gitStatus: Check = (value) =>
  shape(
    value,
    {
      projectId: id,
      state: oneOf('repository', 'not-repository', 'no-folder', 'unavailable'),
      detached: boolean,
      unborn: boolean,
      files: array(gitFile, 2000),
      truncated: boolean,
    },
    { worktreeId: id, repositoryRoot: text(16384), branch: text(4096), head: text(128) },
  );
const gitBranches: Check = (value) =>
  shape(
    value,
    {
      projectId: id,
      state: oneOf('repository', 'not-repository', 'no-folder'),
      detached: boolean,
      changed: integer,
      busy: boolean,
      branches: array(
        (branch) =>
          shape(
            branch,
            { name: text(4096), remote: boolean, current: boolean },
            { worktree: text(16384) },
          ),
        500,
      ),
      truncated: boolean,
    },
    { worktreeId: id, current: text(4096) },
  );
const gitDiff: Check = (value) =>
  shape(value, {
    projectId: id,
    path: text(4096, true),
    side: gitSide,
    file: gitFile,
    binary: boolean,
    truncated: boolean,
    additions: integer,
    deletions: integer,
    metadata: array(text(524288, true), 40),
    hunks: array(
      (hunk) =>
        shape(hunk, {
          header: text(524288),
          oldStart: integer,
          oldLines: integer,
          newStart: integer,
          newLines: integer,
          lines: array(
            (line) =>
              shape(
                line,
                {
                  kind: oneOf('context', 'addition', 'deletion', 'notice'),
                  text: text(524288, true),
                },
                { oldLine: integer, newLine: integer },
              ),
            5000,
          ),
        }),
      5000,
    ),
  });
const hexColor: Check = (value) => {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) invalid('Expected a #rrggbb color.');
};
const fontFamily: Check = (value) => {
  text(APPEARANCE.limits.fontUtf16, true)(value);
  if (!FONT_FAMILY.test(value as string)) invalid('A font family name has unsupported characters.');
};
const appearanceRanges = Object.fromEntries(
  Object.entries(APPEARANCE_RANGES).map(([key, [min, max]]) => [key, range(min, max)]),
) as Record<keyof typeof APPEARANCE_RANGES, Check>;
const appearanceSettings: Check = (value) => {
  shape(
    value,
    {
      // The theme is checked with the custom themes it may name, below.
      theme: text(80),
      customThemes: array(() => undefined, APPEARANCE.limits.customThemes),
      accent: oneOf(...APPEARANCE.accents),
      customAccent: hexColor,
      uiFont: fontFamily,
      codeFont: fontFamily,
      terminalFont: fontFamily,
      background: oneOf(...APPEARANCE.backgrounds),
      backgroundPattern: oneOf(...APPEARANCE.patterns),
      autoColors: boolean,
      ownSurfaces: array(oneOf(...SURFACE_ROLES), SURFACE_ROLES.length),
      backgroundColor: hexColor,
      gradientFrom: hexColor,
      gradientTo: hexColor,
      ...appearanceRanges,
    },
    {
      paneOpacity: range(...APPEARANCE.limits.paneOpacity),
      sidebarOpacity: range(...APPEARANCE.limits.sidebarOpacity),
    },
  );
  const record = object(value);
  const problem = appearanceThemeProblem(record.theme, record.customThemes);
  if (problem) invalid(problem);
};
const wallpaper: Check = (value) => {
  const { limits } = APPEARANCE;
  shape(value, {
    dataUrl: text(limits.wallpaperUtf16),
    name: text(limits.wallpaperNameUtf16, true),
    width: range(1, limits.wallpaperPixels),
    height: range(1, limits.wallpaperPixels),
  });
  if (!WALLPAPER_PREFIX.test(object(value).dataUrl as string))
    invalid('A wallpaper must be inline JPEG, PNG or WebP data.');
};

const historyEntry: Check = (value) =>
  shape(
    value,
    {
      id,
      providerId,
      origin: oneOf('jam', 'external'),
      discoveredAt: timestamp,
      resumable: boolean,
    },
    {
      title: text(256),
      preview: text(512),
      createdAt: timestamp,
      updatedAt: timestamp,
      syncedAt: timestamp,
      resourceId: id,
      projectId: id,
      worktreeId: id,
      sourcePath: text(4096),
      missingSince: timestamp,
      ignoredAt: timestamp,
      changed: boolean,
    },
  );
const historyTarget: Check = (value) => shape(value, { historyId: id });
const historyEntryResult: Check = (value) => shape(value, { entry: historyEntry });

const params: Record<RequestMethod, Check> = {
  'providerHistory.scan': (value) => shape(value, { providerId }),
  'providerHistory.list': (value) =>
    shape(
      value,
      {},
      {
        providerId,
        ignored: boolean,
        cursor: text(512),
        limit: range(1, HISTORY_LIST_LIMIT),
      },
    ),
  'providerHistory.associate': (value) => shape(value, { historyId: id, projectId: id }),
  'providerHistory.ignore': historyTarget,
  'providerHistory.restore': historyTarget,
  'git.status': (value) => shape(value, { projectId: id }, { worktreeId: id }),
  'git.branches': (value) => shape(value, { projectId: id }, { worktreeId: id }),
  'git.diff': (value) =>
    shape(value, { projectId: id, path: relativePath, side: gitSide }, { worktreeId: id }),
  'git.setStaged': (value) =>
    shape(value, { projectId: id, path: relativePath, staged: boolean }, { worktreeId: id }),
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
  'conversation.create': (value) =>
    shape(
      value,
      { projectId: id, presentation },
      { providerId, options: optionMap, workspace: newWorkspace, requestId: id },
    ),
  'conversation.workspace': (value) => shape(value, { resourceId: id, workspace: moveWorkspace }),
  'conversation.delete': (value) => shape(value, { resourceId: id }),
  'attachment.remove': (value) => shape(value, { id }),
  'attachment.asset': (value) => shape(value, { id }),
  'attachment.text': (value) => shape(value, { id }),
  'attachment.reveal': (value) => shape(value, { id }),
  'session.compact': (value) => shape(value, { resourceId: id, requestId: id }),
  'provider.list': (value) => shape(value, {}, { refresh: boolean }),
  'provider.configure': (value) =>
    shape(
      value,
      { providerId },
      {
        enabled: boolean,
        isDefault: boolean,
        executable: text(4096, true),
        defaults: optionMap,
        favoriteModels: modelIds,
        hiddenModels: modelIds,
      },
    ),
  'interaction.respond': (value) => {
    shape(
      value,
      { resourceId: id, interactionId: id },
      {
        choiceId: text(64),
        answers: (answers) => {
          const record = object(answers);
          if (Object.keys(record).length > 8) invalid('Too many answers.');
          for (const [key, list] of Object.entries(record)) {
            text(64)(key);
            array(text(4096), 16)(list);
          }
        },
      },
    );
    const record = object(value);
    if ((record.choiceId === undefined) === (record.answers === undefined))
      invalid('Answer with a choice or with answers.');
  },
  'turn.start': (value) => {
    shape(
      value,
      {
        resourceId: id,
        text: text(20_000, true),
        context: array(context, 16),
        requestId: id,
      },
      { options: optionMap },
    );
    const record = object(value);
    if (!(record.text as string).trim() && !(record.context as unknown[]).length) {
      invalid('A turn needs text or staged context.');
    }
  },
  'turn.interrupt': (value) => shape(value, { sessionId: id }),
  'directory.list': (value) =>
    shape(value, { projectId: id, path: listingPath }, { worktreeId: id }),
  'file.read': (value) => shape(value, { projectId: id, path: relativePath }, { worktreeId: id }),
  'file.reveal': (value) => shape(value, { projectId: id, path: relativePath }, { worktreeId: id }),
  'url.openExternal': (value) => shape(value, { url: text(2048) }),
  'file.write': (value) =>
    shape(value, { projectId: id, path: relativePath, text: text(2_000_000, true) }),
  'project.create': (value) =>
    shape(
      value,
      { paths: array(projectPath, iconLimits.paths) },
      { name: text(iconLimits.nameUtf16), icon: projectIcon },
    ),
  'project.remove': (value) => shape(value, { projectId: id }),
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
  'project.reorder': (value) => shape(value, { projectIds: projectOrder }),
  'sidebar.reorder': (value) => shape(value, { sections: sidebarSections }),
  'thread.setClosed': (value) => shape(value, { resourceId: id, closed: boolean }),
  'thread.keepOpen': (value) => shape(value, { resourceId: id }),
  'thread.setPinned': (value) => shape(value, { resourceId: id, pinned: boolean }),
  'resource.open': (value) => {
    shape(
      value,
      { projectId: id, kind: oneOf(...OPENABLE_KINDS) },
      { path: relativePath, worktreeId: id },
    );
    const record = object(value);
    if ((record.kind === 'file') !== (record.path !== undefined))
      invalid('Only a file resource is opened by path, and it requires one.');
    if (record.kind === 'browser' && record.worktreeId !== undefined)
      invalid('A browser does not open in a worktree.');
  },
  'search.query': (value) =>
    shape(value, { query: text(256, true) }, { projectId: id, providerId, pinned: boolean }),
  'terminal.create': (value) =>
    shape(
      value,
      { projectId: id },
      { cwd: text(4096), worktreeId: id, cols: columns, rows: lines },
    ),
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
  'appearance.get': (value) => shape(value, {}),
  'appearance.update': (value) => shape(value, { appearance: appearanceSettings }),
  'appearance.setWallpaper': (value) => shape(value, {}, { wallpaper }),
};

const responses: Record<RequestMethod, Check> = {
  'providerHistory.scan': (value) =>
    shape(value, {
      providerId,
      discovered: integer,
      updated: integer,
      unchanged: integer,
      rejected: integer,
      missing: integer,
      complete: boolean,
    }),
  'providerHistory.list': (value) =>
    shape(value, { entries: array(historyEntry, HISTORY_LIST_LIMIT) }, { cursor: text(512) }),
  'providerHistory.associate': historyEntryResult,
  'providerHistory.ignore': historyEntryResult,
  'providerHistory.restore': historyEntryResult,
  'git.status': gitStatus,
  'git.branches': gitBranches,
  'git.diff': gitDiff,
  'git.setStaged': gitStatus,
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
  'conversation.create': (value) => shape(value, { resource, session, conversation }, { worktree }),
  'conversation.workspace': (value) => shape(value, { resource }, { worktree }),
  'conversation.delete': (value) => shape(value, { resourceId: id }),
  'attachment.remove': accepted,
  // At most the preview's 256 KB of UTF-8; a file of only blank lines is text too.
  'attachment.text': (value) => shape(value, { text: text(270_000, true), truncated: boolean }),
  'attachment.reveal': (value) => shape(value, { revealed: oneOf(true) }),
  'attachment.asset': (value) =>
    shape(value, {
      dataUrl: (data) => {
        // The largest attachment, as base64.
        text(36_000_000)(data);
        // Only raster images and PDF; never SVG or HTML.
        if (!/^data:(?:image\/(?:png|jpeg|gif|webp)|application\/pdf);base64,/.test(data as string))
          invalid('Invalid attachment preview.');
      },
    }),
  'turn.start': (value) => shape(value, { accepted: oneOf(true), sessionId: id, requestId: id }),
  'session.compact': (value) =>
    shape(value, { accepted: oneOf(true), sessionId: id, requestId: id }),
  'provider.list': (value) => shape(value, { providers: array(provider, 20) }),
  'provider.configure': (value) => shape(value, { providers: array(provider, 20) }),
  'interaction.respond': accepted,
  'turn.interrupt': (value) => shape(value, { sessionId: id, interrupted: boolean }),
  'directory.list': directoryListing,
  'file.read': fileContents,
  'file.reveal': (value) => shape(value, { revealed: oneOf(true) }),
  'url.openExternal': (value) => shape(value, { opened: oneOf(true) }),
  'file.write': fileSaved,
  'project.create': (value) => shape(value, { project, existing: boolean }),
  'project.remove': (value) => shape(value, { projectId: id }),
  'project.update': (value) => shape(value, { project }),
  'project.reorder': (value) => shape(value, { projectIds: projectOrder }),
  'sidebar.reorder': (value) => shape(value, { sections: sidebarSections }),
  'thread.setClosed': (value) => shape(value, { resource }),
  'thread.keepOpen': (value) => shape(value, { resource }),
  'thread.setPinned': (value) => shape(value, { resource }),
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
  'appearance.get': (value) => shape(value, {}, { appearance: appearanceSettings, wallpaper }),
  'appearance.update': (value) => shape(value, { appearance: appearanceSettings }),
  'appearance.setWallpaper': (value) => shape(value, { updatedAt: timestamp }),
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
