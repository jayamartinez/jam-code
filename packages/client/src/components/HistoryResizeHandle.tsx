import { useEffect, useRef } from 'react';
import { HISTORY_MIN_HEIGHT, type HistoryHeight } from '../state/preferences';

/** Pixels an arrow key changes History's height by: about one chat. */
const HISTORY_STEP = 48;

/**
 * History's bottom edge. Dragging it sets how tall the section is, and a
 * double click switches between showing every chat and the automatic height.
 * A taller History never squeezes the other sections: the sidebar scrolls.
 */
export function HistoryResizeHandle({
  height,
  dragging,
  onPreview,
  onChange,
}: {
  height: HistoryHeight;
  dragging: boolean;
  /** The height under the pointer during a drag; null once it ends. */
  onPreview(pixels: number | null): void;
  onChange(next: HistoryHeight): void;
}) {
  /** Ends the drag in progress, if any, keeping the height it started with. */
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => () => cancel.current?.(), []);
  const measured = (handle: HTMLElement) => handle.parentElement!.getBoundingClientRect().height;
  const toggleAll = () => onChange(height === 'all' ? 'auto' : 'all');
  return (
    <div
      className={`history-resize ${dragging ? 'dragging' : ''}`}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize History"
      tabIndex={0}
      title={
        height === 'all'
          ? 'Drag to resize · double-click to fit the sidebar'
          : 'Drag to resize · double-click to show every chat'
      }
      onDoubleClick={toggleAll}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const from = measured(event.currentTarget);
        const origin = event.clientY;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        let pixels: number | null = null;
        const onMove = (move: PointerEvent) => {
          pixels = Math.max(HISTORY_MIN_HEIGHT, Math.round(from + move.clientY - origin));
          onPreview(pixels);
        };
        const finish = (commit: boolean) => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onCancel);
          cancel.current = null;
          onPreview(null);
          // A press that never moved is a click, not a new height.
          if (commit && pixels !== null) onChange(pixels);
        };
        const onUp = () => finish(true);
        const onCancel = () => finish(false);
        cancel.current = onCancel;
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
      }}
      // Resizing stays reachable without a pointer.
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          toggleAll();
        }
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const change = event.key === 'ArrowUp' ? -HISTORY_STEP : HISTORY_STEP;
        onChange(Math.max(HISTORY_MIN_HEIGHT, Math.round(measured(event.currentTarget)) + change));
      }}
    />
  );
}
