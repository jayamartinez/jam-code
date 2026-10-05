// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ContextItem,
  Conversation,
  Project,
  ProviderDescriptor,
  Resource,
  Session,
} from '@jam/protocol';
import { Composer, ConversationPane } from './ConversationPane';

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
});

const project: Project = {
  id: 'project-jam',
  name: 'jam-code',
  initials: 'JC',
  branch: 'main',
  paths: ['/code/jam-code'],
};
const session: Session = {
  id: 'session-1',
  resourceId: 'conv-1',
  providerId: 'codex',
  presentation: 'codex',
  status: 'idle',
  model: 'gpt-5.5',
};
const codex = (images: 'supported' | 'unsupported'): ProviderDescriptor =>
  ({
    id: 'codex',
    name: 'Codex',
    installation: 'installed',
    authentication: 'authenticated',
    enabled: true,
    isDefault: true,
    running: false,
    capabilities: { images: { status: 'conditional' } },
    models: [{ id: 'gpt-5.5', label: 'GPT-5.5', isDefault: true, images }],
  }) as unknown as ProviderDescriptor;

const attachment = (
  id: string,
  name: string,
  kind: 'file' | 'image',
  bytes: number,
): ContextItem => ({
  id,
  kind: 'attachment',
  label: name,
  source: {},
  assetId: id,
  attachment: { name, mediaType: kind === 'image' ? 'image/png' : 'text/plain', kind, bytes },
});
const log = attachment('attachment-log', 'test-output.txt', 'file', 18_432);
const image = attachment('attachment-image', 'failure.png', 'image', 421_888);

function composer(overrides: Partial<React.ComponentProps<typeof Composer>> = {}) {
  const handlers = {
    onOptions: vi.fn(),
    onDraft: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    onAddContext: vi.fn(),
    onPreviewContext: vi.fn(),
    onRemoveContext: vi.fn(),
    onAttach: vi.fn(),
  };
  act(() =>
    root.render(
      createElement(Composer, {
        draft: '',
        context: [],
        busy: false,
        shortcut: 'Ctrl',
        providers: [codex('supported')],
        options: {},
        session,
        project,
        ...handlers,
        ...overrides,
      }),
    ),
  );
  const button = (label: string) =>
    document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  return { ...handlers, button, send: () => button('Send message')! };
}

describe('attaching files in the composer', () => {
  it('opens the system chooser from the + control and sends nothing', () => {
    const { button, onAttach, onSend } = composer();
    act(() => button('Attach files')!.click());
    expect(onAttach).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('says so, instead of pretending, where the host cannot read files', () => {
    const { button } = composer({ onAttach: undefined });
    const control = button('Attaching files needs the desktop app')!;
    expect(control.disabled).toBe(true);
    expect(button('Attach files')).toBeNull();
  });

  it('shows each staged attachment with its name and size, and removes one on request', () => {
    const { button, onRemoveContext, onPreviewContext, send } = composer({
      context: [log, image],
    });
    const chips = [...document.querySelectorAll('.context-chip')].map((chip) => chip.textContent);
    expect(chips).toEqual(['test-output.txt18 KB', 'failure.png412 KB']);
    // An attachment alone is a complete message.
    expect(send().disabled).toBe(false);
    act(() => button('Remove failure.png')!.click());
    expect(onRemoveContext).toHaveBeenCalledWith('attachment-image');
    act(() => document.querySelector<HTMLButtonElement>('.context-chip > button')!.click());
    expect(onPreviewContext).toHaveBeenCalledWith(log);
  });

  it('refuses an image before Send when the model cannot take one', () => {
    const { send, onSend } = composer({
      providers: [codex('unsupported')],
      context: [log, image],
      draft: 'Look at this',
    });
    const refused = document.querySelector('.context-chip.refused')!;
    expect(refused.textContent).toBe('failure.pngcan’t be sent');
    expect(refused.getAttribute('title')).toMatch(/Codex does not accept images with this model/);
    // The text file beside it is not marked.
    expect(document.querySelectorAll('.context-chip.refused')).toHaveLength(1);
    expect(send().disabled).toBe(true);
    expect(send().title).toMatch(/Remove the image or choose another model/);
    // Enter does not send it either.
    act(() => {
      document
        .querySelector('textarea')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends once the image is removed or the model accepts it', () => {
    expect(
      composer({ providers: [codex('unsupported')], context: [log], draft: 'x' }).send().disabled,
    ).toBe(false);
    expect(
      composer({ providers: [codex('supported')], context: [image], draft: 'x' }).send().disabled,
    ).toBe(false);
  });
});

describe('attachments on a sent message', () => {
  it('stay visible with their name and type, and open on request', () => {
    const resource: Resource = {
      id: 'conv-1',
      kind: 'conversation',
      title: 'Failing test',
      projectId: project.id,
      sessionId: session.id,
      pinned: false,
      updatedAt: '2026-10-01T10:00:00Z',
    };
    const conversation: Conversation = {
      resourceId: resource.id,
      sessionId: session.id,
      cursor: { runtimeId: 'r', sequence: 0 },
      messages: [
        {
          id: 'm1',
          role: 'user',
          createdAt: '2026-10-01T10:00:00Z',
          blocks: [
            { type: 'context', items: [log, image] },
            { type: 'text', text: 'Why does this fail only on CI?' },
          ],
        },
      ],
    };
    const onPreviewSent = vi.fn();
    const noop = vi.fn();
    act(() =>
      root.render(
        createElement(ConversationPane, {
          resource,
          project,
          session,
          conversation,
          draft: '',
          context: [],
          busy: false,
          shortcut: 'Ctrl',
          providers: [codex('supported')],
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
          onDraft: noop,
          onSend: noop,
          followUp: 'queue',
          onFollowUp: noop,
          queueActions: { onEdit: async () => {}, onRemove: noop, onMove: noop, onSendNow: noop },
          onStop: noop,
          onCompact: async () => {},
          onOpenReview: noop,
          onAddContext: noop,
          onPreviewContext: noop,
          onPreviewSent,
          onRemoveContext: noop,
          onRespond: async () => {},
        }),
      ),
    );
    const sent = [...document.querySelectorAll<HTMLButtonElement>('.sent-attachment')];
    expect(sent.map((item) => item.textContent)).toEqual([
      'test-output.txt18 KB',
      'failure.pngPNG',
    ]);
    act(() => sent[1]!.click());
    expect(onPreviewSent).toHaveBeenCalledWith(image);
  });
});
