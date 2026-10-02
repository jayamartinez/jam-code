// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SortGrip, useSortable, type SortBounds } from './sortable';

let root: Root;
/** Each item's top and height; the list has a 4px gap between items. */
const BOXES = [
  { top: 0, height: 30 },
  { top: 34, height: 100 },
  { top: 138, height: 30 },
  { top: 172, height: 30 },
];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const box = BOXES[Number(this.dataset.index)] ?? { top: 0, height: 0 };
    return { ...box, bottom: box.top + box.height, left: 0, right: 200, width: 200 } as DOMRect;
  });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function List({ onMove, bounds }: { onMove(from: number, to: number): void; bounds?: SortBounds }) {
  const sort = useSortable(onMove);
  return createElement(
    'div',
    { ref: sort.list, className: sort.sorting ? 'sorting' : '' },
    BOXES.map((_, index) => {
      const { className, ...item } = sort.item(index);
      return createElement(
        'div',
        { key: index, ...item, className: `row ${className}`, 'data-index': index },
        createElement(SortGrip, { name: `item ${index}`, ...sort.grip(index, bounds) }),
      );
    }),
  );
}

function mount(bounds?: SortBounds) {
  const onMove = vi.fn();
  act(() => root.render(createElement(List, { onMove, ...(bounds ? { bounds } : {}) })));
  const rows = () => [...document.querySelectorAll<HTMLElement>('.row')];
  const grips = () => [...document.querySelectorAll<HTMLElement>('.sort-grip')];
  const at = (y: number) => ({ bubbles: true, button: 0, clientX: 10, clientY: y });
  return {
    onMove,
    rows,
    grips,
    press: (index: number, y: number) =>
      act(() => {
        grips()[index]!.dispatchEvent(new PointerEvent('pointerdown', at(y)));
      }),
    drag: (y: number) =>
      act(() => {
        window.dispatchEvent(new PointerEvent('pointermove', at(y)));
      }),
    release: () =>
      act(() => {
        window.dispatchEvent(new PointerEvent('pointerup', at(0)));
      }),
    key: (index: number, key: string, altKey = true) =>
      act(() => {
        grips()[index]!.dispatchEvent(new KeyboardEvent('keydown', { key, altKey, bubbles: true }));
      }),
  };
}

describe('sortable list', () => {
  it('lifts the dragged item, slides the ones it passes, and moves it on release', () => {
    const list = mount();
    list.press(0, 15);
    // A press that has not moved is not a drag.
    expect(document.querySelector('.sort-lifted')).toBeNull();

    // Past the middle of the tall second item (84) but not the third (153).
    list.drag(15 + 60);
    const [first, second, third] = list.rows();
    expect(first!.className).toContain('sort-lifted');
    expect(first!.style.transform).toBe('translateY(60px)');
    // The neighbor slides up by the dragged item's height plus the gap.
    expect(second!.className).toContain('sort-shifting');
    expect(second!.style.transform).toBe('translateY(-34px)');
    expect(third!.style.transform).toBe('translateY(0px)');
    expect(document.querySelector('.sorting')).not.toBeNull();
    // Nothing is reordered until the release.
    expect(list.onMove).not.toHaveBeenCalled();

    list.release();
    expect(list.onMove).toHaveBeenCalledExactlyOnceWith(0, 1);
    expect(document.querySelector('.sort-lifted')).toBeNull();
    expect(list.rows()[0]!.style.transform).toBe('');
  });

  it('moves up past several items and stops at the ends of the list', () => {
    const list = mount();
    list.press(3, 180);
    list.drag(-500);
    // It cannot be dragged out of the list.
    expect(list.rows()[3]!.style.transform).toBe('translateY(-172px)');
    expect(list.rows()[0]!.style.transform).toBe('translateY(34px)');
    list.release();
    expect(list.onMove).toHaveBeenCalledExactlyOnceWith(3, 0);
  });

  it('keeps a move within its bounds', () => {
    const list = mount([2, 3]);
    list.press(2, 150);
    list.drag(-500);
    // The items above the bounds do not give way.
    expect(list.rows()[2]!.style.transform).toBe('translateY(0px)');
    expect(list.rows()[1]!.style.transform).toBe('translateY(0px)');
    list.drag(400);
    list.release();
    expect(list.onMove).toHaveBeenCalledExactlyOnceWith(2, 3);
  });

  it('moves nothing when the drag returns, is canceled, or ends with Escape', () => {
    const list = mount();
    list.press(1, 50);
    list.drag(90);
    list.drag(51);
    list.release();
    expect(list.onMove).not.toHaveBeenCalled();

    list.press(0, 15);
    list.drag(120);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('.sort-lifted')).toBeNull();
    // The release that follows a cancel belongs to no drag.
    list.release();
    list.drag(200);
    expect(list.onMove).not.toHaveBeenCalled();
    expect(document.querySelector('.sort-lifted')).toBeNull();
  });

  it('moves the focused item with Alt and an arrow, within its bounds', () => {
    const list = mount([1, 3]);
    list.key(2, 'ArrowUp');
    expect(list.onMove).toHaveBeenLastCalledWith(2, 1);
    list.key(2, 'ArrowDown');
    expect(list.onMove).toHaveBeenLastCalledWith(2, 3);
    list.key(1, 'ArrowUp');
    list.key(3, 'ArrowDown');
    // A plain arrow is not a move.
    list.key(2, 'ArrowUp', false);
    expect(list.onMove).toHaveBeenCalledTimes(2);
  });

  it('stops listening when the list goes away mid-drag', () => {
    const list = mount();
    list.press(0, 15);
    list.drag(100);
    act(() => root.render(createElement('div')));
    list.release();
    expect(list.onMove).not.toHaveBeenCalled();
  });
});
