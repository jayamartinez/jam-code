import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useOccludesNativeViews } from '../state/native-occlusion';

/**
 * A right-click menu drawn by JAM rather than the WebView's native one, so it
 * looks and behaves the same on macOS and Windows. It opens at the pointer,
 * or at the element for the keyboard's context-menu key and Shift+F10, and is
 * nudged back inside the window when it would overflow.
 */

export interface ContextMenuItem {
  label: string;
  onSelect(): void;
  danger?: boolean;
  /** A quiet note at the end of the row, such as the gesture that does this. */
  hint?: string;
  /** Starts a new group, drawn with a rule above it. */
  separated?: boolean;
  /** Why the item cannot be chosen right now; it is shown disabled. */
  unavailable?: string;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

export function ContextMenu({ menu, onClose }: { menu: ContextMenuState; onClose(): void }) {
  const element = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: menu.x, top: menu.y });
  useOccludesNativeViews();

  useLayoutEffect(() => {
    const box = element.current?.getBoundingClientRect();
    if (!box) return;
    setPosition({
      left: Math.max(4, Math.min(menu.x, window.innerWidth - box.width - 4)),
      top: Math.max(4, Math.min(menu.y, window.innerHeight - box.height - 4)),
    });
    element.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }, [menu]);

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (!element.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointer, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onPointer, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={element}
      className="context-menu"
      role="menu"
      style={position}
      // A right-click on the menu itself must not open another menu over it.
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const buttons = [
          ...(element.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
        ];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
        buttons[(next + buttons.length) % buttons.length]?.focus();
      }}
    >
      {menu.items.map((item) => (
        <Fragment key={item.label}>
          {item.separated && <span className="context-menu-rule" role="separator" />}
          <button
            type="button"
            role="menuitem"
            className={item.danger ? 'danger' : ''}
            disabled={!!item.unavailable}
            title={item.unavailable}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.label}
            {item.hint && <span className="context-menu-hint">{item.hint}</span>}
          </button>
        </Fragment>
      ))}
    </div>
  );
}

/** Where to open a menu for a mouse or keyboard context-menu event. */
export function menuPoint(event: React.MouseEvent): { x: number; y: number } {
  // The keyboard context-menu key reports (0, 0); open at the row instead.
  if (event.clientX === 0 && event.clientY === 0) {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: box.left + 12, y: box.bottom };
  }
  return { x: event.clientX, y: event.clientY };
}
