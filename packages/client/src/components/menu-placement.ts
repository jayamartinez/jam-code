/**
 * Where an anchored menu goes: beside the control that opened it, inside the
 * layer it is drawn in. Everything is measured in viewport pixels and the
 * result is relative to that layer, so a layer that is not the viewport (one
 * inside a filtered or transformed surface) still puts the menu at its trigger.
 */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The space kept between a menu and the edge of its layer. */
export const MENU_INSET = 8;
/** A downward menu keeps going down while it has at least this much room. */
const ROOM_BELOW = 200;

export interface MenuPlacement {
  left: number;
  maxHeight: number;
  /** Set for a menu that opens downward. */
  top?: number;
  /** Set for a menu that opens upward, so it stays on its trigger as it resizes. */
  bottom?: number;
}

export function placeMenu({
  trigger,
  layer,
  menuWidth = 0,
  compact = false,
}: {
  /** The trigger's viewport rectangle. */
  trigger: Box;
  /** The viewport rectangle of the layer the menu is positioned in. */
  layer: Box;
  /** The menu's measured width; unknown (0) before it has rendered. */
  menuWidth?: number;
  /** Prefers opening downward, flipping up when there is more room above. */
  compact?: boolean;
}): MenuPlacement {
  const below = layer.bottom - trigger.bottom - 2 * MENU_INSET;
  const above = trigger.top - layer.top - 2 * MENU_INSET;
  const down = compact && (below >= ROOM_BELOW || below >= above);
  // Starts at the trigger's left edge and moves in only as far as the layer needs.
  const furthest = layer.right - MENU_INSET - menuWidth;
  const left = Math.max(layer.left + MENU_INSET, Math.min(trigger.left, furthest)) - layer.left;
  return down
    ? { left, top: trigger.bottom + 6 - layer.top, maxHeight: Math.max(0, below) }
    : { left, bottom: layer.bottom - trigger.top + MENU_INSET, maxHeight: Math.max(0, above) };
}
