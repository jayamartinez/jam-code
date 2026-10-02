// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryResizeHandle } from './HistoryResizeHandle';
import { readHistoryHeight, type HistoryHeight } from '../state/preferences';

let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // The section the handle belongs to is 300px tall.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 100,
    bottom: 400,
    height: 300,
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

function mount(height: HistoryHeight) {
  const onPreview = vi.fn();
  const onChange = vi.fn();
  act(() =>
    root.render(
      createElement(
        'section',
        null,
        createElement(HistoryResizeHandle, { height, dragging: false, onPreview, onChange }),
      ),
    ),
  );
  const handle = document.querySelector<HTMLElement>('.history-resize')!;
  const at = (y: number) => ({ bubbles: true, button: 0, clientY: y });
  return {
    onPreview,
    onChange,
    handle,
    press: (y: number) =>
      act(() => void handle.dispatchEvent(new PointerEvent('pointerdown', at(y)))),
    drag: (y: number) =>
      act(() => void window.dispatchEvent(new PointerEvent('pointermove', at(y)))),
    release: () => act(() => void window.dispatchEvent(new PointerEvent('pointerup', at(0)))),
    key: (key: string) =>
      act(() => void handle.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))),
  };
}

describe('History resize handle', () => {
  it('follows the pointer and keeps the height on release', () => {
    const edge = mount('auto');
    edge.press(400);
    edge.drag(520);
    expect(edge.onPreview).toHaveBeenLastCalledWith(420);
    // Nothing is kept until the release.
    expect(edge.onChange).not.toHaveBeenCalled();
    edge.release();
    expect(edge.onChange).toHaveBeenCalledExactlyOnceWith(420);
    expect(edge.onPreview).toHaveBeenLastCalledWith(null);
    // The drag is over: the pointer no longer resizes anything.
    edge.drag(900);
    expect(edge.onPreview).toHaveBeenLastCalledWith(null);
  });

  it('never goes below a few rows', () => {
    const edge = mount(400);
    edge.press(400);
    edge.drag(-2000);
    edge.release();
    expect(edge.onChange).toHaveBeenCalledExactlyOnceWith(160);
  });

  it('treats a press that never moved as a click, not a height', () => {
    const edge = mount('auto');
    edge.press(400);
    edge.release();
    expect(edge.onChange).not.toHaveBeenCalled();
  });

  it('switches between every chat and the automatic height on a double click', () => {
    const sized = mount(420);
    act(() => void sized.handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(sized.onChange).toHaveBeenLastCalledWith('all');
    expect(sized.handle.title).toContain('show every chat');

    const all = mount('all');
    act(() => void all.handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(all.onChange).toHaveBeenLastCalledWith('auto');
    expect(all.handle.title).toContain('fit the sidebar');
  });

  it('resizes and expands from the keyboard', () => {
    const edge = mount('auto');
    edge.key('ArrowDown');
    expect(edge.onChange).toHaveBeenLastCalledWith(348);
    edge.key('ArrowUp');
    expect(edge.onChange).toHaveBeenLastCalledWith(252);
    edge.key('Enter');
    expect(edge.onChange).toHaveBeenLastCalledWith('all');
  });

  it('reads a stored height, falling back to automatic', () => {
    expect(readHistoryHeight(null)).toBe('auto');
    expect(readHistoryHeight('auto')).toBe('auto');
    expect(readHistoryHeight('all')).toBe('all');
    expect(readHistoryHeight('420')).toBe(420);
    expect(readHistoryHeight('12')).toBe(160);
    expect(readHistoryHeight('tall')).toBe('auto');
    expect(readHistoryHeight('')).toBe('auto');
  });
});
