import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * A menu fixed to the pill that opens it, so a toolbar that clips its
 * overflow cannot hide it. It opens above the pill (or below, `compact`),
 * stays inside the window (flipping up when there is more room above), and
 * closes on an outside press or a resize.
 */
export function useAnchoredMenu({
  compact,
  onOpened,
}: {
  compact?: boolean;
  /** Moves focus into the menu once it is placed. */
  onOpened(menu: HTMLDivElement): void;
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<React.CSSProperties>({});
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const opened = useRef(onOpened);
  useEffect(() => {
    opened.current = onOpened;
  });

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    // The menu is placed once, so a resized window closes it.
    const resized = () => setOpen(false);
    window.addEventListener('pointerdown', outside);
    window.addEventListener('resize', resized);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', resized);
    };
  }, [open]);

  useLayoutEffect(() => {
    const element = menu.current;
    if (!open || !element) return;
    const box = element.getBoundingClientRect();
    const overflow = box.right - (window.innerWidth - 8);
    if (overflow > 0) element.style.left = `${Math.max(8, box.left - overflow)}px`;
    opened.current(element);
  }, [open]);

  return {
    open,
    place,
    root,
    trigger,
    menu,
    toggle() {
      const box = trigger.current?.getBoundingClientRect();
      if (!box) return;
      // A downward menu flips up when the window has more room above it.
      const below = window.innerHeight - box.bottom - 16;
      const down = compact && (below >= 200 || below >= box.top - 16);
      setPlace(
        down
          ? { left: box.left, top: box.bottom + 6, maxHeight: below }
          : { left: box.left, bottom: window.innerHeight - box.top + 8, maxHeight: box.top - 16 },
      );
      setOpen((shown) => !shown);
    },
    close(refocus: boolean) {
      setOpen(false);
      if (refocus) trigger.current?.focus();
    },
  };
}

/** Arrow, Home and End keys move between a menu's items, wrapping around. */
export function moveMenuFocus(event: React.KeyboardEvent, items: HTMLElement[]): boolean {
  // From outside the items (a search field), Up goes to the last one.
  const index = items.indexOf(document.activeElement as HTMLElement);
  const to =
    event.key === 'ArrowDown'
      ? index + 1
      : event.key === 'ArrowUp'
        ? (index < 0 ? items.length : index) - 1
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : null;
  if (to === null || !items.length) return false;
  event.preventDefault();
  items[(to + items.length) % items.length]?.focus();
  return true;
}
