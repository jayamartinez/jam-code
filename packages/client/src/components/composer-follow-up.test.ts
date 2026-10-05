// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Conversation,
  Project,
  ProviderDescriptor,
  QueuedTurn,
  Resource,
  Session,
} from '@jam/protocol';
import { ConversationPane } from './ConversationPane';
import type { FollowUp } from '../state/preferences';
import { useKeybindings } from '../state/keybindings';

let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  localStorage.clear();
});

const project: Project = {
  id: 'project-jam',
  name: 'jam-code',
  initials: 'JC',
  branch: 'main',
  paths: ['/code/jam-code'],
};
const resource: Resource = {
  id: 'conv-1',
  kind: 'conversation',
  title: 'Divide',
  projectId: 'project-jam',
  sessionId: 'session-1',
  pinned: false,
  updatedAt: '2026-10-04T10:00:00Z',
};
const agent = (id: 'codex' | 'claude', steering: string): ProviderDescriptor =>
  ({
    id,
    name: id === 'codex' ? 'Codex' : 'Claude Code',
    installation: 'installed',
    authentication: 'authenticated',
    enabled: true,
    isDefault: true,
    running: true,
    capabilities: {
      steering: {
        status: steering,
        ...(steering === 'unsupported' ? { reason: 'Claude Code queues instead.' } : {}),
      },
    },
  }) as unknown as ProviderDescriptor;
const queued = (id: string, text: string, error?: string): QueuedTurn => ({
  id,
  resourceId: 'conv-1',
  text,
  context: [],
  createdAt: '2026-10-04T10:00:00Z',
  ...(error ? { error } : {}),
});

function render({
  providerId = 'codex',
  steering = 'supported',
  status = 'running',
  followUp = 'queue',
  draft = 'After this, run the tests.',
  queue = [] as QueuedTurn[],
} = {}) {
  const session: Session = {
    id: 'session-1',
    resourceId: 'conv-1',
    providerId: providerId as 'codex' | 'claude',
    presentation: providerId as 'codex' | 'claude',
    status: status as Session['status'],
    model: 'gpt-5.5',
  };
  const conversation: Conversation = {
    resourceId: 'conv-1',
    sessionId: 'session-1',
    cursor: { runtimeId: 'r', sequence: 0 },
    messages: [],
    queued: queue,
  };
  const calls = {
    onFollowUp: vi.fn<(mode: FollowUp) => void>(),
    onSend: vi.fn(),
    onDraft: vi.fn(),
    onEdit: vi.fn(async () => {}),
    onRemove: vi.fn(),
    onMove: vi.fn(),
    onSendNow: vi.fn(),
  };
  const noop = vi.fn();
  act(() =>
    root.render(
      createElement(ConversationPane, {
        resource,
        project,
        session,
        conversation,
        draft,
        context: [],
        busy: false,
        shortcut: 'Ctrl',
        providers: [agent(providerId as 'codex' | 'claude', steering)],
        options: {},
        streamReplies: false,
        timeFormat: '24h',
        focused: true,
        menu: [],
        onSplitRight: noop,
        onSplitDown: noop,
        onExpand: noop,
        expandLabel: 'Focus',
        onOptions: noop,
        onDraft: calls.onDraft,
        onSend: calls.onSend,
        followUp: followUp as FollowUp,
        onFollowUp: calls.onFollowUp,
        queueActions: {
          onEdit: calls.onEdit,
          onRemove: calls.onRemove,
          onMove: calls.onMove,
          onSendNow: calls.onSendNow,
        },
        onStop: noop,
        onCompact: async () => {},
        onOpenReview: noop,
        onAddContext: noop,
        onPreviewContext: noop,
        onRemoveContext: noop,
        onRespond: async () => {},
      }),
    ),
  );
  return calls;
}

const message = () =>
  document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!;
const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    message().dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        code: key === 'Enter' ? 'Enter' : key,
        bubbles: true,
        ...init,
      }),
    );
  });

