import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOccludesNativeViews } from '../state/native-occlusion';
import { placeMenu, type MenuPlacement } from './menu-placement';
import { overlayHostFor } from './overlay-host';

/**
 * A menu anchored to the control that opens it. It renders into the overlay
 * host (see `overlay-host.ts`), above every pane and outside any surface that
 * clips or filters, and is placed from its trigger's rectangle in the window:
 * above the trigger (or below, `compact`), flipping up when there is more room
 * above, and never past the window's edge.
 *
 * It is placed when it opens rather than tracked, so anything that moves its
 * trigger closes it: a press outside, a resized window, a scrolled list or a
 * resized pane.
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
  const [place, setPlace] = useState<MenuPlacement>({ left: 0, maxHeight: 0 });
  const [host, setHost] = useState<HTMLElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const opened = useRef(onOpened);
  useEffect(() => {
    opened.current = onOpened;
  });
  // A native Browser page paints above everything JAM Code draws.
  useOccludesNativeViews(open);

  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) =>
      target instanceof Node &&
      (!!root.current?.contains(target) || !!menu.current?.contains(target));
    const outside = (event: PointerEvent) => {
      if (!inside(event.target)) setOpen(false);
    };
    const moved = () => setOpen(false);
    // Only a list the trigger is in carries it away; a transcript that
    // scrolls beside the composer, or the menu's own list, does not.
    const scrolled = (event: Event) => {
      const scroller = event.target;
      if (scroller instanceof Node && trigger.current && scroller.contains(trigger.current))
        setOpen(false);
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('resize', moved);
    window.addEventListener('scroll', scrolled, true);
    // A pane or sidebar that changes size has moved the trigger with it.
    const surface = trigger.current?.closest('.pane, .sidebar');
    let observed = false;
    const observer =
      surface && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            // The first report is the size it already had.
            if (observed) setOpen(false);
            observed = true;
          })
        : undefined;
    if (surface) observer?.observe(surface);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', moved);
      window.removeEventListener('scroll', scrolled, true);
      observer?.disconnect();
    };
  }, [open]);

  useLayoutEffect(() => {
    const element = menu.current;
    const anchor = trigger.current;
    if (!open || !element || !anchor || !host) return;
    // Now that the menu has a width, keep it inside the layer's right edge.
    const placed = placeMenu({
      trigger: anchor.getBoundingClientRect(),
      layer: host.getBoundingClientRect(),
      menuWidth: element.getBoundingClientRect().width,
      compact,
    });
    setPlace((current) => (current.left === placed.left ? current : placed));
    opened.current(element);
  }, [open, host, compact]);

  return {
    open,
    /** Position for the menu element, relative to the overlay host. */
    place: place as React.CSSProperties,
    root,
    trigger,
    menu,
    /** Renders the open menu in the overlay host. */
    layer(node: React.ReactNode) {
      return host ? createPortal(node, host) : null;
    },
    toggle() {
      const anchor = trigger.current;
      if (!anchor) return;
      const layer = overlayHostFor(anchor);
      setHost(layer);
      setPlace(
        placeMenu({
          trigger: anchor.getBoundingClientRect(),
          layer: layer.getBoundingClientRect(),
          compact,
        }),
      );
      setOpen((shown) => !shown);
    },
    close(refocus: boolean) {
      setOpen(false);
      if (refocus) trigger.current?.focus();
    },
    /**
     * Tab leaves the menu: focus returns to the trigger first, so the key
     * moves on from there instead of from the end of the document.
     */
    tabOut() {
      trigger.current?.focus();
      setOpen(false);
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
