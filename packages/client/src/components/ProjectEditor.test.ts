// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectEditor } from './ProjectEditor';

let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

/** A New project dialog whose folder chooser returns `folder`. */
async function open(count: (paths: string[]) => Promise<number>, add = true) {
  const onAdd = vi.fn();
  act(() =>
    root.render(
      createElement(ProjectEditor, {
        projects: [],
        onPickFolder: () => Promise.resolve('C:\\work\\café repo'),
        onSave: () => Promise.resolve(),
        onClose: () => undefined,
        pastChats: { add, onAdd, count },
      }),
    ),
  );
  const choose = [...document.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Choose a folder'),
  )!;
  await act(async () => choose.click());
  // Let the count settle.
  await act(async () => undefined);
  return { onAdd, row: () => document.querySelector('.project-dialog-past') };
}

describe('past chats in the New project dialog', () => {
  it('offers the chats found in the chosen folder, with the shared switch', async () => {
    const count = vi.fn(() => Promise.resolve(14));
    const { onAdd, row } = await open(count);
    expect(count).toHaveBeenCalledWith(['C:\\work\\café repo']);
    expect(row()?.textContent).toContain('14 past chats from your agents in café repo');
    const toggle = row()!.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    act(() => toggle.click());
    expect(onAdd).toHaveBeenCalledWith(false);
  });

  it('shows nothing when the folder has none, or they cannot be counted', async () => {
    expect((await open(() => Promise.resolve(0))).row()).toBeNull();
    act(() => root.render(null));
    expect((await open(() => Promise.reject(new Error('unavailable')))).row()).toBeNull();
  });

  it('says one chat in the singular', async () => {
    const { row } = await open(() => Promise.resolve(1), false);
    expect(row()?.textContent).toContain('1 past chat from your agents');
    expect(row()?.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
  });
});
