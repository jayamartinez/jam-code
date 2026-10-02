import { useEffect, useRef, useState } from 'react';

interface Drag {
  from: number;
  over: number;
  dy: number;
  /** Distance a displaced neighbor slides: the dragged item plus the gap. */
  step: number;
}

/** The first and last index an item may be moved to. */
export type SortBounds = readonly [number, number];

/** Movement before a press on the grip becomes a drag. */
const DRAG_THRESHOLD = 3;

/**
 * Reordering a vertical list by its grips. The items are the list element's
 * direct `[data-sortable]` children and may differ in height. Like the tab
 * strip it is pointer-driven rather than HTML5 drag-and-drop, which would hand
 * the item to the operating system as something droppable into other apps:
 * the dragged item follows the pointer and its neighbors slide aside to show
 * where it will land. Nothing is reordered until the release, and Escape
 * cancels.
 */
export function useSortable(onMove: (from: number, to: number) => void) {
  const list = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  /** Ends the drag in progress, if any, without moving anything. */
  const cancel = useRef<(() => void) | null>(null);
  // A list that goes away mid-drag leaves no listeners on the window.
  useEffect(() => () => cancel.current?.(), []);

  const items = () => [
    ...(list.current?.querySelectorAll<HTMLElement>(':scope > [data-sortable]') ?? []),
  ];

  const start = (index: number, bounds?: SortBounds) => (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    // Measured once, before anything moves.
    const boxes = items().map((item) => item.getBoundingClientRect());
    const own = boxes[index];
    if (!own) return;
    const [low, high] = bounds ?? [0, boxes.length - 1];
    const before = boxes[index - 1];
    const after = boxes[index + 1];
    const gap = after ? after.top - own.bottom : before ? own.top - before.bottom : 0;
    const origin = event.clientY;
    // Keeps a text selection from starting and taking over the pointer stream.
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    let moving = false;
    let over = index;
    const onPointerMove = (move: PointerEvent) => {
      const travel = move.clientY - origin;
      if (!moving && Math.abs(travel) < DRAG_THRESHOLD) return;
      moving = true;
      // The item stays inside the stretch of the list it may be moved within.
      const dy = Math.max(
        boxes[low]!.top - own.top,
        Math.min(boxes[high]!.bottom - own.bottom, travel),
      );
      // A neighbor gives way once the dragged edge passes its middle.
      const middle = (box: DOMRect) => box.top + box.height / 2;
      const passedBelow = boxes.filter(
        (box, i) => i > index && i <= high && own.bottom + dy > middle(box),
      ).length;
      const passedAbove = boxes.filter(
        (box, i) => i < index && i >= low && own.top + dy < middle(box),
      ).length;
      over = index + passedBelow - passedAbove;
      setDrag({ from: index, over, dy, step: own.height + gap });
    };
    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKeyDown, true);
      cancel.current = null;
      setDrag(null);
      if (commit && moving && over !== index) onMove(index, over);
    };
    const onPointerUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKeyDown = (key: KeyboardEvent) => {
      if (key.key !== 'Escape') return;
      key.preventDefault();
      key.stopPropagation();
      finish(false);
    };
    cancel.current = onCancel;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKeyDown, true);
  };

  /** Where each item sits while another is being dragged. */
  const offset = (index: number) => {
    if (!drag) return 0;
    if (index === drag.from) return drag.dy;
    if (drag.from < index && index <= drag.over) return -drag.step;
    if (drag.over <= index && index < drag.from) return drag.step;
    return 0;
  };

  return {
    list,
    sorting: !!drag,
    /** Spread onto each item, with `className` joined to the item's own. */
    item: (index: number) => ({
      'data-sortable': true,
      className: drag ? (index === drag.from ? 'sort-lifted' : 'sort-shifting') : '',
      style: drag ? { transform: `translateY(${offset(index)}px)` } : undefined,
    }),
    /** Spread onto the item's grip. `bounds` keeps a move within a group. */
    grip: (index: number, bounds?: SortBounds) => ({
      onPointerDown: start(index, bounds),
      // Reordering stays reachable without a pointer.
      onKeyDown: (event: React.KeyboardEvent) => {
        if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
        event.preventDefault();
        const [low, high] = bounds ?? [0, items().length - 1];
        const to = index + (event.key === 'ArrowUp' ? -1 : 1);
        if (to >= low && to <= high) onMove(index, to);
      },
    }),
  };
}

/**
 * The six-dot handle an item is dragged by. It is its own button, so pressing
 * it never activates the row it belongs to.
 */
export function SortGrip({
  name,
  ...props
}: { name: string } & Pick<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'onPointerDown' | 'onKeyDown'
>) {
  return (
    <button
      type="button"
      className="sort-grip"
      aria-label={`Reorder ${name}`}
      title="Drag to reorder"
      {...props}
    >
      <svg width="6" height="10" viewBox="0 0 6 10" aria-hidden="true">
        {[1, 5, 9].flatMap((y) =>
          [1, 5].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1" fill="currentColor" />),
        )}
      </svg>
    </button>
  );
}
