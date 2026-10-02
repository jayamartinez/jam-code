// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteChatDialog } from './DeleteChatDialog';

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

const render = (props: { busy?: boolean; error?: string } = {}) => {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  act(() =>
    root.render(
      createElement(DeleteChatDialog, {
        title: 'Fix auth flow',
        busy: props.busy ?? false,
        ...(props.error ? { error: props.error } : {}),
        onCancel,
        onConfirm,
      }),
    ),
  );
  const button = (label: string) =>
    [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)!;
  return { onCancel, onConfirm, button, dialog: document.querySelector('dialog')! };
};

describe('the delete confirmation', () => {
  it('says what is removed and what is not', () => {
    const { dialog } = render();
    expect(dialog.getAttribute('aria-label')).toBe('Delete Fix auth flow?');
    expect(dialog.textContent).toContain('Delete “Fix auth flow”?');
    expect(dialog.textContent).toContain(
      'This permanently removes this conversation from JAM Code.',
    );
    expect(dialog.textContent).toContain(
      'Project files, Git branches, worktrees and the agent’s own history are not deleted.',
    );
  });

  it('opens with Cancel focused, so Enter cannot delete', () => {
    const { button, onConfirm } = render();
    expect(document.activeElement).toBe(button('Cancel'));
    expect(button('Delete').className).toContain('danger');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Escape cancels, and only the Delete button confirms', () => {
    const { dialog, button, onCancel, onConfirm } = render();
    act(() => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    act(() => button('Delete').click());
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('waits while the runtime deletes, and shows why a deletion was refused', () => {
    const { dialog, button, onCancel } = render({ busy: true });
    expect(button('Cancel').disabled).toBe(true);
    expect(button('Deleting…').disabled).toBe(true);
    // Dismissing mid-request would hide the answer; it is ignored.
    act(() => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expect(onCancel).not.toHaveBeenCalled();

    const refused = render({ error: 'Stop the agent or answer its request first.' });
    expect(refused.dialog.querySelector('[role="alert"]')?.textContent).toBe(
      'Stop the agent or answer its request first.',
    );
    expect(refused.button('Delete').disabled).toBe(false);
  });
});
