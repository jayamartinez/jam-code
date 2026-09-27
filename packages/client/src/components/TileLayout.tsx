import { useCallback, useRef, type ReactNode } from 'react';
import { MIN_RATIO, MAX_RATIO, type LayoutNode, type SplitDirection } from '../state/layout';

/**
 * Renders a layout tree.
 *
 * This component knows only about splits, ratios and pane identity. It receives
 * a `renderPane` callback and never inspects what a pane contains, so any
 * resource can occupy any leaf without a layout special case.
 */

export interface TileLayoutProps {
  node: LayoutNode;
  focusedPaneId: string | null;
  renderPane(paneId: string): ReactNode;
  onFocusPane(paneId: string): void;
  onResize(splitId: string, ratio: number): void;
}

export function TileLayout({
  node,
  focusedPaneId,
  renderPane,
  onFocusPane,
  onResize,
}: TileLayoutProps) {
  if (node.type === 'leaf')
    return (
      <div
        className={`tile ${focusedPaneId === node.id ? 'focused' : ''}`}
        data-pane-id={node.id}
        // Focus follows interaction so split commands have an obvious target.
        onFocusCapture={() => onFocusPane(node.id)}
        onMouseDownCapture={() => onFocusPane(node.id)}
      >
        {renderPane(node.id)}
      </div>
    );
  return (
    <div className={`tile-split ${node.direction}`}>
      <div className="tile-slot" style={{ flexBasis: `${node.ratio * 100}%` }}>
        <TileLayout
          node={node.first}
          focusedPaneId={focusedPaneId}
          renderPane={renderPane}
          onFocusPane={onFocusPane}
          onResize={onResize}
        />
      </div>
      <SplitHandle
        direction={node.direction}
        ratio={node.ratio}
        onResize={(ratio) => onResize(node.id, ratio)}
      />
      <div className="tile-slot" style={{ flexBasis: `${(1 - node.ratio) * 100}%` }}>
        <TileLayout
          node={node.second}
          focusedPaneId={focusedPaneId}
          renderPane={renderPane}
          onFocusPane={onFocusPane}
          onResize={onResize}
        />
      </div>
    </div>
  );
}

const STEP = 0.02;
const clamp = (ratio: number) => Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));

function SplitHandle({
  direction,
  ratio,
  onResize,
}: {
  direction: SplitDirection;
  ratio: number;
  onResize(ratio: number): void;
}) {
  const handle = useRef<HTMLDivElement>(null);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const track = handle.current?.parentElement;
      if (!track || event.button !== 0) return;
      event.preventDefault();
      handle.current?.setPointerCapture(event.pointerId);
      const box = track.getBoundingClientRect();
      const measure = (move: { clientX: number; clientY: number }) =>
        direction === 'row'
          ? (move.clientX - box.left) / box.width
          : (move.clientY - box.top) / box.height;
      const onMove = (move: PointerEvent) => onResize(clamp(measure(move)));
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [direction, onResize],
  );

  return (
    <div
      ref={handle}
      className={`split-handle ${direction}`}
      role="separator"
      tabIndex={0}
      aria-orientation={direction === 'row' ? 'vertical' : 'horizontal'}
      aria-label={direction === 'row' ? 'Resize columns' : 'Resize rows'}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={Math.round(MIN_RATIO * 100)}
      aria-valuemax={Math.round(MAX_RATIO * 100)}
      onPointerDown={onPointerDown}
      onKeyDown={(event) => {
        const back = direction === 'row' ? 'ArrowLeft' : 'ArrowUp';
        const forward = direction === 'row' ? 'ArrowRight' : 'ArrowDown';
        if (event.key !== back && event.key !== forward) return;
        event.preventDefault();
        onResize(clamp(ratio + (event.key === forward ? STEP : -STEP)));
      }}
    />
  );
}