describe('composer while the agent works', () => {
  it('queues on Enter and steers with the other shortcut', () => {
    const calls = render();
    expect(message().placeholder).toBe('Queue a follow-up for when Codex finishes…');
    const button = document.querySelector<HTMLButtonElement>('.follow-up-button')!;
    expect(button.getAttribute('aria-label')).toBe('Queue message');
    expect(button.title).toBe(
      'Queue: sends after Codex finishes this turn (Enter). Ctrl Enter to steer instead.',
    );
    expect(document.querySelector('.new-run-target')?.textContent).toContain(
      'Enter queues · Ctrl Enter steers',
    );
    press('Enter');
    expect(calls.onFollowUp).toHaveBeenLastCalledWith('queue');
    press('Enter', { ctrlKey: true });
    expect(calls.onFollowUp).toHaveBeenLastCalledWith('steer');
    // Nothing is sent as a new turn, and the draft is left to the app.
    expect(calls.onSend).not.toHaveBeenCalled();
    expect(calls.onDraft).not.toHaveBeenCalled();
    // Stop stays beside it.
    expect(document.querySelector('.stop-button')).not.toBeNull();
  });

  it('steers on Enter when Steer is the preference', () => {
    const calls = render({ followUp: 'steer' });
    expect(message().placeholder).toBe('Steer Codex while it works…');
    press('Enter');
    expect(calls.onFollowUp).toHaveBeenLastCalledWith('steer');
    press('Enter', { ctrlKey: true });
    expect(calls.onFollowUp).toHaveBeenLastCalledWith('queue');
  });

  it('queues, and says why, when the agent cannot be steered', () => {
    const calls = render({ providerId: 'claude', steering: 'unsupported', followUp: 'steer' });
    const button = document.querySelector<HTMLButtonElement>('.follow-up-button')!;
    expect(button.getAttribute('aria-label')).toBe('Queue message');
    expect(button.title).toContain('Claude Code cannot be steered: Claude Code queues instead.');
    expect(document.querySelector('.new-run-target')?.textContent).toContain(
      'Steering unavailable',
    );
    press('Enter');
    expect(calls.onFollowUp).toHaveBeenLastCalledWith('queue');
    // The other shortcut has nothing to do; it never pretends to steer.
    press('Enter', { ctrlKey: true });
    expect(calls.onFollowUp).toHaveBeenCalledTimes(1);
  });

  it('honors a rebound shortcut', () => {
    let bindings!: ReturnType<typeof useKeybindings>;
    function Rebind() {
      bindings = useKeybindings(false);
      return null;
    }
    act(() => root.render(createElement(Rebind)));
    act(() => bindings.assign('follow-up-other', 'alt+enter'));
    try {
      const calls = render();
      expect(document.querySelector('.new-run-target')?.textContent).toContain(
        'Enter queues · Alt Enter steers',
      );
      // The default keys are plain Enter again: they queue.
      press('Enter', { ctrlKey: true });
      expect(calls.onFollowUp).toHaveBeenLastCalledWith('queue');
      press('Enter', { altKey: true });
      expect(calls.onFollowUp).toHaveBeenLastCalledWith('steer');
    } finally {
      act(() => bindings.reset('follow-up-other'));
    }
  });

  it('sends normally when the agent is idle', () => {
    const calls = render({ status: 'idle' });
    expect(document.querySelector('.follow-up-button')).toBeNull();
    press('Enter');
    expect(calls.onSend).toHaveBeenCalledTimes(1);
    expect(calls.onFollowUp).not.toHaveBeenCalled();
  });
});

describe('queued follow-ups', () => {
  it('render in order, distinct from sent messages, with their actions', () => {
    const calls = render({
      queue: [queued('q1', 'After this, run the tests.'), queued('q2', 'Then open a PR.')],
    });
    const cards = [...document.querySelectorAll('.queued-turn')];
    expect(cards.map((card) => card.querySelector('.queued-label')?.textContent)).toEqual([
      'Queued · 1',
      'Queued · 2',
    ]);
    expect(document.querySelectorAll('.user-message')).toHaveLength(0);
    const button = (card: Element, label: string) =>
      card.querySelector<HTMLButtonElement>(`button[aria-label^="${label}"]`)!;
    expect(button(cards[0]!, 'Move up').disabled).toBe(true);
    expect(button(cards[1]!, 'Move down').disabled).toBe(true);
    act(() => button(cards[1]!, 'Move up').click());
    expect(calls.onMove).toHaveBeenCalledWith('q2', 0);
    act(() => button(cards[0]!, 'Remove').click());
    expect(calls.onRemove).toHaveBeenCalledWith('q1');
    // While a steerable agent works, sending one now steers it in.
    expect(button(cards[0]!, 'Steer now').disabled).toBe(false);
    act(() => button(cards[0]!, 'Steer now').click());
    expect(calls.onSendNow).toHaveBeenCalledWith('q1');
  });

  it('edit in place and save through the runtime', async () => {
    const calls = render({ queue: [queued('q1', 'run tests')] });
    const card = document.querySelector('.queued-turn')!;
    act(() => card.querySelector<HTMLButtonElement>('button[aria-label="Edit"]')!.click());
    const editor = card.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(editor.value).toBe('run tests');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(editor, 'run all tests');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      [...card.querySelectorAll('button')].find((b) => b.textContent === 'Save')!.click();
    });
    expect(calls.onEdit).toHaveBeenCalledWith('q1', 'run all tests');
  });

  it('cannot steer a follow-up into an agent that cannot take one', () => {
    render({
      providerId: 'claude',
      steering: 'unsupported',
      queue: [queued('q1', 'next')],
    });
    const send = document.querySelector<HTMLButtonElement>(
      'button[aria-label^="Steering unavailable"]',
    )!;
    expect(send.disabled).toBe(true);
  });

  it('say when they wait for the reader and why one failed', () => {
    render({
      status: 'interrupted',
      queue: [queued('q1', 'next', 'Codex is turned off in Settings → Providers.')],
    });
    expect(document.querySelector('.queued-error')?.textContent).toBe(
      ' Not sent: Codex is turned off in Settings → Providers.',
    );
    expect(document.querySelector('.queued-waiting')?.textContent).toMatch(/could not be sent/);
    // Idle, it is sent as a new turn.
    expect(document.querySelector('button[aria-label="Send now"]')).not.toBeNull();
  });
});
