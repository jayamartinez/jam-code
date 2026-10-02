// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from './Controls';

let root: Root;
/** The dialog's box in the window; everything outside it is the backdrop. */
const BOX = { left: 400, top: 300, right: 800, bottom: 500 };

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    ...BOX,
    width: 400,
    height: 200,
    x: BOX.left,
    y: BOX.top,
  } as DOMRect);
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function open() {
  const onClose = vi.fn();
  act(() =>
    root.render(
      createElement(Dialog, {
        title: 'Delete chat?',
        onClose,
        children: createElement('p', null, 'This permanently removes this conversation.'),
      }),
    ),
  );
  const dialog = document.querySelector('dialog')!;
  const text = dialog.querySelector('p')!;
  const at = (x: number, y: number) => ({ bubbles: true, clientX: x, clientY: y });
  return {
    onClose,
    dialog,
    text,
    press: (target: Element, x: number, y: number) =>
      act(() => {
        target.dispatchEvent(new PointerEvent('pointerdown', at(x, y)));
      }),
    // The browser reports a click on the nearest element common to where the
    // button went down and where it came up.
    click: (target: Element, x: number, y: number) =>
      act(() => {
        target.dispatchEvent(new MouseEvent('click', at(x, y)));
      }),
  };
}

describe('dismissing a dialog', () => {
  it('closes on a click that begins and ends on the backdrop', () => {
    const { dialog, press, click, onClose } = open();
    press(dialog, 100, 100);
    click(dialog, 100, 100);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('stays open when a text selection is dragged out of it', () => {
    const { dialog, text, press, click, onClose } = open();
    // The button goes down on the text and comes up over the backdrop: the
    // click lands on the dialog element, outside its box.
    press(text, 500, 400);
    click(dialog, 100, 100);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stays open when a selection ends on its own padding, or a click lands there', () => {
    const { dialog, text, press, click, onClose } = open();
    press(text, 500, 400);
    click(dialog, 410, 310);
    press(dialog, 410, 310);
    click(dialog, 410, 310);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stays open when a press on the backdrop is released inside the dialog', () => {
    const { dialog, press, click, onClose } = open();
    press(dialog, 100, 100);
    click(dialog, 500, 400);
    expect(onClose).not.toHaveBeenCalled();
    // That press is over; a later click inside is still not a dismissal.
    click(dialog, 100, 100);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('still closes on Escape', () => {
    const { dialog, onClose } = open();
    act(() => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
